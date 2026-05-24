import React, { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import styles from './Composer.module.css';

interface ComposerProps {
  disabled?: boolean;
  isStreaming: boolean;
  onSend: (content: string) => void;
  onStop: () => void;
  placeholder?: string;
}

export interface ComposerHandle {
  /** Fill the input with text and focus it (used by suggested prompts). */
  fill: (text: string) => void;
  /** Fill+focus only when the input is currently empty (used to restore a carried-over draft without clobbering typed text). */
  fillIfEmpty: (text: string) => void;
}

const MAX_HEIGHT = 200;

const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer(
  { disabled, isStreaming, onSend, onStop, placeholder = 'Message Ollive…' },
  ref,
) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function autosize() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }

  useImperativeHandle(ref, () => ({
    fill(text: string) {
      setValue(text);
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
        autosize();
      });
    },
    fillIfEmpty(text: string) {
      if (value.trim() !== '') return;
      setValue(text);
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
        autosize();
      });
    },
  }), [value]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!isStreaming) submit();
    }
  }

  function submit() {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setValue('');
    requestAnimationFrame(autosize);
  }

  function handleButtonClick() {
    if (isStreaming) onStop();
    else submit();
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.composer}>
        <textarea
          ref={textareaRef}
          className={styles.textarea}
          value={value}
          onChange={(e) => { setValue(e.target.value); autosize(); }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled || isStreaming}
          rows={1}
        />
        <button
          className={`${styles.button} ${isStreaming ? styles.stopButton : styles.sendButton}`}
          onClick={handleButtonClick}
          disabled={!isStreaming && (disabled || !value.trim())}
          type="button"
          aria-label={isStreaming ? 'Stop' : 'Send'}
        >
          {isStreaming ? (
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          )}
        </button>
      </div>
      <p className={styles.foot}>
        Ollive can make mistakes — verify important info.
      </p>
    </div>
  );
});

export default Composer;
