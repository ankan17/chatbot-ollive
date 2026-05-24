import React from 'react';
import styles from './GuestSignInPrompt.module.css';

interface GuestSignInPromptProps {
  onSignIn: () => void;
}

export default function GuestSignInPrompt({ onSignIn }: GuestSignInPromptProps) {
  return (
    <div className={styles.prompt}>
      <p className={styles.message}>
        You&apos;ve used your free trial messages. Sign in to keep chatting and save your conversation.
      </p>
      <button
        className={styles.button}
        onClick={onSignIn}
        type="button"
      >
        Sign in with Google
      </button>
    </div>
  );
}
