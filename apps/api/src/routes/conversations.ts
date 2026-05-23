import { Router } from 'express';
import type { AppConfig } from '../config.js';
import type { ConversationRepository } from '../conversations/repository.js';
import { requireAuth } from '../middleware/require-auth.js';
import { AppError } from '../errors.js';
import { availableModelIds } from '../models/catalog.js';
import {
  listConversationsQuerySchema,
  createConversationSchema,
  patchConversationSchema,
  importConversationSchema,
} from '../conversations/validation.js';

export interface ConversationsRouterDeps {
  config: AppConfig;
  conversations: ConversationRepository;
}

export function conversationsRouter(deps: ConversationsRouterDeps): Router {
  const { config, conversations } = deps;
  const router = Router();
  const auth = requireAuth({ config });

  // POST /v1/conversations/import — must be declared BEFORE /:id routes
  router.post('/conversations/import', auth, async (req, res, next) => {
    try {
      const parseResult = importConversationSchema.safeParse(req.body);
      if (!parseResult.success) {
        return next(new AppError('validation_error', 'Invalid import body', parseResult.error.issues));
      }
      const { clientConversationId, messages } = parseResult.data;
      const userId = req.user!.id;

      const detail = await conversations.importConversation({
        userId,
        clientConversationId,
        messages,
        provider: 'google',
        model: config.defaultModel,
      });

      return res.status(201).json(detail);
    } catch (err) {
      return next(err);
    }
  });

  // GET /v1/conversations
  router.get('/conversations', auth, async (req, res, next) => {
    try {
      const parseResult = listConversationsQuerySchema.safeParse(req.query);
      if (!parseResult.success) {
        return next(new AppError('validation_error', 'Invalid query params', parseResult.error.issues));
      }
      const { status, limit, cursor } = parseResult.data;
      const userId = req.user!.id;

      const page = await conversations.list({ userId, status, limit, cursor });
      return res.json(page);
    } catch (err) {
      return next(err);
    }
  });

  // POST /v1/conversations
  router.post('/conversations', auth, async (req, res, next) => {
    try {
      const parseResult = createConversationSchema.safeParse(req.body);
      if (!parseResult.success) {
        return next(new AppError('validation_error', 'Invalid body', parseResult.error.issues));
      }
      const { title, model } = parseResult.data;
      if (model && !availableModelIds(config).has(model)) {
        return next(new AppError('validation_error', `Unknown model: ${model}`));
      }
      const userId = req.user!.id;

      const conv = await conversations.create({
        userId,
        title,
        provider: 'google',
        model: model ?? config.defaultModel,
      });

      return res.status(201).json(conv);
    } catch (err) {
      return next(err);
    }
  });

  // GET /v1/conversations/:id
  router.get('/conversations/:id', auth, async (req, res, next) => {
    try {
      const userId = req.user!.id;
      const { id } = req.params;

      const detail = await conversations.getWithMessages(userId, id!);
      if (!detail) {
        return next(new AppError('not_found', 'Conversation not found'));
      }
      return res.json(detail);
    } catch (err) {
      return next(err);
    }
  });

  // PATCH /v1/conversations/:id
  router.patch('/conversations/:id', auth, async (req, res, next) => {
    try {
      const parseResult = patchConversationSchema.safeParse(req.body);
      if (!parseResult.success) {
        return next(new AppError('validation_error', 'Invalid body', parseResult.error.issues));
      }
      const { title, status, model } = parseResult.data;
      if (model && !availableModelIds(config).has(model)) {
        return next(new AppError('validation_error', `Unknown model: ${model}`));
      }
      const userId = req.user!.id;
      const { id } = req.params;

      const conv = await conversations.patch(userId, id!, { title, status, model });
      if (!conv) {
        return next(new AppError('not_found', 'Conversation not found'));
      }
      return res.json(conv);
    } catch (err) {
      return next(err);
    }
  });

  return router;
}
