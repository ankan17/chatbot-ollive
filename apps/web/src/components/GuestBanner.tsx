import React from 'react';
import styles from './GuestBanner.module.css';

interface GuestBannerProps {
  remaining: number;
  limit: number;
  onSignIn: () => void;
}

export default function GuestBanner({ remaining, onSignIn }: GuestBannerProps) {
  const plural = remaining === 1 ? 'message' : 'messages';

  return (
    <div className={`${styles.banner} ${remaining === 0 ? styles.exhausted : ''}`}>
      <span className={styles.message}>
        {remaining > 0
          ? `${remaining} ${plural} left in your free trial.`
          : 'Free trial used up.'}
        {' '}
        Sign in to continue.
      </span>
      <button
        className={styles.signInLink}
        onClick={onSignIn}
        type="button"
      >
        Sign in
      </button>
    </div>
  );
}
