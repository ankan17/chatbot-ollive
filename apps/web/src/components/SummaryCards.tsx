import React from 'react';
import type { OverviewMetrics } from '../api/types.js';
import { formatPercent, formatTokens } from '../lib/chartData.js';
import styles from './SummaryCards.module.css';

interface SummaryCardsProps {
  overview?: OverviewMetrics;
}

function Card({ label, value, unit }: { label: string; value: string | number | undefined; unit?: string }) {
  return (
    <div className={styles.card}>
      <p className={styles.label}>{label}</p>
      {value === undefined ? (
        <div className={styles.skeleton} />
      ) : (
        <p className={styles.value}>
          {value}
          {unit && <span className={styles.unit}>{unit}</span>}
        </p>
      )}
    </div>
  );
}

export default function SummaryCards({ overview }: SummaryCardsProps) {
  return (
    <div className={styles.cards}>
      <Card label="Requests" value={overview ? overview.requests.toLocaleString() : undefined} />
      <Card label="p95 Latency" value={overview ? overview.latencyMs.p95.toLocaleString() : undefined} unit="ms" />
      <Card label="Error Rate" value={overview ? formatPercent(overview.errorRate) : undefined} />
      <Card label="Throughput" value={overview ? overview.throughputPerMin.toFixed(1) : undefined} unit="/min" />
      <Card label="Total Tokens" value={overview ? formatTokens(overview.tokens.total) : undefined} />
    </div>
  );
}
