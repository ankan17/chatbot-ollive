import React from 'react';
import { googleSignInUrl } from '../api/session.js';
import styles from './SignInScreen.module.css';

export interface SignInScreenProps {
  onSignIn(): void;
}

function OliveMark() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <path d="M7 16c3-1.5 6-6 6-12" strokeLinecap="round" />
    </svg>
  );
}

function GoogleGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z" />
    </svg>
  );
}

export default function SignInScreen({ onSignIn }: SignInScreenProps) {
  function handleSignIn() {
    window.location.assign(googleSignInUrl());
    onSignIn();
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.card}>
        <div className={styles.mark}>
          <OliveMark />
        </div>
        <h1 className={styles.title}>Ollive</h1>
        <p className={styles.tagline}>Chat with AI, with the observability to back it.</p>
        <button className={styles.button} onClick={handleSignIn} type="button">
          <GoogleGlyph />
          Continue with Google
        </button>
        <p className={styles.footnote}>Your conversations are saved to your account.</p>
      </div>
    </div>
  );
}
