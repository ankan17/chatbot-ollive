import React from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import type { ThroughputRow } from '../lib/chartData.js';

interface ThroughputChartProps {
  data: ThroughputRow[];
}

export default function ThroughputChart({ data }: ThroughputChartProps) {
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
          <Line type="monotone" dataKey="count" name="Requests" stroke="#4f46e5" dot={false} strokeWidth={1.5} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
