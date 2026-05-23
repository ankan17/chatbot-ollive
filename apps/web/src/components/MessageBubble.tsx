import React from 'react';
import ReactMarkdown from 'react-markdown';
import type { ChatMessage } from '../api/types.js';
import styles from './MessageBubble.module.css';

interface MessageBubbleProps {
  message: ChatMessage;
  /** True only for the last assistant message while a response is streaming. */
  isStreaming?: boolean;
}

function OliveGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M8 15c2-1 4-4 4-8" strokeLinecap="round" />
    </svg>
  );
}

export default function MessageBubble({ message, isStreaming = false }: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const isError = message.status === 'error';
  const isPartial = message.status === 'partial' && message.role === 'assistant';
  const showCaret = isPartial && isStreaming && !isError;
  const showStopped = isPartial && !isStreaming && !isError;

  return (
    <div className={`${styles.row} ${isUser ? styles.user : styles.assistant}`}>
      {!isUser && (
        <div className={styles.gutter}>
          <OliveGlyph />
        </div>
      )}
      <div className={styles.bubbleCol}>
        <div
          className={`${styles.content} ${isError ? styles.errorContent : ''} ${showCaret ? styles.streaming : ''}`}
        >
          {isUser ? message.content : <ReactMarkdown>{message.content}</ReactMarkdown>}
        </div>
        {isError && <span className={styles.statusTag}>Error</span>}
        {showStopped && <span className={styles.statusTag}>Stopped</span>}
      </div>
    </div>
  );
}
