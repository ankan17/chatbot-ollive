import React from 'react';
import { googleSignInUrl } from '../api/session.js';
import styles from './SignInScreen.module.css';

export interface SignInScreenProps {
  onSignIn(): void;
  devMode?: boolean;
}

export default function SignInScreen({ onSignIn, devMode }: SignInScreenProps) {
  function handleSignIn() {
    window.location.assign(googleSignInUrl());
    onSignIn();
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.card}>
        <h1 className={styles.title}>Ollive</h1>
        <p className={styles.tagline}>Your LLM chatbot &amp; observability platform</p>
        <button className={styles.button} onClick={handleSignIn}>
          Sign in with Google
        </button>
        {devMode && (
          <p className={styles.devNote}>Dev mode: authentication is mocked.</p>
        )}
      </div>
    </div>
  );
}
