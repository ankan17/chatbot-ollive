import React from 'react';
import styles from './ChatHero.module.css';

interface ChatHeroProps {
  title: string;
  subtitle: string;
  onPickPrompt(prompt: string): void;
}

interface Prompt {
  label: string;
  prompt: string;
  icon: React.ReactNode;
}

const PROMPTS: Prompt[] = [
  {
    label: 'Draft an email',
    prompt: 'Draft an email to ',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="M3 7l9 6 9-6" />
      </svg>
    ),
  },
  {
    label: 'Explain a concept',
    prompt: 'Explain this concept in simple terms: ',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2.5-3 4" />
        <path d="M12 17h.01" />
      </svg>
    ),
  },
  {
    label: 'Summarize a doc',
    prompt: 'Summarize the following text: ',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 6h16M4 12h16M4 18h10" />
      </svg>
    ),
  },
  {
    label: 'Write some code',
    prompt: 'Write a function that ',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M8 9l-4 3 4 3M16 9l4 3-4 3M13 6l-2 12" />
      </svg>
    ),
  },
];

function OliveMark() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <path d="M7 16c3-1.5 6-6 6-12" strokeLinecap="round" />
    </svg>
  );
}

export default function ChatHero({ title, subtitle, onPickPrompt }: ChatHeroProps) {
  return (
    <div className={styles.hero}>
      <div className={styles.mark}>
        <OliveMark />
      </div>
      <h1 className={styles.title}>{title}</h1>
      <p className={styles.sub}>{subtitle}</p>
      <div className={styles.chips}>
        {PROMPTS.map((p) => (
          <button
            key={p.label}
            type="button"
            className={styles.chip}
            onClick={() => onPickPrompt(p.prompt)}
          >
            {p.icon}
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}
