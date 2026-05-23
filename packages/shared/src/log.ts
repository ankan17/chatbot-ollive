import { z } from 'zod';
import { inferenceStatus } from './enums';

// Truncation to this length is enforced by the SDK and re-applied by the ingestion
// receiver — intentionally NOT a schema .max() constraint, so an over-long preview
// is truncated rather than rejected.
/** Max characters retained in input/output previews (PRD §9, A6). */
export const PREVIEW_MAX_CHARS = 500;

export const usageSchema = z.object({
  promptTokens: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
});
export type Usage = z.infer<typeof usageSchema>;

export const inferenceErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  providerCode: z.string().optional(),
});

/** The on-the-wire contract the SDK ships to POST /v1/logs (PRD §9). */
export const inferenceLogSchema = z.object({
  requestId: z.string().uuid(),
  timestamp: z.string().datetime(),
  provider: z.string().min(1),
  model: z.string().min(1),
  status: inferenceStatus,
  context: z
    .object({
      conversationId: z.string().uuid().optional(),
      messageId: z.string().uuid().optional(),
      userId: z.string().uuid().optional(),
    })
    .default({}),
  timing: z.object({
    startedAt: z.string().datetime(),
    completedAt: z.string().datetime(),
    latencyMs: z.number().int().nonnegative(),
    timeToFirstTokenMs: z.number().int().nonnegative().optional(),
  }),
  usage: usageSchema.nullable().optional(),
  preview: z
    .object({
      input: z.string().optional(),
      output: z.string().optional(),
    })
    .default({}),
  error: inferenceErrorSchema.nullable().default(null),
  metadata: z.record(z.unknown()).default({}),
});

export type InferenceLog = z.infer<typeof inferenceLogSchema>;
