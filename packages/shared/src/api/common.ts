import { z } from 'zod';
import { usageSchema } from '../log.js';
import type { Usage } from '../log.js';

/** ISO-8601 UTC timestamp string (serialized from timestamptz). */
export type ISOString = string;

// Re-export the canonical token-usage shape (already defined in log.ts) so chat/metrics share it.
export { usageSchema };
export type { Usage };

/** Opaque keyset cursor (the last item's id). Clients treat it as a black box. */
export const cursorSchema = z.string().min(1);

/** Generic page wrapper used by list endpoints. */
export interface Page<T> {
  items: T[];
  nextCursor: string | null; // always present; null on the last page
}
