import type { MetricsBucket } from '../api/types.js';
import type { MetricFilters } from '../api/types.js';

export type RangePreset = '1h' | '6h' | '24h' | '7d';

/** Returns { from, to } as ISO strings and bucket appropriate for the preset. */
export function presetToRange(
  preset: RangePreset,
  now: Date = new Date(),
): MetricFilters & { bucket: MetricsBucket } {
  const to = now.toISOString();

  const ms: Record<RangePreset, number> = {
    '1h': 60 * 60 * 1000,
    '6h': 6 * 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
  };

  const bucket: Record<RangePreset, MetricsBucket> = {
    '1h': '1m',
    '6h': '5m',
    '24h': '1h',
    '7d': '1h',
  };

  const from = new Date(now.getTime() - ms[preset]).toISOString();

  return { from, to, bucket: bucket[preset] };
}
