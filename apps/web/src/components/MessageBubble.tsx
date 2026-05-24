import React from 'react';
import ReactMarkdown from 'react-markdown';
import type { ChatMessage } from '../api/types.js';
import { useTypewriter } from '../hooks/useTypewriter.js';
import styles from './MessageBubble.module.css';

interface MessageBubbleProps {
  message: ChatMessage;
  /** True only for the last assistant message while a response is streaming. */
  isStreaming?: boolean;
  /** True when this message should reveal its text via the typewriter (live message). */
  animate?: boolean;
  /** True while more tokens may still arrive (keeps the typewriter loop alive). */
  expectMore?: boolean;
}

function OliveGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M8 15c2-1 4-4 4-8" strokeLinecap="round" />
    </svg>
  );
}

export default function MessageBubble({
  message,
  isStreaming = false,
  animate = false,
  expectMore = false,
}: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const isError = message.status === 'error';
  const { text: revealed, typing } = useTypewriter(message.content, { animate, expectMore });
  const isPartial = message.status === 'partial' && message.role === 'assistant';
  // Caret stays through the finishing tail (typing) and the stopped tag stays off until it lands.
  const showCaret = !isUser && (isStreaming || typing) && !isError;
  const showStopped = isPartial && !isStreaming && !typing && !isError;
  const content = isUser ? message.content : revealed;

  return (
    <div className={`${styles.row} ${isUser ? styles.user : styles.assistant}`}>
      {!isUser && (
        <div className={styles.gutter}>
          <OliveGlyph />
        </div>
      )}
      <div className={styles.bubbleCol}>
        {/* Skip the body only on a failed message with no partial text — the error box stands alone. */}
        {(!isError || content.length > 0) && (
          <div className={`${styles.content} ${showCaret ? styles.streaming : ''}`}>
            {isUser ? message.content : <ReactMarkdown>{content}</ReactMarkdown>}
          </div>
        )}
        {isError && (
          <div className={`${styles.content} ${styles.errorContent}`}>
            {message.errorMessage ?? 'Something went wrong. Please try again.'}
          </div>
        )}
        {showStopped && <span className={styles.statusTag}>Stopped</span>}
      </div>
    </div>
  );
}
