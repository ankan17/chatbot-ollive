import { describe, it, expect } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { bucketToInterval, parseMetricQuery, type MetricFilters } from '../src/metrics/params.js';
import {
  overviewQuery,
  latencySeriesQuery,
  throughputSeriesQuery,
  errorSeriesQuery,
  tokenSeriesQuery,
  whereClause,
} from '../src/metrics/sql.js';

const dialect = new PgDialect();
function toQuery(q: SQL): { sql: string; params: unknown[] } {
  return dialect.sqlToQuery(q);
}

describe('bucketToInterval', () => {
  it('maps 1m → 1 minute', () => expect(bucketToInterval('1m')).toBe('1 minute'));
  it('maps 5m → 5 minutes', () => expect(bucketToInterval('5m')).toBe('5 minutes'));
  it('maps 1h → 1 hour', () => expect(bucketToInterval('1h')).toBe('1 hour'));
  it('maps 1d → 1 day', () => expect(bucketToInterval('1d')).toBe('1 day'));
});

describe('parseMetricQuery', () => {
  it('defaults to → now, from → now-24h, bucket → 1m', () => {
    const before = Date.now();
    const f = parseMetricQuery({}, 'user-id-1');
    const after = Date.now();

    expect(f.bucket).toBe('1m');
    expect(f.userId).toBe('user-id-1');
    expect(f.to.getTime()).toBeGreaterThanOrEqual(before);
    expect(f.to.getTime()).toBeLessThanOrEqual(after);
    // from should be 24h before to
    const diff = f.to.getTime() - f.from.getTime();
    expect(diff).toBeCloseTo(24 * 60 * 60 * 1000, -2); // within 100ms tolerance
  });

  it('carries provider, model, bucket from query', () => {
    const f = parseMetricQuery({ provider: 'google', model: 'gemini-2.5-flash', bucket: '1h' }, 'user-id-2');
    expect(f.provider).toBe('google');
    expect(f.model).toBe('gemini-2.5-flash');
    expect(f.bucket).toBe('1h');
  });

  it('from > to throws (Zod refine)', () => {
    const from = new Date('2026-01-02');
    const to = new Date('2026-01-01');
    expect(() => parseMetricQuery({ from: from.toISOString(), to: to.toISOString() }, 'user-id-3')).toThrow();
  });

  it('ignores userId present in raw query — always uses trusted userId arg (SE8)', () => {
    const f = parseMetricQuery({ userId: 'attacker-id' } as unknown as Record<string, unknown>, 'trusted-user-id');
    expect(f.userId).toBe('trusted-user-id');
  });

  it('uses explicit from/to when provided', () => {
    const from = new Date('2026-01-01T00:00:00Z');
    const to = new Date('2026-01-02T00:00:00Z');
    const f = parseMetricQuery({ from: from.toISOString(), to: to.toISOString() }, 'user-1');
    expect(f.from.toISOString()).toBe(from.toISOString());
    expect(f.to.toISOString()).toBe(to.toISOString());
  });

  it('invalid bucket value → throws', () => {
    expect(() => parseMetricQuery({ bucket: 'invalid' }, 'user-1')).toThrow();
  });
});

describe('SQL builders — parameterized (SE5)', () => {
  const filters: MetricFilters = {
    from: new Date('2026-01-01T00:00:00Z'),
    to: new Date('2026-01-02T00:00:00Z'),
    userId: 'user-abc-123',
    bucket: '1m',
  };

  it('whereClause params include from (as ISO string), to (as ISO string), userId — no string interpolation', () => {
    const q = whereClause(filters);
    const { params } = toQuery(q);
    // from, to as ISO strings; userId as string — all params (no inlining)
    expect(params).toContain(filters.from.toISOString());
    expect(params).toContain(filters.to.toISOString());
    expect(params).toContain(filters.userId);
  });

  it('whereClause includes provider param when set', () => {
    const f = { ...filters, provider: 'google' };
    const q = whereClause(f);
    const { params } = toQuery(q);
    expect(params).toContain('google');
  });

  it('whereClause includes model param when set', () => {
    const f = { ...filters, model: 'gemini-2.5-flash' };
    const q = whereClause(f);
    const { params } = toQuery(q);
    expect(params).toContain('gemini-2.5-flash');
  });

  it('overviewQuery returns SQL object with from/to (ISO strings) and userId params', () => {
    const q = overviewQuery(filters);
    const { params } = toQuery(q);
    expect(params).toContain(filters.from.toISOString());
    expect(params).toContain(filters.to.toISOString());
    expect(params).toContain(filters.userId);
  });

  it('latencySeriesQuery returns SQL with from/to (ISO strings) and userId params', () => {
    const q = latencySeriesQuery(filters);
    const { params } = toQuery(q);
    expect(params).toContain(filters.from.toISOString());
    expect(params).toContain(filters.to.toISOString());
    expect(params).toContain(filters.userId);
  });

  it('throughputSeriesQuery returns SQL with from/to (ISO strings) and userId params', () => {
    const q = throughputSeriesQuery(filters);
    const { params } = toQuery(q);
    expect(params).toContain(filters.from.toISOString());
    expect(params).toContain(filters.to.toISOString());
    expect(params).toContain(filters.userId);
  });

  it('errorSeriesQuery returns SQL with from/to (ISO strings) and userId params', () => {
    const q = errorSeriesQuery(filters);
    const { params } = toQuery(q);
    expect(params).toContain(filters.from.toISOString());
    expect(params).toContain(filters.to.toISOString());
    expect(params).toContain(filters.userId);
  });

  it('tokenSeriesQuery returns SQL with from/to (ISO strings) and userId params', () => {
    const q = tokenSeriesQuery(filters);
    const { params } = toQuery(q);
    expect(params).toContain(filters.from.toISOString());
    expect(params).toContain(filters.to.toISOString());
    expect(params).toContain(filters.userId);
  });

  it('userId is parameterized (not inlined) in whereClause SQL string', () => {
    const q = whereClause(filters);
    const { sql: sqlStr } = toQuery(q);
    // The userId should NOT appear literally in the SQL string
    expect(sqlStr).not.toContain('user-abc-123');
  });
});
