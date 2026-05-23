import React from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import type { ErrorRow } from '../lib/chartData.js';

interface ErrorRateChartProps {
  data: ErrorRow[];
}

export default function ErrorRateChart({ data }: ErrorRateChartProps) {
  if (data.length === 0) {
    return <div style={{ height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>No data</div>;
  }

  return (
    <div style={{ width: '100%', height: 180 }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <XAxis dataKey="label" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} unit="%" />
          <Tooltip formatter={(v: number) => `${v.toFixed(1)}%`} />
          <Line type="monotone" dataKey="errorRatePct" name="Error rate" stroke="#ef4444" dot={false} strokeWidth={1.5} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
