import { Router } from 'express';
import type { Db } from '@ollive/db';
import type { AppConfig } from '../config.js';
import type { Logger } from '../logger.js';
import { requireAuth } from '../middleware/require-auth.js';
import { AppError } from '../errors.js';
import { parseMetricQuery } from '../metrics/params.js';
import {
  overviewQuery,
  latencySeriesQuery,
  throughputSeriesQuery,
  errorSeriesQuery,
  tokenSeriesQuery,
} from '../metrics/sql.js';
import type {
  OverviewMetrics,
  LatencySeries,
  ThroughputSeries,
  ErrorSeries,
  TokenSeries,
} from '@ollive/shared/api';

export interface MetricsRouterDeps {
  db: Db;
  config: AppConfig;
  logger?: Logger;
}

function minutesInRange(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / 60_000;
}

export function metricsRouter(deps: MetricsRouterDeps): Router {
  const { db, config } = deps;
  const router = Router();
  const auth = requireAuth({ config });

  // GET /v1/metrics/overview
  router.get('/overview', auth, async (req, res, next) => {
    try {
      const filters = parseMetricQuery(req.query, req.user!.id);
      const rows = await db.execute(overviewQuery(filters)) as unknown as Record<string, unknown>[];
      const row = rows[0] ?? {};

      const requests = Number(row['requests'] ?? 0);
      const errorRate = Number(row['error_rate'] ?? 0);
      const p50 = Math.round(Number(row['p50'] ?? 0));
      const p95 = Math.round(Number(row['p95'] ?? 0));
      const p99 = Math.round(Number(row['p99'] ?? 0));
      const promptTokens = Number(row['prompt_tokens'] ?? 0);
      const completionTokens = Number(row['completion_tokens'] ?? 0);
      const totalTokens = Number(row['total_tokens'] ?? 0);
      const minutes = minutesInRange(filters.from, filters.to);
      const throughputPerMin = Math.round((requests / Math.max(minutes, 1)) * 1000) / 1000;

      const response: OverviewMetrics = {
        range: { from: filters.from.toISOString(), to: filters.to.toISOString() },
        requests,
        errorRate: Math.round(errorRate * 1000) / 1000,
        latencyMs: { p50, p95, p99 },
        tokens: { prompt: promptTokens, completion: completionTokens, total: totalTokens },
        throughputPerMin,
      };
      return res.json(response);
    } catch (err) {
      if (err instanceof Error && err.name === 'ZodError') {
        return next(new AppError('validation_error', 'Invalid query parameters', (err as any).issues));
      }
      return next(err);
    }
  });

  // GET /v1/metrics/latency
  router.get('/latency', auth, async (req, res, next) => {
    try {
      const filters = parseMetricQuery(req.query, req.user!.id);
      const rows = await db.execute(latencySeriesQuery(filters)) as unknown as Record<string, unknown>[];

      const series = rows.map((r) => ({
        t: new Date(r['t'] as string).toISOString(),
        p50: Math.round(Number(r['p50'] ?? 0)),
        p95: Math.round(Number(r['p95'] ?? 0)),
        p99: Math.round(Number(r['p99'] ?? 0)),
        count: Number(r['count'] ?? 0),
      }));

      const response: LatencySeries = { bucket: filters.bucket, series };
      return res.json(response);
    } catch (err) {
      if (err instanceof Error && err.name === 'ZodError') {
        return next(new AppError('validation_error', 'Invalid query parameters', (err as any).issues));
      }
      return next(err);
    }
  });

  // GET /v1/metrics/throughput
  router.get('/throughput', auth, async (req, res, next) => {
    try {
      const filters = parseMetricQuery(req.query, req.user!.id);
      const rows = await db.execute(throughputSeriesQuery(filters)) as unknown as Record<string, unknown>[];

      const series = rows.map((r) => ({
        t: new Date(r['t'] as string).toISOString(),
        count: Number(r['count'] ?? 0),
      }));

      const response: ThroughputSeries = { bucket: filters.bucket, series };
      return res.json(response);
    } catch (err) {
      if (err instanceof Error && err.name === 'ZodError') {
        return next(new AppError('validation_error', 'Invalid query parameters', (err as any).issues));
      }
      return next(err);
    }
  });

  // GET /v1/metrics/errors
  router.get('/errors', auth, async (req, res, next) => {
    try {
      const filters = parseMetricQuery(req.query, req.user!.id);
      const rows = await db.execute(errorSeriesQuery(filters)) as unknown as Record<string, unknown>[];

      const series = rows.map((r) => {
        const count = Number(r['count'] ?? 0);
        const errorCount = Number(r['error_count'] ?? 0);
        return {
          t: new Date(r['t'] as string).toISOString(),
          count,
          errorCount,
          errorRate: count > 0 ? errorCount / count : 0,
        };
      });

      const response: ErrorSeries = { bucket: filters.bucket, series };
      return res.json(response);
    } catch (err) {
      if (err instanceof Error && err.name === 'ZodError') {
        return next(new AppError('validation_error', 'Invalid query parameters', (err as any).issues));
      }
      return next(err);
    }
  });

  // GET /v1/metrics/tokens
  router.get('/tokens', auth, async (req, res, next) => {
    try {
      const filters = parseMetricQuery(req.query, req.user!.id);
      const rows = await db.execute(tokenSeriesQuery(filters)) as unknown as Record<string, unknown>[];

      const series = rows.map((r) => ({
        t: new Date(r['t'] as string).toISOString(),
        promptTokens: Number(r['prompt_tokens'] ?? 0),
        completionTokens: Number(r['completion_tokens'] ?? 0),
        totalTokens: Number(r['total_tokens'] ?? 0),
      }));

      const response: TokenSeries = { bucket: filters.bucket, series };
      return res.json(response);
    } catch (err) {
      if (err instanceof Error && err.name === 'ZodError') {
        return next(new AppError('validation_error', 'Invalid query parameters', (err as any).issues));
      }
      return next(err);
    }
  });

  return router;
}
