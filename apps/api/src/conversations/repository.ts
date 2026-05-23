/**
 * Conversation repository — all DB access, user-scoped (SE8).
 */
import { eq, and, sql, lt, or, desc } from 'drizzle-orm';
import { conversations, messages } from '@ollive/db';
import type { Db } from '@ollive/db';
import type {
  ConversationListPage,
  Conversation,
  ConversationDetail,
  ImportConversationBody,
} from '@ollive/shared/api';
import {
  toConversationSummary,
  toConversation,
  toConversationDetail,
  type ConversationRow,
  type MessageRow,
} from './serialize.js';

export interface ListConversationsParams {
  userId: string;
  status: 'active' | 'archived';
  limit: number;
  cursor?: string;
}

export interface CreateConversationInput {
  userId: string;
  title?: string;
  provider: string;
  model: string;
}

export interface PatchConversationInput {
  title?: string;
  status?: 'active' | 'archived';
  model?: string;
}

export interface ImportConversationInput {
  userId: string;
  clientConversationId?: string;
  messages: ImportConversationBody['messages'];
  provider: string;
  model: string;
}

export interface ConversationRepository {
  list(p: ListConversationsParams): Promise<ConversationListPage>;
  create(input: CreateConversationInput): Promise<Conversation>;
  getWithMessages(userId: string, id: string): Promise<ConversationDetail | null>;
  patch(userId: string, id: string, input: PatchConversationInput): Promise<Conversation | null>;
  importConversation(input: ImportConversationInput): Promise<ConversationDetail>;
}

export function createConversationRepository(db: Db): ConversationRepository {
  return {
    async list(p: ListConversationsParams): Promise<ConversationListPage> {
      const { userId, status, limit, cursor } = p;
      const fetchLimit = limit + 1;

      let query = db
        .select({
          id: conversations.id,
          title: conversations.title,
          status: conversations.status,
          provider: conversations.provider,
          model: conversations.model,
          createdAt: conversations.createdAt,
          updatedAt: conversations.updatedAt,
        })
        .from(conversations)
        .where(
          and(
            eq(conversations.userId, userId),
            eq(conversations.status, status),
            // Cursor-based pagination: if cursor provided, fetch rows after the cursor item
            cursor
              ? sql`(${conversations.updatedAt}, ${conversations.id}) < (
                  SELECT updated_at, id FROM conversations WHERE id = ${cursor} AND user_id = ${userId}
                )`
              : undefined,
          ),
        )
        .orderBy(desc(conversations.updatedAt), desc(conversations.id))
        .limit(fetchLimit);

      const rows = await query;

      const hasMore = rows.length > limit;
      const items = hasMore ? rows.slice(0, limit) : rows;
      const nextCursor = hasMore ? (items[items.length - 1]!.id) : null;

      return {
        items: items.map((r) =>
          toConversationSummary({
            ...r,
            status: r.status,
            createdAt: r.createdAt,
            updatedAt: r.updatedAt,
          } as ConversationRow),
        ),
        nextCursor,
      };
    },

    async create(input: CreateConversationInput): Promise<Conversation> {
      const now = new Date();
      const rows = await db
        .insert(conversations)
        .values({
          userId: input.userId,
          title: input.title ?? 'New conversation',
          titleSource: 'default',
          status: 'active',
          provider: input.provider,
          model: input.model,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      const row = rows[0]!;
      return toConversation(row as unknown as ConversationRow);
    },

    async getWithMessages(userId: string, id: string): Promise<ConversationDetail | null> {
      const convRows = await db
        .select()
        .from(conversations)
        .where(and(eq(conversations.id, id), eq(conversations.userId, userId)))
        .limit(1);

      if (convRows.length === 0) return null;

      const conv = convRows[0]!;
      // Safe: conv is already user-scoped (fetched above with eq(userId)), so any messages
      // belonging to this conversation ID are guaranteed to belong to the requesting user.
      const msgRows = await db
        .select()
        .from(messages)
        .where(eq(messages.conversationId, id))
        .orderBy(messages.sequence);

      return toConversationDetail(
        conv as unknown as ConversationRow,
        msgRows as unknown as MessageRow[],
      );
    },

    async patch(
      userId: string,
      id: string,
      input: PatchConversationInput,
    ): Promise<Conversation | null> {
      const updates: Record<string, unknown> = {
        updatedAt: new Date(),
      };

      if (input.title !== undefined) {
        updates['title'] = input.title;
        updates['titleSource'] = 'user'; // FR18 — rename sets title_source='user'
      }
      if (input.status !== undefined) {
        updates['status'] = input.status;
      }
      if (input.model !== undefined) {
        updates['model'] = input.model;
      }

      const rows = await db
        .update(conversations)
        .set(updates)
        .where(and(eq(conversations.id, id), eq(conversations.userId, userId)))
        .returning();

      if (rows.length === 0) return null;
      return toConversation(rows[0]! as unknown as ConversationRow);
    },

    async importConversation(input: ImportConversationInput): Promise<ConversationDetail> {
      const { userId, clientConversationId, messages: msgs, provider, model } = input;

      // Step 1: If clientConversationId provided, check for existing conversation
      if (clientConversationId) {
        const existing = await db
          .select()
          .from(conversations)
          .where(
            and(
              eq(conversations.userId, userId),
              eq(conversations.clientConversationId, clientConversationId),
            ),
          )
          .limit(1);

        if (existing.length > 0) {
          const conv = existing[0]!;
          const msgRows = await db
            .select()
            .from(messages)
            .where(eq(messages.conversationId, conv.id))
            .orderBy(messages.sequence);

          return toConversationDetail(
            conv as unknown as ConversationRow,
            msgRows as unknown as MessageRow[],
          );
        }
      }

      // Step 2: Insert new conversation
      const now = new Date();
      let conv: typeof conversations.$inferSelect | undefined;

      const insertedRows = await db
        .insert(conversations)
        .values({
          userId,
          title: 'New conversation',
          titleSource: 'default',
          status: 'active',
          provider,
          model,
          clientConversationId: clientConversationId ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .returning();

      if (insertedRows.length > 0) {
        conv = insertedRows[0]!;
      } else if (clientConversationId) {
        // Conflict occurred (concurrent insert) — re-select the existing row
        const existing = await db
          .select()
          .from(conversations)
          .where(
            and(
              eq(conversations.userId, userId),
              eq(conversations.clientConversationId, clientConversationId),
            ),
          )
          .limit(1);

        if (existing.length > 0) {
          conv = existing[0]!;
          // Return existing with its messages
          const msgRows = await db
            .select()
            .from(messages)
            .where(eq(messages.conversationId, conv.id))
            .orderBy(messages.sequence);

          return toConversationDetail(
            conv as unknown as ConversationRow,
            msgRows as unknown as MessageRow[],
          );
        }
      }

      if (!conv) {
        throw new Error('Failed to create or retrieve conversation for import');
      }

      // Step 3: Insert messages with sequences 1..N
      const messageValues = msgs.map((msg, i) => ({
        conversationId: conv!.id,
        role: msg.role,
        content: msg.content,
        sequence: i + 1,
        status: 'complete' as const,
        tokenCount: null,
        createdAt: now,
      }));

      const insertedMessages = await db.insert(messages).values(messageValues).returning();

      return toConversationDetail(
        conv as unknown as ConversationRow,
        insertedMessages as unknown as MessageRow[],
      );
    },
  };
}
