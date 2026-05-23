import React from 'react';
import { googleSignInUrl } from '../api/session.js';
import styles from './SignInScreen.module.css';

export interface SignInScreenProps {
  onSignIn(): void;
}

export default function SignInScreen({ onSignIn }: SignInScreenProps) {
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
      </div>
    </div>
  );
}
