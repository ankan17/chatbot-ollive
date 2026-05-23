import React, { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import type { SessionUser } from '../api/types.js';
import ThemeToggle from './ThemeToggle.js';
import styles from './AppShell.module.css';

export interface AppShellProps {
  user: SessionUser;
  onSignOut(): void;
  /** Page-specific sidebar content (e.g. conversation history). */
  sidebar?: React.ReactNode;
  /** Page-specific topbar content (e.g. the model switcher). */
  topbar?: React.ReactNode;
  children: React.ReactNode;
}

function OliveMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M8 15c2-1 4-4 4-8" strokeLinecap="round" />
    </svg>
  );
}

function UserAvatar({ user }: { user: SessionUser }) {
  const initial = (user.name ?? user.email).charAt(0).toUpperCase();
  return (
    <span className={styles.avatar} aria-hidden="true">
      {initial}
    </span>
  );
}

export default function AppShell({ user, onSignOut, sidebar, topbar, children }: AppShellProps) {
  const navigate = useNavigate();
  const [navOpen, setNavOpen] = useState(false);

  return (
    <div className={styles.shell}>
      <aside className={`${styles.sidebar} ${navOpen ? styles.sidebarOpen : ''}`}>
        <div className={styles.brand}>
          <OliveMark className={styles.mark} />
          <span className={styles.word}>Ollive</span>
        </div>

        <button type="button" className={styles.newChat} onClick={() => { navigate('/'); setNavOpen(false); }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
          New chat
        </button>

        <nav className={styles.nav}>
          <NavLink
            to="/"
            end
            className={({ isActive }) => `${styles.navItem} ${isActive ? styles.active : ''}`}
            onClick={() => setNavOpen(false)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 11.5a8.38 8.38 0 0 1-9 8.4 9.5 9.5 0 0 1-4-.9L3 21l1.9-4a8.38 8.38 0 0 1-.9-4 8.5 8.5 0 0 1 17 0z" />
            </svg>
            Chat
          </NavLink>
          <NavLink
            to="/dashboards"
            className={({ isActive }) => `${styles.navItem} ${isActive ? styles.active : ''}`}
            onClick={() => setNavOpen(false)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 3v18h18" />
              <path d="M7 14l4-4 3 3 5-6" />
            </svg>
            Metrics
          </NavLink>
        </nav>

        {sidebar && <div className={styles.sidebarSlot}>{sidebar}</div>}

        <div className={styles.footer}>
          <ThemeToggle />
          <div className={styles.userChip}>
            <UserAvatar user={user} />
            <span className={styles.userName}>{user.name ?? user.email}</span>
            <button type="button" className={styles.signOutBtn} onClick={onSignOut} aria-label="Sign out">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
              </svg>
            </button>
          </div>
        </div>
      </aside>

      {navOpen && <div className={styles.scrim} onClick={() => setNavOpen(false)} aria-hidden="true" />}

      <div className={styles.main}>
        <header className={styles.topbar}>
          <button
            type="button"
            className={styles.menuBtn}
            aria-label="Open menu"
            onClick={() => setNavOpen(true)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="M3 6h18M3 12h18M3 18h18" />
            </svg>
          </button>
          {topbar}
        </header>
        <div className={styles.content}>{children}</div>
      </div>
    </div>
  );
}
