import { z } from 'zod';
import { conversationStatus } from '../enums.js';
import type { ISOString, Page } from './common.js';

// ---- Response DTOs (TS types) ----

/** List item — NO messages, NO title_source (RESOLUTION 1). */
export interface ConversationSummary {
  id: string;
  title: string;
  status: 'active' | 'archived';
  provider: string;
  model: string;
  createdAt: ISOString;
  updatedAt: ISOString;
}

/** Full conversation header (POST/PATCH responses) — same fields as the summary. */
export type Conversation = ConversationSummary;

/** A persisted message (RESOLUTION 2). tokenCount omitted for user messages. */
export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  tokenCount?: number;                       // omitted when unknown / for user messages
  status: 'complete' | 'partial' | 'error';
  sequence: number;
  errorMessage?: string;                     // user-facing reason; present only on failed turns
  createdAt: ISOString;
}

/** GET /v1/conversations/:id and POST /v1/conversations/import → full detail. */
export interface ConversationDetail extends Conversation {
  messages: Message[];
}

/** GET /v1/conversations → page of summaries. */
export type ConversationListPage = Page<ConversationSummary>; // { items, nextCursor: string | null }

// ---- Request schemas (Zod) ----

/** GET /v1/conversations query. */
export const listConversationsQuerySchema = z.object({
  status: conversationStatus.default('active'),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).optional(),
});
export type ListConversationsQuery = z.infer<typeof listConversationsQuerySchema>;

/** POST /v1/conversations body. */
export const createConversationSchema = z.object({
  title: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
});
export type CreateConversationBody = z.infer<typeof createConversationSchema>;

/** PATCH /v1/conversations/:id body (at least one field). */
export const patchConversationSchema = z
  .object({
    title: z.string().min(1).optional(),
    status: conversationStatus.optional(),
    model: z.string().min(1).optional(),
  })
  .refine((b) => b.title !== undefined || b.status !== undefined || b.model !== undefined, {
    message: 'at least one of title, status, or model is required',
  });
export type PatchConversationBody = z.infer<typeof patchConversationSchema>;

/** A single buffered guest message for import (role limited to user/assistant). */
export const importMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1),
});

/** POST /v1/conversations/import body (RESOLUTION 7). */
export const importConversationSchema = z.object({
  clientConversationId: z.string().min(1).max(200).optional(),
  messages: z.array(importMessageSchema).min(1),
});
export type ImportConversationBody = z.infer<typeof importConversationSchema>;
