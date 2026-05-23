import React, { useState } from 'react';
import { useModels } from '../hooks/useModels.js';
import { getStoredModel, setStoredModel } from '../api/models.js';
import styles from './ModelSwitcher.module.css';

function Chevron() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function Check() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

export default function ModelSwitcher() {
  const { models, defaultModel } = useModels();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | undefined>(() => getStoredModel());

  const ids = models.map((m) => m.id);
  const activeId =
    selected && ids.includes(selected)
      ? selected
      : defaultModel && ids.includes(defaultModel)
        ? defaultModel
        : ids[0];
  const active = models.find((m) => m.id === activeId);

  // Nothing available yet (loading or no providers) — render a neutral, non-interactive label.
  if (models.length === 0) {
    return (
      <div className={styles.pill} aria-hidden="true">
        <span className={styles.dot} />
        Model
      </div>
    );
  }

  // Only one model — show it, no menu.
  if (models.length === 1) {
    return (
      <div className={styles.pill}>
        <span className={styles.dot} />
        {active?.label}
      </div>
    );
  }

  function choose(id: string) {
    setSelected(id);
    setStoredModel(id);
    setOpen(false);
  }

  return (
    <div className={styles.wrap}>
      <button
        type="button"
        className={styles.pill}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className={styles.dot} />
        {active?.label ?? 'Select model'}
        <span className={styles.chevron}><Chevron /></span>
      </button>

      {open && (
        <>
          <div className={styles.scrim} onClick={() => setOpen(false)} aria-hidden="true" />
          <ul className={styles.menu} role="listbox">
            {models.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={m.id === activeId}
                  className={styles.option}
                  onClick={() => choose(m.id)}
                >
                  <span className={styles.optHead}>
                    <span className={styles.optLabel}>{m.label}</span>
                    {m.id === activeId && <span className={styles.optCheck}><Check /></span>}
                  </span>
                  {m.description && <span className={styles.optDesc}>{m.description}</span>}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
