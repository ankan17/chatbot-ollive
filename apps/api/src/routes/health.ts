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
      db: 'ok' as 'ok' | 'down',
      redis: 'ok' as 'ok' | 'down',
    };

    try {
      await deps.db.$client`select 1`;
    } catch {
      statuses.db = 'down';
    }

    try {
      await deps.redis.ping();
    } catch {
      statuses.redis = 'down';
    }

    const httpStatus = statuses.db === 'ok' && statuses.redis === 'ok' ? 200 : 503;
    res.status(httpStatus).json(statuses);
  });

  return router;
}
