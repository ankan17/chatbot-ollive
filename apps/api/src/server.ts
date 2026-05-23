import { runMigrations, createDb } from '@ollive/db';
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { createRedis } from './redis.js';
import { createApp } from './app.js';
import { createUserRepository } from './users/repository.js';
import { withLoggingTransport, googleProviderFactory } from '@ollive/llm-sdk';
import type { BufferedHttpTransport } from '@ollive/llm-sdk';
import type { Server } from 'node:http';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger();

  logger.info('running database migrations...');
  await runMigrations(config.databaseUrl);
  logger.info('migrations applied');

  const db = createDb(config.databaseUrl);
  const redis = createRedis(config.redisUrl);

  // DE7: Seed demo user in dev mode (idempotent — safe to re-run on each restart)
  if (config.authMode === 'dev') {
    try {
      await createUserRepository(db).seedDemoUser();
      logger.info('demo user seeded (dev mode)');
    } catch (err) {
      logger.warn({ err }, 'failed to seed demo user — non-fatal, will retry on next dev login');
    }
  }

  // Plan 5: Instrument the chat provider with the logging transport so every inference
  // call is buffered and forwarded to the local ingestion endpoint (POST /v1/logs).
  const ingestionUrl = `http://localhost:${config.port}/v1/logs`;
  const { provider: chatProvider, transport } = withLoggingTransport(
    googleProviderFactory(),
    {
      ingestionUrl,
      apiKey: config.ingestionApiKey,
      redaction: config.piiRedaction,
    },
  );

  const app = createApp({ db, redis, config, logger, chatProvider });

  const server: Server = app.listen(config.port, () => {
    logger.info({ port: config.port }, 'api listening');
  });

  let shuttingDown = false;
  let transportRef: BufferedHttpTransport | null = transport;

  function shutdown(signal: string): void {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutdown initiated');

    // Hard-cap: if graceful drain takes > 10 s, force exit
    const timer = setTimeout(() => {
      logger.error('shutdown timeout — forcing exit');
      process.exit(1);
    }, 10_000);
    timer.unref();

    server.close(async () => {
      try {
        // Flush buffered inference logs before tearing down connections
        if (transportRef) {
          try {
            await transportRef.close();
          } catch (flushErr) {
            logger.warn({ err: flushErr }, 'transport flush error during shutdown — continuing');
          }
          transportRef = null;
        }
        redis.disconnect();
        await db.$client.end({ timeout: 5 });
        logger.info('shutdown complete');
        process.exit(0);
      } catch (err) {
        logger.error({ err }, 'error during shutdown');
        process.exit(1);
      }
    });
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('fatal startup error', err);
  process.exit(1);
});
