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
import type { TokenRow } from '../lib/chartData.js';

interface TokenUsageChartProps {
  data: TokenRow[];
}

export default function TokenUsageChart({ data }: TokenUsageChartProps) {
  if (data.length === 0) {
    return <div style={{ height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>No data</div>;
  }

  return (
    <div style={{ width: '100%', height: 180 }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <XAxis dataKey="label" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip />
          <Legend />
          <Line type="monotone" dataKey="prompt" name="Prompt" stroke="#4f46e5" dot={false} strokeWidth={1.5} />
          <Line type="monotone" dataKey="completion" name="Completion" stroke="#10b981" dot={false} strokeWidth={1.5} />
          <Line type="monotone" dataKey="total" name="Total" stroke="#6366f1" dot={false} strokeWidth={1.5} strokeDasharray="4 2" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
