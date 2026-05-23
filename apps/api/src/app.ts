import express from 'express';
import pinoHttp from 'pino-http';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import type { Db } from '@ollive/db';
import type { Redis } from './redis.js';
import type { AppConfig } from './config.js';
import { createLogger, type Logger } from './logger.js';
import { correlationId } from './middleware/correlation.js';
import { healthRouter } from './routes/health.js';
import { logsRouter } from './routes/logs.js';
import { AppError, errorHandler } from './errors.js';
// Import types.ts side-effect: augments Express.Request with req.user and req.guest
import './types.js';

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

  // 3. Cookie parser (no secret — cookies are signed individually by HMAC/JWT helpers)
  app.use(cookieParser());

  // 4. CORS — locked to WEB_ORIGIN with credentials (SE4)
  app.use(
    cors({
      origin: config.webOrigin,
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'DELETE'],
      allowedHeaders: ['content-type'],
    }),
  );

  // 5. Parse JSON bodies up to 1 MB
  app.use(express.json({ limit: '1mb' }));

  // 6. Health routes (liveness + readiness)
  app.use(healthRouter({ db, redis }));

  // 7. Ingestion receiver
  const logsRouterDeps = {
    redis,
    ingestionApiKey: config.ingestionApiKey,
    ingestionStreamMaxLen: config.ingestionStreamMaxLen,
  };
  app.use('/v1', logsRouter(logsRouterDeps));

  // FUTURE (Plan 4/5): auth, conversations, chat, and metrics routers mount here

  // 8. 404 fallback
  app.use((_req, _res, next) => {
    next(new AppError('not_found', 'Route not found'));
  });

  // 9. Centralized error handler — MUST be last
  app.use(errorHandler(logger));

  return app;
}
