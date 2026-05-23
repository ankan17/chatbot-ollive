import Redis from 'ioredis';
import { createDb, runMigrations } from '@ollive/db';
import { loadWorkerConfig } from './config.js';
import { createLogger } from './logger.js';
import { createCounters } from './counters.js';
import { ensureGroup, processBatch, reclaimStale } from './consumer.js';
import type { ConsumerDeps } from './consumer.js';

async function main(): Promise<void> {
  const config = loadWorkerConfig();
  const logger = createLogger();

  logger.info({ config: { ...config, databaseUrl: '[redacted]' } }, 'Starting ingestion worker');

  // Migrate on startup (idempotent, DE3)
  await runMigrations(config.databaseUrl);
  logger.info('Migrations applied');

  // Build dependencies
  const db = createDb(config.databaseUrl);
  const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
  const counters = createCounters();

  // Ensure consumer group exists
  await ensureGroup(redis, logger);

  // Write readiness file so the compose healthcheck can detect startup (DE4)
  const { writeFile } = await import('node:fs/promises');
  await writeFile('/tmp/worker-ready', '').catch(() => {
    // Non-fatal: healthcheck will retry; worker still runs
  });

  const deps: ConsumerDeps = {
    redis,
    db,
    logger,
    counters,
    consumerName: config.consumerName,
    batchSize: config.batchSize,
    blockMs: config.blockMs,
    maxDeliveries: config.maxDeliveries,
    claimIdleMs: config.claimIdleMs,
  };

  // Readiness heartbeat (DE4)
  logger.info(
    {
      consumerName: config.consumerName,
      batchSize: config.batchSize,
      blockMs: config.blockMs,
      maxDeliveries: config.maxDeliveries,
      claimIdleMs: config.claimIdleMs,
    },
    'ingestion worker ready',
  );

  let running = true;
  let lastReclaimAt = Date.now();
  let lastCounterLogAt = Date.now();
  const COUNTER_LOG_INTERVAL_MS = 30_000;

  // Graceful shutdown
  let shutdownCalled = false;
  function shutdown(signal: string): void {
    if (shutdownCalled) return;
    shutdownCalled = true;
    running = false;
    logger.info({ signal }, 'Shutdown signal received; draining...');

    // Hard-cap timer — unref so it does not prevent clean exit
    const hardCap = setTimeout(() => {
      logger.error('Graceful shutdown timed out; forcing exit');
      process.exit(1);
    }, 10_000);
    hardCap.unref();

    Promise.all([
      Promise.resolve(redis.disconnect()),
      db.$client.end({ timeout: 5 }),
    ])
      .then(() => {
        logger.info('Shutdown complete');
        process.exit(0);
      })
      .catch((err) => {
        logger.error({ err }, 'Error during shutdown');
        process.exit(1);
      });
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Run loop
  while (running) {
    try {
      await processBatch(deps);

      const now = Date.now();

      // Periodically reclaim stale pending entries
      if (now - lastReclaimAt >= config.claimIdleMs) {
        const reclaimed = await reclaimStale(deps);
        if (reclaimed > 0) {
          logger.info({ reclaimed }, 'Reclaimed stale pending entries');
        }
        lastReclaimAt = now;
      }

      // Periodic counter log (IN7/OB3)
      if (now - lastCounterLogAt >= COUNTER_LOG_INTERVAL_MS) {
        logger.info({ counters }, 'Ingestion worker counters');
        lastCounterLogAt = now;
      }
    } catch (err) {
      logger.error({ err }, 'Unhandled error in run loop; backing off 1s');
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

main().catch((err) => {
   
  console.error('Fatal error:', err);
  process.exit(1);
});
