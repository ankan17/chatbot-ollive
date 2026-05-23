import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  WORKER_CONSUMER_NAME: z.string().min(1).default('worker-1'),
  WORKER_BATCH_SIZE: z.coerce.number().int().positive().default(50),
  WORKER_BLOCK_MS: z.coerce.number().int().nonnegative().default(5000),
  // maxDeliveries: total delivery attempts before routing to DLQ. With the default (3),
  // an entry gets ~2 real attempts: 1 in processBatch (deliveries=1) and 1 in reclaimStale
  // (deliveries=maxDeliveries), which immediately DLQs still-failing entries on the reclaim cycle.
  WORKER_MAX_DELIVERIES: z.coerce.number().int().positive().default(3),
  WORKER_CLAIM_IDLE_MS: z.coerce.number().int().positive().default(30000),
});

export interface WorkerConfig {
  databaseUrl: string;
  redisUrl: string;
  consumerName: string;
  batchSize: number;
  blockMs: number;
  maxDeliveries: number;
  claimIdleMs: number;
}

export function loadWorkerConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const messages = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Worker config validation failed: ${messages}`);
  }
  const data = result.data;
  return {
    databaseUrl: data.DATABASE_URL,
    redisUrl: data.REDIS_URL,
    consumerName: data.WORKER_CONSUMER_NAME,
    batchSize: data.WORKER_BATCH_SIZE,
    blockMs: data.WORKER_BLOCK_MS,
    maxDeliveries: data.WORKER_MAX_DELIVERIES,
    claimIdleMs: data.WORKER_CLAIM_IDLE_MS,
  };
}
