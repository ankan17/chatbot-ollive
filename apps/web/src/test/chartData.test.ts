import { describe, it, expect } from 'vitest';
import {
  toLatencyRows,
  toThroughputRows,
  toErrorRows,
  toTokenRows,
  formatTokens,
  formatPercent,
  formatTick,
} from '../lib/chartData.js';
import { presetToRange } from '../lib/time.js';

// ─── toLatencyRows ────────────────────────────────────────────────────────────

describe('toLatencyRows', () => {
  it('empty series returns []', () => {
    expect(toLatencyRows([])).toEqual([]);
  });

  it('2-pt series preserves p50/p95/p99 and t, adds label', () => {
    const rows = toLatencyRows([
      { t: '2026-05-23T10:00:00.000Z', p50: 120, p95: 250, p99: 400, count: 10 },
      { t: '2026-05-23T10:01:00.000Z', p50: 130, p95: 260, p99: 410, count: 12 },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0].p50).toBe(120);
    expect(rows[0].p95).toBe(250);
    expect(rows[0].p99).toBe(400);
    expect(rows[0].t).toBe('2026-05-23T10:00:00.000Z');
    expect(typeof rows[0].label).toBe('string');
    expect(rows[0].label.length).toBeGreaterThan(0);
    expect(rows[1].p50).toBe(130);
  });

  it('does NOT include count in the output row', () => {
    const rows = toLatencyRows([
      { t: '2026-05-23T10:00:00.000Z', p50: 100, p95: 200, p99: 300, count: 5 },
    ]);
    expect((rows[0] as unknown as Record<string, unknown>).count).toBeUndefined();
  });

  it('1d bucket yields a date-style label, not HH:mm', () => {
    const rows = toLatencyRows(
      [{ t: '2026-05-23T10:00:00.000Z', p50: 100, p95: 200, p99: 300, count: 5 }],
      '1d',
    );
    expect(rows[0].label).not.toMatch(/^\d{2}:\d{2}$/);
    expect(rows[0].label).toMatch(/[A-Z][a-z]+\s+\d+/);
  });

  it('intraday bucket (1m) yields HH:mm label', () => {
    const rows = toLatencyRows(
      [{ t: '2026-05-23T10:00:00.000Z', p50: 100, p95: 200, p99: 300, count: 5 }],
      '1m',
    );
    expect(rows[0].label).toMatch(/^\d{2}:\d{2}$/);
  });
});

// ─── toThroughputRows ─────────────────────────────────────────────────────────

