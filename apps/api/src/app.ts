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
import { createAuthProvider, type AuthProvider } from './auth/provider.js';
import { createUserRepository } from './users/repository.js';
import { createConversationRepository } from './conversations/repository.js';
import { authRouter } from './routes/auth.js';
import { conversationsRouter } from './routes/conversations.js';
import { modelsRouter } from './routes/models.js';
import { chatRouter } from './routes/chat.js';
import { guestChatRouter } from './routes/guest.js';
import { metricsRouter } from './routes/metrics.js';
import type { LLMProvider } from '@ollive/llm-sdk';
// Import types.ts side-effect: augments Express.Request with req.user and req.guest
import './types.js';

export interface AppDeps {
  db: Db;
  redis: Redis;
  config: AppConfig;
  logger?: Logger;
  /** Optional injected AuthProvider (DI seam for tests — default: createAuthProvider(config)) */
  authProvider?: AuthProvider;
  /** Optional injected LLMProvider for chat (DI seam for tests — real provider wired in server.ts) */
  chatProvider?: LLMProvider;
}

export function createApp(deps: AppDeps): express.Express {
  const { db, redis, config } = deps;
  const logger = deps.logger ?? createLogger();
  const authProvider = deps.authProvider ?? createAuthProvider(config);
  const users = createUserRepository(db);
  const conversationRepo = createConversationRepository(db);

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

  // 8. Auth routes (Plan 4): /auth/google, /auth/google/callback, /auth/logout, /auth/me, /v1/session
  app.use(authRouter({ config, redis, users, authProvider }));

  // 9. Conversations CRUD + import router (Plan 4): mounted at /v1
  app.use('/v1', conversationsRouter({ config, conversations: conversationRepo }));

  // 9b. Available models (for the model switcher)
  app.use('/v1', modelsRouter({ config }));

  // 10. Chat + Guest SSE endpoints (Plan 5): only mounted when a provider is present
  if (deps.chatProvider) {
    app.use('/v1/conversations', chatRouter({ db, config, chatProvider: deps.chatProvider, logger }));
    app.use('/v1/guest', guestChatRouter({ redis, config, chatProvider: deps.chatProvider }));
  }

  // 11. Metrics endpoints (Plan 5): GET /v1/metrics/* — no provider needed
  app.use('/v1/metrics', metricsRouter({ db, config }));

  // 12. 404 fallback
  app.use((_req, _res, next) => {
    next(new AppError('not_found', 'Route not found'));
  });

  // 13. Centralized error handler — MUST be last
  app.use(errorHandler(logger));

  return app;
}
