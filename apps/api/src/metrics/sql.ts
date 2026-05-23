import { sql, type SQL } from 'drizzle-orm';
import { inferenceLogs } from '@ollive/db';
import type { MetricFilters } from './params.js';
import { bucketToInterval } from './params.js';

/**
 * Build a WHERE clause for the given filters.
 * Every user value is bound as a SQL parameter — no string interpolation (SE5).
 */
export function whereClause(f: MetricFilters): SQL {
  const parts: SQL[] = [
    sql`${inferenceLogs.createdAt} >= ${f.from}`,
    sql`${inferenceLogs.createdAt} < ${f.to}`,
    sql`${inferenceLogs.userId} = ${f.userId}`,
  ];
  if (f.provider !== undefined) {
    parts.push(sql`${inferenceLogs.provider} = ${f.provider}`);
  }
  if (f.model !== undefined) {
    parts.push(sql`${inferenceLogs.model} = ${f.model}`);
  }
  return sql.join(parts, sql` and `);
}

/**
 * date_bin expression for bucketing.
 * Anchor is the epoch so buckets are deterministic across any range.
 */
function dateBin(f: MetricFilters): SQL {
  const interval = bucketToInterval(f.bucket);
  const anchor = new Date(0); // epoch anchor
  return sql`date_bin(${interval}::interval, ${inferenceLogs.createdAt}, ${anchor})`;
}

/** Overview aggregate query — single row. */
export function overviewQuery(f: MetricFilters): SQL {
  const where = whereClause(f);
  return sql`
    SELECT
      count(*) AS requests,
      avg(CASE WHEN ${inferenceLogs.status} = 'error' THEN 1 ELSE 0 END) AS error_rate,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY ${inferenceLogs.latencyMs}) FILTER (WHERE ${inferenceLogs.latencyMs} IS NOT NULL) AS p50,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY ${inferenceLogs.latencyMs}) FILTER (WHERE ${inferenceLogs.latencyMs} IS NOT NULL) AS p95,
      percentile_cont(0.99) WITHIN GROUP (ORDER BY ${inferenceLogs.latencyMs}) FILTER (WHERE ${inferenceLogs.latencyMs} IS NOT NULL) AS p99,
      sum(${inferenceLogs.promptTokens}) AS prompt_tokens,
      sum(${inferenceLogs.completionTokens}) AS completion_tokens,
      sum(${inferenceLogs.totalTokens}) AS total_tokens
    FROM ${inferenceLogs}
    WHERE ${where}
  `;
}

/** Latency series query — per bucket. */
export function latencySeriesQuery(f: MetricFilters): SQL {
  const where = whereClause(f);
  const bucket = dateBin(f);
  return sql`
    SELECT
      ${bucket} AS t,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY ${inferenceLogs.latencyMs}) FILTER (WHERE ${inferenceLogs.latencyMs} IS NOT NULL) AS p50,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY ${inferenceLogs.latencyMs}) FILTER (WHERE ${inferenceLogs.latencyMs} IS NOT NULL) AS p95,
      percentile_cont(0.99) WITHIN GROUP (ORDER BY ${inferenceLogs.latencyMs}) FILTER (WHERE ${inferenceLogs.latencyMs} IS NOT NULL) AS p99,
      count(*) AS count
    FROM ${inferenceLogs}
    WHERE ${where}
    GROUP BY t
    ORDER BY t ASC
  `;
}

/** Throughput series query — per bucket. */
export function throughputSeriesQuery(f: MetricFilters): SQL {
  const where = whereClause(f);
  const bucket = dateBin(f);
  return sql`
    SELECT
      ${bucket} AS t,
      count(*) AS count
    FROM ${inferenceLogs}
    WHERE ${where}
    GROUP BY t
    ORDER BY t ASC
  `;
}

/** Error series query — per bucket. */
export function errorSeriesQuery(f: MetricFilters): SQL {
  const where = whereClause(f);
  const bucket = dateBin(f);
  return sql`
    SELECT
      ${bucket} AS t,
      count(*) AS count,
      sum(CASE WHEN ${inferenceLogs.status} = 'error' THEN 1 ELSE 0 END) AS error_count
    FROM ${inferenceLogs}
    WHERE ${where}
    GROUP BY t
    ORDER BY t ASC
  `;
}

/** Token series query — per bucket. */
export function tokenSeriesQuery(f: MetricFilters): SQL {
  const where = whereClause(f);
  const bucket = dateBin(f);
  return sql`
    SELECT
      ${bucket} AS t,
      sum(${inferenceLogs.promptTokens}) AS prompt_tokens,
      sum(${inferenceLogs.completionTokens}) AS completion_tokens,
      sum(${inferenceLogs.totalTokens}) AS total_tokens
    FROM ${inferenceLogs}
    WHERE ${where}
    GROUP BY t
    ORDER BY t ASC
  `;
}
