import React from 'react';
import { NavLink } from 'react-router-dom';
import type { SessionUser } from '../api/types.js';
import styles from './AppShell.module.css';

export interface AppShellProps {
  user: SessionUser;
  onSignOut(): void;
  children: React.ReactNode;
}

function UserAvatar({ user }: { user: SessionUser }) {
  const initial = (user.name ?? user.email).charAt(0).toUpperCase();
  return (
    <span className={styles.avatar} aria-label={user.name ?? user.email}>
      {initial}
    </span>
  );
}

export default function AppShell({ user, onSignOut, children }: AppShellProps) {
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <span className={styles.logo}>Ollive</span>
        <nav className={styles.nav}>
          <NavLink
            to="/"
            end
            className={({ isActive }) => `${styles.navLink} ${isActive ? styles.active : ''}`}
          >
            Chat
          </NavLink>
          <NavLink
            to="/dashboards"
            className={({ isActive }) => `${styles.navLink} ${isActive ? styles.active : ''}`}
          >
            Dashboards
          </NavLink>
        </nav>
        <div className={styles.userArea}>
          <UserAvatar user={user} />
          <span className={styles.userName}>{user.name ?? user.email}</span>
          <button className={styles.signOutBtn} onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </header>
      <main className={styles.body}>{children}</main>
    </div>
  );
}
