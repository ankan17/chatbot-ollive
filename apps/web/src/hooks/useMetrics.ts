import { useCallback, useEffect, useRef, useState } from 'react';
import { getOverview, getLatency, getThroughput, getErrors, getTokens } from '../api/metrics.js';
import type {
  OverviewMetrics,
  LatencyPoint,
  ThroughputPoint,
  ErrorPoint,
  TokenPoint,
  MetricFilters,
} from '../api/types.js';
import { ApiError } from '../api/errors.js';
import { presetToRange } from '../lib/time.js';

interface MetricsData {
  overview?: OverviewMetrics;
  latency: LatencyPoint[];
  throughput: ThroughputPoint[];
  errors: ErrorPoint[];
  tokens: TokenPoint[];
}

export interface UseMetricsResult {
  data: MetricsData;
  status: 'idle' | 'loading' | 'success' | 'error';
  error?: ApiError;
  filters: MetricFilters;
  setFilters(partial: Partial<MetricFilters>): void;
  reload(): Promise<void>;
}

const EMPTY_DATA: MetricsData = {
  latency: [],
  throughput: [],
  errors: [],
  tokens: [],
};

export function useMetrics(): UseMetricsResult {
  const defaultRange = presetToRange('24h');
  const [filters, setFiltersState] = useState<MetricFilters>(defaultRange);
  const [status, setStatus] = useState<UseMetricsResult['status']>('loading');
  const [data, setData] = useState<MetricsData>(EMPTY_DATA);
  const [error, setError] = useState<ApiError | undefined>(undefined);

  const acRef = useRef<AbortController | null>(null);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const fetch = useCallback(async (f: MetricFilters): Promise<void> => {
    acRef.current?.abort();
    const ac = new AbortController();
    acRef.current = ac;

    setStatus('loading');
    try {
      const [overview, latency, throughput, errs, tokens] = await Promise.all([
        getOverview(f, ac.signal),
        getLatency(f, ac.signal),
        getThroughput(f, ac.signal),
        getErrors(f, ac.signal),
        getTokens(f, ac.signal),
      ]);

      if (ac.signal.aborted) return;

      setData({
        overview,
        latency: latency.series,
        throughput: throughput.series,
        errors: errs.series,
        tokens: tokens.series,
      });
      setError(undefined);
      setStatus('success');
    } catch (err) {
      if (ac.signal.aborted) return;
      const name = (err as { name?: string })?.name;
      if (name === 'AbortError') return;
      setError(err instanceof ApiError ? err : new ApiError('internal_error', 0, String(err)));
      setStatus('error');
    }
  }, []);

  // Re-fetch when filters change
  useEffect(() => {
    void fetch(filters);
    return () => {
      acRef.current?.abort();
    };
  }, [filters, fetch]);

  const setFilters = useCallback((partial: Partial<MetricFilters>) => {
    setFiltersState((prev) => ({ ...prev, ...partial }));
  }, []);

  const reload = useCallback((): Promise<void> => {
    return fetch(filtersRef.current);
  }, [fetch]);

  return { data, status, error, filters, setFilters, reload };
}
