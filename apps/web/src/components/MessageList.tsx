import React, { useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '../api/types.js';
import MessageBubble from './MessageBubble.js';
import styles from './MessageList.module.css';

interface MessageListProps {
  messages: ChatMessage[];
  isStreaming: boolean;
}

export default function MessageList({ messages, isStreaming }: MessageListProps) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [stickToBottom, setStickToBottom] = useState(true);

  // Track user scroll to decide if we should stick to bottom
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    function handleScroll() {
      if (!container) return;
      const distanceFromBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight;
      setStickToBottom(distanceFromBottom < 50);
    }

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, []);

  // Auto-scroll when messages change or streaming, if stuck to bottom
  useEffect(() => {
    if (stickToBottom) {
      sentinelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [messages, isStreaming, stickToBottom]);

  function scrollToLatest() {
    setStickToBottom(true);
    sentinelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }

  return (
    <div className={styles.wrap}>
      <div ref={containerRef} className={styles.scroll}>
        <div className={styles.inner}>
          {messages.map((msg, i) => (
            <MessageBubble
              key={msg.id}
              message={msg}
              isStreaming={isStreaming && i === messages.length - 1}
            />
          ))}
          <div ref={sentinelRef} className={styles.sentinel} />
        </div>
      </div>

      {!stickToBottom && (
        <button type="button" className={styles.toLatest} onClick={scrollToLatest}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 5v14M5 12l7 7 7-7" />
          </svg>
          Latest
        </button>
      )}
    </div>
  );
}
