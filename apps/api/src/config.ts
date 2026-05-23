import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  INGESTION_API_KEY: z.string().min(1),
  INGESTION_STREAM_MAXLEN: z.coerce.number().default(100000),
});

export interface AppConfig {
  port: number;
  databaseUrl: string;
  redisUrl: string;
  ingestionApiKey: string;
  ingestionStreamMaxLen: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const messages = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join(', ');
    throw new Error(`Invalid configuration: ${messages}`);
  }
  const data = result.data;
  return {
    port: data.PORT,
    databaseUrl: data.DATABASE_URL,
    redisUrl: data.REDIS_URL,
    ingestionApiKey: data.INGESTION_API_KEY,
    ingestionStreamMaxLen: data.INGESTION_STREAM_MAXLEN,
  };
}
