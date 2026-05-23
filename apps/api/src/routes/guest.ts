import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import type { Redis } from '../redis.js';
import type { AppConfig } from '../config.js';
import type { LLMProvider } from '@ollive/llm-sdk';
import { guestSession } from '../middleware/guest-session.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { checkAndIncrementGuest } from '../guest/counter.js';
import { AppError } from '../errors.js';
import { guestMessageSchema } from '@ollive/shared/api';
import { buildContext, RESPONSE_RESERVE_TOKENS } from '../chat/tokens.js';
import { runChatStream } from '../chat/run-chat.js';

export interface GuestChatRouterDeps {
  redis: Redis;
  config: AppConfig;
  chatProvider: LLMProvider;
}

export function guestChatRouter(deps: GuestChatRouterDeps): Router {
  const { redis, config } = deps;
  const router = Router();
  const guest = guestSession({ config });

  router.post('/messages', guest, asyncHandler(async (req, res, next) => {
    try {
      const parseResult = guestMessageSchema.safeParse(req.body);
      if (!parseResult.success) {
        return next(new AppError('validation_error', 'Invalid request body', parseResult.error.issues));
      }
      const body = parseResult.data;

      const guestId = req.guest!.id;
      // Increment before streaming intentionally (anti-abuse: an in-flight or failed call
      // still counts against the cap; a guest cannot bypass the limit by aborting mid-stream).
      const { allowed, remaining } = await checkAndIncrementGuest(
        redis,
        guestId,
        config.guestMessageLimit,
        config.guestSessionTtl,
      );

      if (!allowed) {
        return res.status(403).json({ error: 'login_required', remaining });
      }

      const requestId = randomUUID();
      const history = body.messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));
      const ctx = buildContext(
        [...history, { role: 'user' as const, content: body.content }],
        config.contextTokenBudget,
        RESPONSE_RESERVE_TOKENS,
      );
      const chatRequest = { model: config.defaultModel, messages: ctx.messages };
      const callContext = {
        metadata: {
          guestSessionId: guestId,
          contextMessages: ctx.contextMessageCount,
          contextTokens: ctx.contextTokens,
        },
      };

      await runChatStream({
        req,
        res,
        provider: deps.chatProvider,
        chatRequest,
        context: callContext,
        messageId: null,
        requestId,
        // Guest chats are ephemeral — no DB persistence on stream lifecycle.
        async onComplete() { /* no-op */ },
        async onCancel() { /* no-op */ },
        async onError() { /* no-op */ },
      });
    } catch (err) {
      return next(err);
    }
  }));

  return router;
}
