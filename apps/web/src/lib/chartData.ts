import type { LatencyPoint, ThroughputPoint, ErrorPoint, TokenPoint, MetricsBucket } from '../api/types.js';

// ─── Row types ────────────────────────────────────────────────────────────────

export interface LatencyRow {
  t: string;
  label: string;
  p50: number;
  p95: number;
  p99: number;
}

export interface ThroughputRow {
  t: string;
  label: string;
  count: number;
}

export interface ErrorRow {
  t: string;
  label: string;
  errorRatePct: number;
}

export interface TokenRow {
  t: string;
  label: string;
  prompt: number;
  completion: number;
  total: number;
}

// ─── Tick formatter ───────────────────────────────────────────────────────────

/**
 * Format an ISO timestamp for chart X-axis ticks.
 * Intraday buckets (1m, 5m, 1h): HH:mm
 * Multi-day bucket (1d): MMM d  (e.g. "Jan 3")
 */
export function formatTick(iso: string, bucket: MetricsBucket): string {
  const d = new Date(iso);
  if (bucket === '1d') {
    // MMM d — e.g. "Jan 3"
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  // HH:mm (local time)
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

// ─── Number formatters ────────────────────────────────────────────────────────

/**
 * Format a token count.
 * ≥ 1,000,000: X.XM  (or XM if exact)
 * ≥ 1,000: X.XK      (or XK if exact)
 * else: as-is
 *
 * Examples: 856000 → "856K", 1840 → "1.8K", 1000000 → "1M", 1500000 → "1.5M"
 */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) {
    const v = n / 1_000_000;
    return v % 1 === 0 ? `${v}M` : `${parseFloat(v.toFixed(1))}M`;
  }
  if (n >= 1_000) {
    const v = n / 1_000;
    return v % 1 === 0 ? `${v}K` : `${parseFloat(v.toFixed(1))}K`;
  }
  return String(n);
}

/**
 * Format a 0–1 error rate as a percentage string.
 * 0.021 → "2.1%", 0 → "0%"
 */
export function formatPercent(rate: number): string {
  const pct = rate * 100;
  if (pct === 0) return '0%';
  // Strip trailing zeros
  return `${parseFloat(pct.toFixed(1))}%`;
}

// ─── Row mappers ──────────────────────────────────────────────────────────────

export function toLatencyRows(series: LatencyPoint[]): LatencyRow[] {
  return series.map((pt) => ({
    t: pt.t,
    label: formatTick(pt.t, '1m'), // label is formatted time; callers can re-format with bucket
    p50: pt.p50,
    p95: pt.p95,
    p99: pt.p99,
  }));
}

export function toThroughputRows(series: ThroughputPoint[]): ThroughputRow[] {
  return series.map((pt) => ({
    t: pt.t,
    label: formatTick(pt.t, '1m'),
    count: pt.count,
  }));
}

export function toErrorRows(series: ErrorPoint[]): ErrorRow[] {
  return series.map((pt) => ({
    t: pt.t,
    label: formatTick(pt.t, '1m'),
    errorRatePct: pt.errorRate * 100,
  }));
}

export function toTokenRows(series: TokenPoint[]): TokenRow[] {
  return series.map((pt) => ({
    t: pt.t,
    label: formatTick(pt.t, '1m'),
    prompt: pt.promptTokens,
    completion: pt.completionTokens,
    total: pt.totalTokens,
  }));
}
