import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { eq, and, max } from 'drizzle-orm';
import type { Db } from '@ollive/db';
import { conversations, messages } from '@ollive/db';
import type { LLMProvider } from '@ollive/llm-sdk';
import type { AppConfig } from '../config.js';
import type { Logger } from '../logger.js';
import { requireAuth } from '../middleware/require-auth.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { AppError } from '../errors.js';
import { chatMessageSchema } from '@ollive/shared/api';
import { buildContext, estimateTokens, RESPONSE_RESERVE_TOKENS } from '../chat/tokens.js';
import { runChatStream } from '../chat/run-chat.js';
import { generateAndPersistTitle } from '../chat/naming.js';

export interface ChatRouterDeps {
  db: Db;
  config: AppConfig;
  chatProvider: LLMProvider;
  logger?: Logger;
}

export function chatRouter(deps: ChatRouterDeps): Router {
  const { db, config } = deps;
  const router = Router();
  const auth = requireAuth({ config });

  router.post('/:id/messages', auth, asyncHandler(async (req, res, next) => {
    try {
      const parseResult = chatMessageSchema.safeParse(req.body);
      if (!parseResult.success) {
        return next(new AppError('validation_error', 'Invalid request body', parseResult.error.issues));
      }
      const body = parseResult.data;

      const userId = req.user!.id;
      const convId = req.params.id;

      // Load + scope: only the owning user can chat in this conversation (SE8)
      const convRows = await db
        .select()
        .from(conversations)
        .where(and(eq(conversations.id, convId), eq(conversations.userId, userId)))
        .limit(1);

      if (convRows.length === 0) {
        return next(new AppError('not_found', 'Conversation not found'));
      }
      const conv = convRows[0];

      // Load history (all messages, ordered)
      const historyRows = await db
        .select({ role: messages.role, content: messages.content })
        .from(messages)
        .where(eq(messages.conversationId, convId))
        .orderBy(messages.sequence);

      // Insert user + pre-create assistant message atomically
      const { asstMsgId, maxSeq } = await db.transaction(async (tx) => {
        // Get current max sequence
        const seqResult = await tx
          .select({ maxSeq: max(messages.sequence) })
          .from(messages)
          .where(eq(messages.conversationId, convId));

        const currentMaxSeq = seqResult[0]?.maxSeq ?? 0;

        // Insert user message
        await tx.insert(messages).values({
          conversationId: convId,
          role: 'user',
          content: body.content,
          sequence: currentMaxSeq + 1,
          status: 'complete',
        });

        // Pre-create assistant message (partial)
        const asstRows = await tx
          .insert(messages)
          .values({
            conversationId: convId,
            role: 'assistant',
            content: '',
            sequence: currentMaxSeq + 2,
            status: 'partial',
          })
          .returning({ id: messages.id });

        return { asstMsgId: asstRows[0].id, maxSeq: currentMaxSeq };
      });

      const requestId = randomUUID();
      const ctx = buildContext(
        [...historyRows.map((r) => ({ role: r.role as 'user' | 'assistant' | 'system', content: r.content })), { role: 'user' as const, content: body.content }],
        config.contextTokenBudget,
        RESPONSE_RESERVE_TOKENS,
      );
      const chatRequest = { model: conv.model, messages: ctx.messages };
      const callContext = {
        conversationId: conv.id,
        messageId: asstMsgId,
        userId,
        metadata: {
          contextMessages: ctx.contextMessageCount,
          contextTokens: ctx.contextTokens,
        },
      };
      const isFirstResponse = maxSeq === 0;

      await runChatStream({
        req,
        res,
        provider: deps.chatProvider,
        chatRequest,
        context: callContext,
        messageId: asstMsgId,
        requestId,
        async onComplete({ content, usage, finishReason: _finishReason }) {
          await db
            .update(messages)
            .set({
              content,
              // fall back to the heuristic estimate when the provider reports 0 or no completion tokens (Plan 5 Task 6)
              tokenCount: usage.completionTokens || estimateTokens(content),
              status: 'complete',
            })
            .where(eq(messages.id, asstMsgId));
          await db
            .update(conversations)
            .set({ updatedAt: new Date() })
            .where(eq(conversations.id, conv.id));
        },
        async onAfterDone({ title: emitTitle }) {
          // On the first response, generate + persist the title AFTER done (so the
          // client already re-enabled the composer), then push it over the stream.
          if (!isFirstResponse) return;
          const title = await generateAndPersistTitle(
            { db, provider: deps.chatProvider, model: conv.model, logger: deps.logger },
            conv.id,
          );
          if (title) emitTitle({ conversationId: conv.id, title });
        },
        async onCancel({ content }) {
          await db
            .update(messages)
            .set({ content, status: 'partial' })
            .where(eq(messages.id, asstMsgId));
        },
        async onError({ content, message }) {
          await db
            .update(messages)
            .set({ content, status: 'error', errorMessage: message })
            .where(eq(messages.id, asstMsgId));
        },
      });
    } catch (err) {
      return next(err);
    }
  }));

  return router;
}
