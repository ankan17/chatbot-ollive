import React, { useRef, useState } from 'react';
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

  function openRename() {
    setRenameValue(conversation.title);
    setRenaming(true);
    setMenuOpen(false);
  }

  function commitRename() {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== conversation.title) {
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
          <span className={styles.title}>{conversation.title}</span>
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
