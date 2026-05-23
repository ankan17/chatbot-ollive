import React from 'react';
import type { Conversation } from '../api/types.js';
import ConversationListItem from './ConversationListItem.js';
import styles from './Sidebar.module.css';

interface SidebarProps {
  conversations: Conversation[];
  activeId?: string;
  statusFilter: 'active' | 'archived';
  status: 'idle' | 'loading' | 'success' | 'error';
  onSelect(id: string): void;
  onToggleFilter(s: 'active' | 'archived'): void;
  onRename(id: string, title: string): void;
  onArchive(id: string, archived: boolean): void;
}

export default function Sidebar({
  conversations,
  activeId,
  statusFilter,
  status,
  onSelect,
  onToggleFilter,
  onRename,
  onArchive,
}: SidebarProps) {
  return (
    <div className={styles.sidebar}>
      <div className={styles.filterRow}>
        <button
          className={`${styles.filterBtn} ${statusFilter === 'active' ? styles.activeFilter : ''}`}
          onClick={() => onToggleFilter('active')}
          type="button"
        >
          Active
        </button>
        <button
          className={`${styles.filterBtn} ${statusFilter === 'archived' ? styles.activeFilter : ''}`}
          onClick={() => onToggleFilter('archived')}
          type="button"
        >
          Archived
        </button>
      </div>

      <div className={styles.list}>
        {status === 'loading' && conversations.length === 0 ? (
          <p className={styles.empty}>Loading…</p>
        ) : conversations.length === 0 ? (
          <p className={styles.empty}>
            {statusFilter === 'archived' ? 'No archived chats.' : 'No conversations yet.'}
          </p>
        ) : (
          conversations.map((conv) => (
            <ConversationListItem
              key={conv.id}
              conversation={conv}
              active={conv.id === activeId}
              onSelect={() => onSelect(conv.id)}
              onRename={(title) => onRename(conv.id, title)}
              onArchive={(archived) => onArchive(conv.id, archived)}
            />
          ))
        )}
      </div>
    </div>
  );
}
