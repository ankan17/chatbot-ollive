import React from 'react';
import type { RangePreset } from '../lib/time.js';
import styles from './MetricFilters.module.css';

const PRESETS: RangePreset[] = ['1h', '6h', '24h', '7d'];

interface MetricFiltersProps {
  preset: RangePreset;
  provider?: string;
  model?: string;
  onPreset(p: RangePreset): void;
  onProvider(p: string | undefined): void;
  onModel(m: string | undefined): void;
}

export default function MetricFilters({
  preset,
  provider,
  model,
  onPreset,
  onProvider,
  onModel,
}: MetricFiltersProps) {
  return (
    <div className={styles.filters}>
      <div className={styles.presets}>
        {PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            className={`${styles.presetBtn} ${p === preset ? styles.active : ''}`}
            onClick={() => onPreset(p)}
          >
            {p}
          </button>
        ))}
      </div>
      <input
        type="text"
        className={styles.textInput}
        placeholder="Provider (optional)"
        value={provider ?? ''}
        onChange={(e) => onProvider(e.target.value || undefined)}
      />
      <input
        type="text"
        className={styles.textInput}
        placeholder="Model (optional)"
        value={model ?? ''}
        onChange={(e) => onModel(e.target.value || undefined)}
      />
    </div>
  );
}
