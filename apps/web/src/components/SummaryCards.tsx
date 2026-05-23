import React from 'react';
import type { OverviewMetrics } from '../api/types.js';
import { formatPercent, formatTokens } from '../lib/chartData.js';
import styles from './SummaryCards.module.css';

interface SummaryCardsProps {
  overview?: OverviewMetrics;
}

function Card({ label, value }: { label: string; value: string | number | undefined }) {
  return (
    <div className={styles.card}>
      <p className={styles.label}>{label}</p>
      {value === undefined ? (
        <div className={styles.skeleton} />
      ) : (
        <p className={styles.value}>{value}</p>
      )}
    </div>
  );
}

export default function SummaryCards({ overview }: SummaryCardsProps) {
  return (
    <div className={styles.cards}>
      <Card
        label="Requests"
        value={overview?.requests}
      />
      <Card
        label="Error Rate"
        value={overview ? formatPercent(overview.errorRate) : undefined}
      />
      <Card
        label="Total Tokens"
        value={overview ? formatTokens(overview.tokens.total) : undefined}
      />
    </div>
  );
}
