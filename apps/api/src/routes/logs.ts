import { Router } from 'express';
import { inferenceLogSchema } from '@ollive/shared';
import type { Redis } from '../redis.js';
import { AppError } from '../errors.js';
import { ingestionAuth } from '../middleware/ingestion-auth.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { redactInferenceLog } from '../ingestion/redaction.js';
import { xaddInferenceLog } from '../ingestion/stream.js';

export interface LogsRouterDeps {
  redis: Redis;
  ingestionApiKey: string;
  ingestionStreamMaxLen: number;
}

export function logsRouter(deps: LogsRouterDeps): Router {
  const router = Router();

  router.post('/logs', ingestionAuth(deps.ingestionApiKey), asyncHandler(async (req, res, next) => {
    try {
      const parsed = inferenceLogSchema.safeParse(req.body);
      if (!parsed.success) {
        return next(
          new AppError('validation_error', 'Invalid inference log payload', parsed.error.issues),
        );
      }

      const redacted = redactInferenceLog(parsed.data);
      await xaddInferenceLog(deps.redis, redacted, deps.ingestionStreamMaxLen);

      res.status(202).json({ accepted: true, requestId: req.requestId });
    } catch (err) {
      next(err);
    }
  }));

  return router;
}
