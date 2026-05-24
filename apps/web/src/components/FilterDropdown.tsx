import React, { useState } from 'react';
import styles from './FilterDropdown.module.css';

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

export interface FilterOption {
  value: string;
  label: string;
}

interface FilterDropdownProps {
  /** Purpose of the filter, e.g. "Provider" — used in the trigger's accessible name. */
  label: string;
  /** Label for the "no filter" choice, e.g. "All providers". */
  allLabel: string;
  /** Selected value, or undefined for "all". */
  value?: string;
  options: FilterOption[];
  onChange: (value: string | undefined) => void;
}

/**
 * Themed select-style dropdown (button + popover listbox) matching the chat
 * ModelSwitcher. Picking the "all" row clears the filter (onChange(undefined)).
 */
export default function FilterDropdown({ label, allLabel, value, options, onChange }: FilterDropdownProps) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  const display = current?.label ?? allLabel;

  function choose(next: string | undefined) {
    setOpen(false);
    onChange(next);
  }

  return (
    <div className={styles.wrap}>
      <button
        type="button"
        className={styles.pill}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${display}`}
        onClick={() => setOpen((o) => !o)}
      >
        <span className={styles.dot} />
        <span className={styles.value}>{display}</span>
        <span className={styles.chevron}><Chevron /></span>
      </button>

      {open && (
        <>
          <div className={styles.scrim} onClick={() => setOpen(false)} aria-hidden="true" />
          <ul className={styles.menu} role="listbox">
            <li>
              <button
                type="button"
                role="option"
                aria-selected={value === undefined}
                className={styles.option}
                onClick={() => choose(undefined)}
              >
                <span className={styles.optLabel}>{allLabel}</span>
                {value === undefined && <span className={styles.optCheck}><Check /></span>}
              </button>
            </li>
            {options.map((o) => (
              <li key={o.value}>
                <button
                  type="button"
                  role="option"
                  aria-selected={o.value === value}
                  className={styles.option}
                  onClick={() => choose(o.value)}
                >
                  <span className={styles.optLabel}>{o.label}</span>
                  {o.value === value && <span className={styles.optCheck}><Check /></span>}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
