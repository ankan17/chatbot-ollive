import React, { useState } from 'react';
import { useMetrics } from '../hooks/useMetrics.js';
import { useApiErrorRedirect } from '../hooks/useApiErrorRedirect.js';
import { presetToRange } from '../lib/time.js';
import {
  toLatencyRows,
  toThroughputRows,
  toErrorRows,
  toTokenRows,
} from '../lib/chartData.js';
import type { RangePreset } from '../lib/time.js';
import MetricFilters from './MetricFilters.js';
import SummaryCards from './SummaryCards.js';
import LatencyChart from './LatencyChart.js';
import ThroughputChart from './ThroughputChart.js';
import ErrorRateChart from './ErrorRateChart.js';
import TokenUsageChart from './TokenUsageChart.js';
import Spinner from './states/Spinner.js';
import ErrorState from './states/ErrorState.js';
import styles from './Dashboards.module.css';

export default function Dashboards() {
  const { data, status, error, filters, setFilters, reload } = useMetrics();
  const [preset, setPreset] = useState<RangePreset>('24h');
  const [provider, setProvider] = useState<string | undefined>(undefined);
  const [model, setModel] = useState<string | undefined>(undefined);

  useApiErrorRedirect(error);

  function handlePreset(p: RangePreset) {
    setPreset(p);
    const range = presetToRange(p);
    setFilters({ from: range.from, to: range.to, bucket: range.bucket });
  }

  function handleProvider(p: string | undefined) {
    setProvider(p);
    setFilters({ provider: p });
  }

  function handleModel(m: string | undefined) {
    setModel(m);
    setFilters({ model: m });
  }

  return (
    <div className={styles.page}>
      <MetricFilters
        preset={preset}
        provider={provider}
        model={model}
        onPreset={handlePreset}
        onProvider={handleProvider}
        onModel={handleModel}
      />

      {status === 'loading' && <Spinner />}

      {status === 'error' && error && (
        <ErrorState message={error.message} onRetry={() => void reload()} />
      )}

      {(status === 'success' || (status === 'loading' && data.overview)) && (
        <>
          <SummaryCards overview={data.overview} />

          <div className={styles.grid}>
            <div className={styles.chartCard}>
              <p className={styles.chartTitle}>Latency (ms)</p>
              <LatencyChart data={toLatencyRows(data.latency, filters.bucket)} />
            </div>

            <div className={styles.chartCard}>
              <p className={styles.chartTitle}>Throughput</p>
              <ThroughputChart data={toThroughputRows(data.throughput, filters.bucket)} />
            </div>

            <div className={styles.chartCard}>
              <p className={styles.chartTitle}>Error Rate</p>
              <ErrorRateChart data={toErrorRows(data.errors, filters.bucket)} />
            </div>

            <div className={styles.chartCard}>
              <p className={styles.chartTitle}>Token Usage</p>
              <TokenUsageChart data={toTokenRows(data.tokens, filters.bucket)} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
