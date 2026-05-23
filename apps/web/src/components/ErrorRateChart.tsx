import React from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import type { ErrorRow } from '../lib/chartData.js';
import { useTheme } from '../state/themeContext.js';
import { getChartTheme, tooltipStyles } from '../lib/chartTheme.js';
import styles from './Dashboards.module.css';

interface ErrorRateChartProps {
  data: ErrorRow[];
}

export default function ErrorRateChart({ data }: ErrorRateChartProps) {
  const { theme } = useTheme();
  const t = getChartTheme(theme);

  if (data.length === 0) {
    return <div className={styles.emptyChart}>No data</div>;
  }

  return (
    <div style={{ width: '100%', height: 200 }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="errorFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={t.series.rose} stopOpacity={0.3} />
              <stop offset="100%" stopColor={t.series.rose} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={t.grid} vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: t.axis }} stroke={t.axis} />
          <YAxis tick={{ fontSize: 11, fill: t.axis }} stroke={t.axis} unit="%" />
          <Tooltip formatter={(v: number) => `${v.toFixed(1)}%`} {...tooltipStyles(t)} />
          <Area type="monotone" dataKey="errorRatePct" name="Error rate" stroke={t.series.rose} strokeWidth={2} fill="url(#errorFill)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
