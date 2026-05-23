import { runMigrations, createDb } from '@ollive/db';
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { createRedis } from './redis.js';
import { createApp } from './app.js';
import type { Server } from 'node:http';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger();

  logger.info('running database migrations...');
  await runMigrations(config.databaseUrl);
  logger.info('migrations applied');

  const db = createDb(config.databaseUrl);
  const redis = createRedis(config.redisUrl);
  const app = createApp({ db, redis, config, logger });

  const server: Server = app.listen(config.port, () => {
    logger.info({ port: config.port }, 'api listening');
  });

  let shuttingDown = false;

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
