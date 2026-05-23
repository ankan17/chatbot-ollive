import React, { useEffect, useRef, useState } from 'react';
import type { Conversation } from '../api/types.js';
import RelativeTime from './RelativeTime.js';
import styles from './ConversationListItem.module.css';

interface ConversationListItemProps {
  conversation: Conversation;
  active: boolean;
  onSelect: () => void;
  onRename: (title: string) => void;
  onArchive: (archived: boolean) => void;
}

export default function ConversationListItem({
  conversation,
  active,
  onSelect,
  onRename,
  onArchive,
}: ConversationListItemProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(conversation.title);
  const inputRef = useRef<HTMLInputElement>(null);

  // Typewriter the title when it changes — primarily the auto-name that lands
  // after the first reply. Skipped on first mount and for the user's own rename.
  const [displayTitle, setDisplayTitle] = useState(conversation.title);
  const [typing, setTyping] = useState(false);
  const prevTitleRef = useRef(conversation.title);
  const skipAnimateRef = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const next = conversation.title;
    if (next === prevTitleRef.current) return;
    prevTitleRef.current = next;

    const skip = skipAnimateRef.current;
    skipAnimateRef.current = false;

    const reduceMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    if (intervalRef.current) clearInterval(intervalRef.current);

    if (skip || reduceMotion || !next) {
      setTyping(false);
      setDisplayTitle(next);
      return;
    }

    // Reveal one character at a time (~28ms each → ~0.6s for a short title).
    let i = 0;
    setTyping(true);
    setDisplayTitle('');
    intervalRef.current = setInterval(() => {
      i += 1;
      setDisplayTitle(next.slice(0, i));
      if (i >= next.length) {
        if (intervalRef.current) clearInterval(intervalRef.current);
        intervalRef.current = null;
        setTyping(false);
      }
    }, 28);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
    };
  }, [conversation.title]);

  function openRename() {
    setRenameValue(conversation.title);
    setRenaming(true);
    setMenuOpen(false);
  }

  function commitRename() {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== conversation.title) {
      // Don't typewriter the user's own rename — they just typed it.
      skipAnimateRef.current = true;
      onRename(trimmed);
    }
    setRenaming(false);
  }

  function cancelRename() {
    setRenameValue(conversation.title);
    setRenaming(false);
  }

  const isArchived = conversation.status === 'archived';

  return (
    <div className={`${styles.item} ${active ? styles.active : ''}`}>
      <button
        type="button"
        className={styles.mainArea}
        onClick={() => { if (!renaming) onSelect(); }}
        onKeyDown={(e) => {
          if (!renaming && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            onSelect();
          }
        }}
      >
        {renaming ? (
          <input
            ref={inputRef}
            className={styles.renameInput}
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onFocus={(e) => e.currentTarget.select()}
            onBlur={commitRename}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') commitRename();
              if (e.key === 'Escape') cancelRename();
            }}
            autoFocus
          />
        ) : (
          <span className={styles.title}>
            {displayTitle}
            {typing && <span className={styles.caret} aria-hidden="true" />}
          </span>
        )}
        <RelativeTime iso={conversation.updatedAt} className={styles.time} />
      </button>

      <button
        className={styles.menuBtn}
        onClick={(e) => {
          e.stopPropagation();
          setMenuOpen((o) => !o);
        }}
        aria-label="Conversation options"
        type="button"
      >
        ⋯
      </button>

      {menuOpen && (
        <>
          <div className={styles.scrim} onClick={() => setMenuOpen(false)} aria-hidden="true" />
          <div className={styles.dropdown} onClick={(e) => e.stopPropagation()}>
            <button
              className={styles.dropdownItem}
              onClick={() => openRename()}
              type="button"
            >
              Rename
            </button>
            <button
              className={styles.dropdownItem}
              onClick={() => {
                onArchive(!isArchived);
                setMenuOpen(false);
              }}
              type="button"
            >
              {isArchived ? 'Unarchive' : 'Archive'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
