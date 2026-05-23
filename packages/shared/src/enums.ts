import { z } from 'zod';

export const inferenceStatus = z.enum(['success', 'error', 'cancelled']);
export type InferenceStatus = z.infer<typeof inferenceStatus>;

export const messageRole = z.enum(['user', 'assistant', 'system']);
export type MessageRole = z.infer<typeof messageRole>;

export const conversationStatus = z.enum(['active', 'archived']);
export type ConversationStatus = z.infer<typeof conversationStatus>;

export const titleSource = z.enum(['default', 'auto', 'user']);
export type TitleSource = z.infer<typeof titleSource>;

export const errorCategory = z.enum([
  'rate_limit',
  'timeout',
  'auth',
  'content_filter',
  'other',
]);
export type ErrorCategory = z.infer<typeof errorCategory>;

export const messageStatus = z.enum(['complete', 'partial', 'error']);
export type MessageStatus = z.infer<typeof messageStatus>;
