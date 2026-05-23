import React from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import type { LatencyRow } from '../lib/chartData.js';

interface LatencyChartProps {
  data: LatencyRow[];
}

export default function LatencyChart({ data }: LatencyChartProps) {
  if (data.length === 0) {
    return <div style={{ height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>No data</div>;
  }

  return (
    <div style={{ width: '100%', height: 180 }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <XAxis dataKey="label" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} unit="ms" />
          <Tooltip formatter={(v: number) => `${v}ms`} />
          <Legend />
          <Line type="monotone" dataKey="p50" name="p50" stroke="#4f46e5" dot={false} strokeWidth={1.5} />
          <Line type="monotone" dataKey="p95" name="p95" stroke="#f59e0b" dot={false} strokeWidth={1.5} />
          <Line type="monotone" dataKey="p99" name="p99" stroke="#ef4444" dot={false} strokeWidth={1.5} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
