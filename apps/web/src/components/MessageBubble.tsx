import React from 'react';
import ReactMarkdown from 'react-markdown';
import type { ChatMessage } from '../api/types.js';
import styles from './MessageBubble.module.css';

interface MessageBubbleProps {
  message: ChatMessage;
}

export default function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const isError = message.status === 'error';
  const isPartial = message.status === 'partial' && message.role === 'assistant';

  return (
    <div className={`${styles.bubble} ${isUser ? styles.user : styles.assistant}`}>
      <div className={`${styles.content} ${isError ? styles.errorContent : ''}`}>
        {isUser ? (
          message.content
        ) : (
          <ReactMarkdown>{message.content}</ReactMarkdown>
        )}
      </div>
      {isError && <span className={styles.statusTag}>Error</span>}
      {isPartial && !isError && <span className={styles.statusTag}>Stopped</span>}
    </div>
  );
}
