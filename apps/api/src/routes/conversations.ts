import { Router } from 'express';
import type { Db } from '@ollive/db';
import type { LLMProvider } from '@ollive/llm-sdk';
import type { AppConfig } from '../config.js';
import type { Logger } from '../logger.js';
import type { ConversationRepository } from '../conversations/repository.js';
import { requireAuth } from '../middleware/require-auth.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { AppError } from '../errors.js';
import { availableModelIds, providerForModel } from '../models/catalog.js';
import { generateAndPersistTitle } from '../chat/naming.js';
import {
  listConversationsQuerySchema,
  createConversationSchema,
  patchConversationSchema,
  importConversationSchema,
} from '../conversations/validation.js';

export interface ConversationsRouterDeps {
  config: AppConfig;
  conversations: ConversationRepository;
  db: Db;
  /** When present, an imported conversation is auto-named from its first exchange (PRD §7.1). */
  chatProvider?: LLMProvider;
  logger?: Logger;
}

export function conversationsRouter(deps: ConversationsRouterDeps): Router {
  const { config, conversations, db, chatProvider, logger } = deps;
  const router = Router();
  const auth = requireAuth({ config });

  // POST /v1/conversations/import — must be declared BEFORE /:id routes
  router.post('/conversations/import', auth, asyncHandler(async (req, res, next) => {
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
        provider: providerForModel(config.defaultModel, config) ?? 'google',
        model: config.defaultModel,
      });

      // Auto-name the imported conversation from its first exchange (PRD §7.1).
      // Awaited so the title is persisted before the client fetches the conversation;
      // generateAndPersistTitle swallows its own errors and leaves the default title.
      if (chatProvider) {
        const title = await generateAndPersistTitle(
          { db, provider: chatProvider, model: config.defaultModel, logger },
          detail.id,
        );
        if (title) detail.title = title;
      }

      return res.status(201).json(detail);
    } catch (err) {
      return next(err);
    }
  }));

  // GET /v1/conversations
  router.get('/conversations', auth, asyncHandler(async (req, res, next) => {
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
  }));

  // POST /v1/conversations
  router.post('/conversations', auth, asyncHandler(async (req, res, next) => {
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

      const resolvedModel = model ?? config.defaultModel;
      const conv = await conversations.create({
        userId,
        title,
        provider: providerForModel(resolvedModel, config) ?? 'google',
        model: resolvedModel,
      });

      return res.status(201).json(conv);
    } catch (err) {
      return next(err);
    }
  }));

  // GET /v1/conversations/:id
  router.get('/conversations/:id', auth, asyncHandler(async (req, res, next) => {
    try {
      const userId = req.user!.id;
      const { id } = req.params;

      const detail = await conversations.getWithMessages(userId, id);
      if (!detail) {
        return next(new AppError('not_found', 'Conversation not found'));
      }
      return res.json(detail);
    } catch (err) {
      return next(err);
    }
  }));

  // PATCH /v1/conversations/:id
  router.patch('/conversations/:id', auth, asyncHandler(async (req, res, next) => {
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

      const conv = await conversations.patch(userId, id, { title, status, model });
      if (!conv) {
        return next(new AppError('not_found', 'Conversation not found'));
      }
      return res.json(conv);
    } catch (err) {
      return next(err);
    }
  }));

  return router;
}
