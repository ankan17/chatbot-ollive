import React from 'react';
import { useTheme } from '../state/themeContext.js';
import styles from './ThemeToggle.module.css';

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

/** Segmented dark/light theme control (lives in the sidebar footer). */
export default function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  return (
    <div className={styles.toggle} role="group" aria-label="Theme">
      <button
        type="button"
        className={styles.option}
        aria-pressed={theme === 'dark'}
        aria-label="Dark theme"
        onClick={() => setTheme('dark')}
      >
        <MoonIcon />
        <span>Dark</span>
      </button>
      <button
        type="button"
        className={styles.option}
        aria-pressed={theme === 'light'}
        aria-label="Light theme"
        onClick={() => setTheme('light')}
      >
        <SunIcon />
        <span>Light</span>
      </button>
    </div>
  );
}
