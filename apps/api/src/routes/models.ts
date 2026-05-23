import { Router } from 'express';
import type { AppConfig } from '../config.js';
import { requireAuth } from '../middleware/require-auth.js';
import { availableModels } from '../models/catalog.js';
import type { ModelsResponse } from '@ollive/shared/api';

export interface ModelsRouterDeps {
  config: AppConfig;
}

export function modelsRouter(deps: ModelsRouterDeps): Router {
  const { config } = deps;
  const router = Router();
  const auth = requireAuth({ config });

  // GET /v1/models — models available from configured providers (Gemini today).
  router.get('/models', auth, (_req, res) => {
    const body: ModelsResponse = {
      models: availableModels(config),
      defaultModel: config.defaultModel,
    };
    res.json(body);
  });

  return router;
}
