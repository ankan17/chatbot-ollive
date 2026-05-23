import { request } from './http.js';
import type {
  OverviewMetrics,
  LatencySeries,
  ThroughputSeries,
  ErrorSeries,
  TokenSeries,
  MetricFilters,
} from './types.js';

type QueryRecord = Record<string, string | number | undefined>;

function filtersToQuery(f: MetricFilters): QueryRecord {
  return { from: f.from, to: f.to, provider: f.provider, model: f.model, bucket: f.bucket };
}

export function getOverview(f: MetricFilters, signal?: AbortSignal): Promise<OverviewMetrics> {
  return request<OverviewMetrics>('/v1/metrics/overview', { query: filtersToQuery(f), signal });
}

export function getLatency(f: MetricFilters, signal?: AbortSignal): Promise<LatencySeries> {
  return request<LatencySeries>('/v1/metrics/latency', { query: filtersToQuery(f), signal });
}

export function getThroughput(f: MetricFilters, signal?: AbortSignal): Promise<ThroughputSeries> {
  return request<ThroughputSeries>('/v1/metrics/throughput', { query: filtersToQuery(f), signal });
}

export function getErrors(f: MetricFilters, signal?: AbortSignal): Promise<ErrorSeries> {
  return request<ErrorSeries>('/v1/metrics/errors', { query: filtersToQuery(f), signal });
}

export function getTokens(f: MetricFilters, signal?: AbortSignal): Promise<TokenSeries> {
  return request<TokenSeries>('/v1/metrics/tokens', { query: filtersToQuery(f), signal });
}
