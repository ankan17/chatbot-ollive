import { Router } from 'express';
import type { Db } from '@ollive/db';
import type { Redis } from '../redis.js';

export interface HealthRouterDeps {
  db: Db;
  redis: Redis;
}

export function healthRouter(deps: HealthRouterDeps): Router {
  const router = Router();

  router.get('/healthz', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  router.get('/readyz', async (_req, res) => {
    const statuses = {
      db: 'ok' as 'ok' | 'error',
      redis: 'ok' as 'ok' | 'error',
    };

    try {
      await deps.db.$client`select 1`;
    } catch {
      statuses.db = 'error';
    }

    try {
      await deps.redis.ping();
    } catch {
      statuses.redis = 'error';
    }

    const httpStatus = statuses.db === 'ok' && statuses.redis === 'ok' ? 200 : 503;
    res.status(httpStatus).json(statuses);
  });

  return router;
}
