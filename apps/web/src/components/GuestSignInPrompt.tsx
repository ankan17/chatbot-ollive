import React from 'react';
import { googleSignInUrl } from '../api/session.js';
import styles from './GuestSignInPrompt.module.css';

export default function GuestSignInPrompt() {
  return (
    <div className={styles.prompt}>
      <p className={styles.message}>
        You&apos;ve used your free trial messages. Sign in to keep chatting and save your conversation.
      </p>
      <button
        className={styles.button}
        onClick={() => window.location.assign(googleSignInUrl())}
        type="button"
      >
        Sign in with Google
      </button>
    </div>
  );
}
