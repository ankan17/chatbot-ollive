import React, { useState } from 'react';
import { useModels } from '../hooks/useModels.js';
import { getStoredModel, setStoredModel } from '../api/models.js';
import { patchConversation } from '../api/conversations.js';
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

interface ModelSwitcherProps {
  /** Active conversation id — when set, picking a model retargets THIS conversation. */
  conversationId?: string;
  /** The active conversation's persisted model — the source of truth when in a conversation. */
  conversationModel?: string;
  /** Called after the conversation's model is patched, so the parent can refresh. */
  onModelChange?: () => void;
}

export default function ModelSwitcher({
  conversationId,
  conversationModel,
  onModelChange,
}: ModelSwitcherProps = {}) {
  const { models, defaultModel } = useModels();
  const [open, setOpen] = useState(false);
  // Optimistic pick for instant feedback. Parent remounts via `key` on conversation
  // change, so this resets and the per-conversation model shows.
  const [selected, setSelected] = useState<string | undefined>(undefined);

  const ids = models.map((m) => m.id);
  // In a conversation, that conversation's model is the truth; otherwise the stored
  // default (used for the next new conversation). A fresh pick overrides either.
  const preferred = selected ?? (conversationId ? conversationModel : getStoredModel());
  const activeId =
    preferred && ids.includes(preferred)
      ? preferred
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
    setOpen(false);
    if (id === activeId) return; // already the active model — nothing to do
    setSelected(id);
    setStoredModel(id); // remember as the default for the next new conversation
    // Inside a conversation, retarget it so subsequent messages use the new model.
    if (conversationId) {
      void patchConversation(conversationId, { model: id }).then(() => onModelChange?.());
    }
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
