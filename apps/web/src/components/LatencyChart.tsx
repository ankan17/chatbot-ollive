import React from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import type { LatencyRow } from '../lib/chartData.js';
import { useTheme } from '../state/themeContext.js';
import { getChartTheme, tooltipStyles } from '../lib/chartTheme.js';
import styles from './Dashboards.module.css';

interface LatencyChartProps {
  data: LatencyRow[];
}

export default function LatencyChart({ data }: LatencyChartProps) {
  const { theme } = useTheme();
  const t = getChartTheme(theme);

  if (data.length === 0) {
    return <div className={styles.emptyChart}>No data</div>;
  }

  return (
    <div style={{ width: '100%', height: 200 }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={t.grid} vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: t.axis }} stroke={t.axis} />
          <YAxis tick={{ fontSize: 11, fill: t.axis }} stroke={t.axis} unit="ms" />
          <Tooltip formatter={(v: number) => `${v}ms`} {...tooltipStyles(t)} />
          <Legend wrapperStyle={{ fontSize: 12, color: t.axis }} />
          <Line type="monotone" dataKey="p50" name="p50" stroke={t.series.lime} dot={false} strokeWidth={2} />
          <Line type="monotone" dataKey="p95" name="p95" stroke={t.series.amber} dot={false} strokeWidth={2} />
          <Line type="monotone" dataKey="p99" name="p99" stroke={t.series.rose} dot={false} strokeWidth={2} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
