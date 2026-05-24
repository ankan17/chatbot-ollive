import React from 'react';
import type { RangePreset } from '../lib/time.js';
import { useModels } from '../hooks/useModels.js';
import FilterDropdown from './FilterDropdown.js';
import styles from './MetricFilters.module.css';

const PRESETS: RangePreset[] = ['1h', '6h', '24h', '7d'];

interface MetricFiltersProps {
  preset: RangePreset;
  provider?: string;
  model?: string;
  onPreset: (p: RangePreset) => void;
  onProvider: (p: string | undefined) => void;
  onModel: (m: string | undefined) => void;
}

export default function MetricFilters({
  preset,
  provider,
  model,
  onPreset,
  onProvider,
  onModel,
}: MetricFiltersProps) {
  const { models } = useModels();

  const providers = Array.from(new Set(models.map((m) => m.provider)));
  // When a provider is selected, only its models are offered.
  const modelOptions = provider ? models.filter((m) => m.provider === provider) : models;

  function handleProvider(next: string | undefined) {
    onProvider(next);
    // Clear the model filter if the current model isn't served by the new provider.
    if (model && next && !models.some((m) => m.id === model && m.provider === next)) {
      onModel(undefined);
    }
  }

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
      <FilterDropdown
        label="Provider"
        allLabel="All providers"
        value={provider}
        options={providers.map((p) => ({ value: p, label: p }))}
        onChange={handleProvider}
      />
      <FilterDropdown
        label="Model"
        allLabel="All models"
        value={model}
        options={modelOptions.map((m) => ({ value: m.id, label: m.label }))}
        onChange={onModel}
      />
    </div>
  );
}