describe('toThroughputRows', () => {
  it('passes through count, no perMin field', () => {
    const rows = toThroughputRows([
      { t: '2026-05-23T10:00:00.000Z', count: 42 },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(42);
    expect((rows[0] as unknown as Record<string, unknown>).perMin).toBeUndefined();
  });

  it('empty series returns []', () => {
    expect(toThroughputRows([])).toEqual([]);
  });

  it('1d bucket yields a date-style label', () => {
    const rows = toThroughputRows([{ t: '2026-05-23T10:00:00.000Z', count: 5 }], '1d');
    expect(rows[0].label).not.toMatch(/^\d{2}:\d{2}$/);
    expect(rows[0].label).toMatch(/[A-Z][a-z]+\s+\d+/);
  });
});

// ─── toErrorRows ──────────────────────────────────────────────────────────────

describe('toErrorRows', () => {
  it('converts errorRate 0.021 → errorRatePct ≈ 2.1', () => {
    const rows = toErrorRows([
      { t: '2026-05-23T10:00:00.000Z', count: 100, errorCount: 2, errorRate: 0.021 },
    ]);
    expect(rows[0].errorRatePct).toBeCloseTo(2.1, 5);
  });

  it('errorRate 0 → errorRatePct 0', () => {
    const rows = toErrorRows([
      { t: '2026-05-23T10:00:00.000Z', count: 100, errorCount: 0, errorRate: 0 },
    ]);
    expect(rows[0].errorRatePct).toBe(0);
  });

  it('empty series returns []', () => {
    expect(toErrorRows([])).toEqual([]);
  });
});

// ─── toTokenRows ──────────────────────────────────────────────────────────────

describe('toTokenRows', () => {
  it('maps promptTokens→prompt, completionTokens→completion, totalTokens→total', () => {
    const rows = toTokenRows([
      { t: '2026-05-23T10:00:00.000Z', promptTokens: 500, completionTokens: 200, totalTokens: 700 },
    ]);
    expect(rows[0].prompt).toBe(500);
    expect(rows[0].completion).toBe(200);
    expect(rows[0].total).toBe(700);
  });

  it('empty series returns []', () => {
    expect(toTokenRows([])).toEqual([]);
  });
});

// ─── formatTokens ─────────────────────────────────────────────────────────────

describe('formatTokens', () => {
  it('856000 → "856K"', () => {
    expect(formatTokens(856_000)).toBe('856K');
  });

  it('1840 → "1.8K"', () => {
    expect(formatTokens(1840)).toBe('1.8K');
  });

  it('1000 → "1K" (exact thousands)', () => {
    expect(formatTokens(1000)).toBe('1K');
  });

  it('small values unabbreviated', () => {
    expect(formatTokens(999)).toBe('999');
    expect(formatTokens(0)).toBe('0');
  });

  it('1500000 → "1.5M"', () => {
    expect(formatTokens(1_500_000)).toBe('1.5M');
  });

  it('1000000 → "1M" (exact million)', () => {
    expect(formatTokens(1_000_000)).toBe('1M');
  });
});

// ─── formatPercent ────────────────────────────────────────────────────────────

describe('formatPercent', () => {
  it('0.021 → "2.1%"', () => {
    expect(formatPercent(0.021)).toBe('2.1%');
  });

  it('0 → "0%"', () => {
    expect(formatPercent(0)).toBe('0%');
  });

  it('1 → "100%"', () => {
    expect(formatPercent(1)).toBe('100%');
  });

  it('0.5 → "50%"', () => {
    expect(formatPercent(0.5)).toBe('50%');
  });
});

// ─── formatTick ───────────────────────────────────────────────────────────────

describe('formatTick', () => {
  // Use a fixed UTC-based timestamp: 2026-05-23T14:05:00.000Z
  const iso = '2026-05-23T14:05:00.000Z';

  it('intraday bucket (1m) → HH:mm format', () => {
    const label = formatTick(iso, '1m');
    // Should look like "HH:mm" — two digits colon two digits
    expect(label).toMatch(/^\d{2}:\d{2}$/);
  });

  it('intraday bucket (5m) → HH:mm format', () => {
    const label = formatTick(iso, '5m');
    expect(label).toMatch(/^\d{2}:\d{2}$/);
  });

  it('intraday bucket (1h) → HH:mm format', () => {
    const label = formatTick(iso, '1h');
    expect(label).toMatch(/^\d{2}:\d{2}$/);
  });

  it('multi-day bucket (1d) → "MMM d" date label', () => {
    const label = formatTick(iso, '1d');
    // Should NOT be HH:mm pattern — should be a date like "May 23"
    expect(label).not.toMatch(/^\d{2}:\d{2}$/);
    // Should contain a month abbreviation
    expect(label).toMatch(/[A-Z][a-z]+\s+\d+/);
  });
});

// ─── presetToRange ────────────────────────────────────────────────────────────

describe('presetToRange', () => {
  const now = new Date('2026-05-23T12:00:00.000Z');

  it('1h → 1 hour span, bucket "1m"', () => {
    const { from, to, bucket } = presetToRange('1h', now);
    const diffMs = new Date(to).getTime() - new Date(from).getTime();
    expect(diffMs).toBe(60 * 60 * 1000);
    expect(bucket).toBe('1m');
    expect(to).toBe(now.toISOString());
  });

  it('6h → 6 hour span, bucket "5m"', () => {
    const { from, to, bucket } = presetToRange('6h', now);
    const diffMs = new Date(to).getTime() - new Date(from).getTime();
    expect(diffMs).toBe(6 * 60 * 60 * 1000);
    expect(bucket).toBe('5m');
  });

  it('24h → 24 hour span, bucket "1h"', () => {
    const { from, to, bucket } = presetToRange('24h', now);
    const diffMs = new Date(to).getTime() - new Date(from).getTime();
    expect(diffMs).toBe(24 * 60 * 60 * 1000);
    expect(bucket).toBe('1h');
  });

  it('7d → 7-day span, coarser bucket "1h"', () => {
    const { from, to, bucket } = presetToRange('7d', now);
    const diffMs = new Date(to).getTime() - new Date(from).getTime();
    expect(diffMs).toBe(7 * 24 * 60 * 60 * 1000);
    expect(bucket).toBe('1h');
  });

  it('uses current time when now is not specified', () => {
    const before = Date.now();
    const { to } = presetToRange('1h');
    const after = Date.now();
    const toMs = new Date(to).getTime();
    expect(toMs).toBeGreaterThanOrEqual(before);
    expect(toMs).toBeLessThanOrEqual(after);
  });
});
