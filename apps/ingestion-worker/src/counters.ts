/** Mutable counters for observability (IN7, OB3). */
export interface Counters {
  processed: number;
  failed: number;
  dlq: number;
}

/** Creates a fresh zero-initialised counters object. */
export function createCounters(): Counters {
  return { processed: 0, failed: 0, dlq: 0 };
}
