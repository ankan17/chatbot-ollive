import React, { useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '../api/types.js';
import MessageBubble from './MessageBubble.js';
import styles from './MessageList.module.css';

interface MessageListProps {
  messages: ChatMessage[];
  isStreaming: boolean;
  /** True when the stream just finished and the typewriter should type out the buffered tail. */
  streamFinishing?: boolean;
}

export default function MessageList({ messages, isStreaming, streamFinishing = false }: MessageListProps) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [stickToBottom, setStickToBottom] = useState(true);
  // Mirror for the ResizeObserver callback, which closes over a single render.
  const stickToBottomRef = useRef(stickToBottom);
  stickToBottomRef.current = stickToBottom;

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

  // Follow the typewriter: it grows the DOM between tokens (and during the
  // finishing tail) without a `messages` change, so keep pinned to bottom here.
  useEffect(() => {
    const inner = innerRef.current;
    if (!inner) return;
    const observer = new ResizeObserver(() => {
      if (stickToBottomRef.current) {
        sentinelRef.current?.scrollIntoView({ block: 'end' });
      }
    });
    observer.observe(inner);
    return () => observer.disconnect();
  }, []);

  function scrollToLatest() {
    setStickToBottom(true);
    sentinelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }

  return (
    <div className={styles.wrap}>
      <div ref={containerRef} className={styles.scroll}>
        <div ref={innerRef} className={styles.inner}>
          {messages.map((msg, i) => {
            const isLiveAssistant =
              i === messages.length - 1 && msg.role === 'assistant';
            return (
              <MessageBubble
                key={msg.id}
                message={msg}
                isStreaming={isStreaming && i === messages.length - 1}
                animate={isLiveAssistant && (isStreaming || streamFinishing)}
                expectMore={isLiveAssistant && isStreaming}
              />
            );
          })}
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
