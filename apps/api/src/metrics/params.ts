import { metricsQuerySchema, type MetricsBucket } from '@ollive/shared/api';

export interface MetricFilters {
  from: Date;
  to: Date;
  provider?: string;
  model?: string;
  bucket: MetricsBucket;
  userId: string;
}

export function bucketToInterval(b: MetricsBucket): string {
  switch (b) {
    case '1m': return '1 minute';
    case '5m': return '5 minutes';
    case '1h': return '1 hour';
    case '1d': return '1 day';
  }
}

/**
 * Parse and validate query params into typed MetricFilters.
 * userId is always injected from the trusted auth context — never from query (SE8).
 */
export function parseMetricQuery(query: unknown, userId: string): MetricFilters {
  // metricsQuerySchema throws on invalid input (Zod parse)
  const parsed = metricsQuerySchema.parse(query);

  const to = parsed.to ?? new Date();
  const from = parsed.from ?? new Date(to.getTime() - 24 * 60 * 60 * 1000);

  return {
    from,
    to,
    provider: parsed.provider,
    model: parsed.model,
    bucket: parsed.bucket,
    userId,
  };
}
