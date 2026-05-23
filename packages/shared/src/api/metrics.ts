import { z } from 'zod';
import type { ISOString } from './common.js';

// ---- Request schema (Zod) ----

export const metricsBucket = z.enum(['1m', '5m', '1h', '1d']);
export type MetricsBucket = z.infer<typeof metricsBucket>;

/** Shared query for all metrics endpoints (bucket honored only by series endpoints). */
export const metricsQuerySchema = z
  .object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    provider: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
    bucket: metricsBucket.default('1m'),
  })
  .refine((q) => !(q.from && q.to) || q.from <= q.to, { message: 'from must be <= to' });
export type MetricsQuery = z.infer<typeof metricsQuerySchema>;

// ---- Response types (TS types — RESOLUTION 3) ----

export interface MetricsRange {
  from: ISOString;
  to: ISOString;
}

/** GET /v1/metrics/overview */
export interface OverviewMetrics {
  range: MetricsRange;
  requests: number;
  errorRate: number;
  latencyMs: { p50: number; p95: number; p99: number };
  tokens: { prompt: number; completion: number; total: number };
  throughputPerMin: number;
}

// Series point shapes (authoritative):
export interface LatencyPoint {
  t: ISOString;
  p50: number;
  p95: number;
  p99: number;
  count: number;
}
export interface ThroughputPoint {
  t: ISOString;
  count: number;
}
export interface ErrorPoint {
  t: ISOString;
  count: number;
  errorCount: number;
  errorRate: number; // errorCount / count; 0 when count === 0
}
export interface TokenPoint {
  t: ISOString;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/** Common series envelope. */
export interface MetricsSeries<P> {
  bucket: MetricsBucket;
  series: P[];
}
export type LatencySeries = MetricsSeries<LatencyPoint>;
export type ThroughputSeries = MetricsSeries<ThroughputPoint>;
export type ErrorSeries = MetricsSeries<ErrorPoint>;
export type TokenSeries = MetricsSeries<TokenPoint>;
