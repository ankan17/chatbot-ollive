import express from 'express';
import pinoHttp from 'pino-http';
import type { Db } from '@ollive/db';
import type { Redis } from './redis.js';
import type { AppConfig } from './config.js';
import { createLogger, type Logger } from './logger.js';
import { correlationId } from './middleware/correlation.js';
import { healthRouter } from './routes/health.js';
import { logsRouter } from './routes/logs.js';
import { AppError, errorHandler } from './errors.js';

export interface AppDeps {
  db: Db;
  redis: Redis;
  config: AppConfig;
  logger?: Logger;
}

export function createApp(deps: AppDeps): express.Express {
  const { db, redis, config } = deps;
  const logger = deps.logger ?? createLogger();

  const app = express();

  // 1. Correlation id (sets req.requestId + x-request-id response header)
  app.use(correlationId());

  // 2. Structured HTTP logging via pino-http
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as express.Request).requestId ?? 'unknown',
    }),
  );

  // 3. Parse JSON bodies up to 1 MB
  app.use(express.json({ limit: '1mb' }));

  // 4. Health routes (liveness + readiness)
  app.use(healthRouter({ db, redis }));

  // 5. Ingestion receiver
  app.use('/v1', logsRouter({ redis, ingestionApiKey: config.ingestionApiKey, ingestionStreamMaxLen: config.ingestionStreamMaxLen }));

  // FUTURE (Plan 4/5): auth, conversations, chat, and metrics routers mount here

  // 6. 404 fallback
  app.use((_req, _res, next) => {
    next(new AppError('not_found', 'Route not found'));
  });

  // 7. Centralized error handler — MUST be last
  app.use(errorHandler(logger));

  return app;
}
