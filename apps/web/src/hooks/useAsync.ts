import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../api/errors.js';

export interface AsyncResult<T> {
  status: 'idle' | 'loading' | 'success' | 'error';
  data?: T;
  error?: ApiError;
  run: () => Promise<void>;
}

export function useAsync<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  deps: unknown[],
): AsyncResult<T> {
  const [status, setStatus] = useState<AsyncResult<T>['status']>('loading');
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<ApiError | undefined>(undefined);

  // Keep a stable reference to the current abort controller
  const acRef = useRef<AbortController | null>(null);
  // Store fetcher in a ref so run() always uses the latest without re-creating
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const run = useCallback(async () => {
    // Abort any in-flight request
    acRef.current?.abort();
    const ac = new AbortController();
    acRef.current = ac;

    setStatus('loading');
    try {
      const result = await fetcherRef.current(ac.signal);
      if (!ac.signal.aborted) {
        setData(result);
        setError(undefined);
        setStatus('success');
      }
    } catch (err) {
      if (ac.signal.aborted) return; // ignore aborted
      const name = (err as { name?: string })?.name;
      if (name === 'AbortError') return;
      setError(err instanceof ApiError ? err : new ApiError('internal_error', 0, String(err)));
      setStatus('error');
    }
  }, []);  

  // Auto-run on deps change
   
  useEffect(() => {
    void run();
    return () => {
      acRef.current?.abort();
    };
  // deps is intentionally spread here; run is stable
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { status, data, error, run };
}
