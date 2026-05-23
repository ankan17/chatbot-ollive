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
      // Within 50px of bottom => stick; scrolled up => don't
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

  return (
    <div ref={containerRef} className={styles.list}>
      {messages.map((msg) => (
        <MessageBubble key={msg.id} message={msg} />
      ))}
      <div ref={sentinelRef} className={styles.sentinel} />
    </div>
  );
}
