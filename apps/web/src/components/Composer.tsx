import React, { useState } from 'react';
import styles from './Composer.module.css';

interface ComposerProps {
  disabled?: boolean;
  isStreaming: boolean;
  onSend(content: string): void;
  onStop(): void;
  placeholder?: string;
}

export default function Composer({
  disabled,
  isStreaming,
  onSend,
  onStop,
  placeholder = 'Type a message…',
}: ComposerProps) {
  const [value, setValue] = useState('');

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!isStreaming) {
        submit();
      }
    }
  }

  function submit() {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setValue('');
  }

  function handleButtonClick() {
    if (isStreaming) {
      onStop();
    } else {
      submit();
    }
  }

  return (
    <div className={styles.composer}>
      <textarea
        className={styles.textarea}
        value={value}
        onChange={(e) => setValue(e.target.value)}
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
      >
        {isStreaming ? 'Stop' : 'Send'}
      </button>
    </div>
  );
}
