import { z } from 'zod';
import { usageSchema } from './common.js';
import type { Usage } from './common.js';

// ---- Request schemas (Zod) ----

/** POST /v1/conversations/:id/messages body. */
export const chatMessageSchema = z.object({
  content: z.string().min(1),
});
export type ChatMessageBody = z.infer<typeof chatMessageSchema>;

/** A turn the guest client holds locally and replays each request. */
export const guestTurnSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
});

/** POST /v1/guest/messages body (length-bounded history + new message). */
export const guestMessageSchema = z.object({
  messages: z.array(guestTurnSchema).max(50), // bounded; effective cap is GUEST_MESSAGE_LIMIT
  content: z.string().min(1),
});
export type GuestMessageBody = z.infer<typeof guestMessageSchema>;

// ---- SSE event payload types (TS types — RESOLUTION 4) ----

/** `start` — once, first. messageId is null for guest chat. */
export interface SseStartData {
  messageId: string | null;
  requestId: string;
}

/** `token` — zero or more. */
export interface SseTokenData {
  delta: string;
}

/** `done` — terminal on success. usage is ALWAYS present. */
export interface SseDoneData {
  messageId: string | null;
  finishReason: string; // 'stop' | 'length' | 'content_filter' | 'error' | 'cancelled'
  usage: Usage;
}

/** `error` — terminal on a mid-stream failure. */
export interface SseErrorData {
  code: 'rate_limited' | 'provider_timeout' | 'provider_error' | 'internal_error';
  message: string;
}

export type SseEvent =
  | { event: 'start'; data: SseStartData }
  | { event: 'token'; data: SseTokenData }
  | { event: 'done'; data: SseDoneData }
  | { event: 'error'; data: SseErrorData };

// Re-export for convenience
export { usageSchema };
export type { Usage };
