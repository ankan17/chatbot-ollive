import React from 'react';
import styles from './ErrorState.module.css';

interface ErrorStateProps {
  message?: string;
  onRetry?: () => void;
}

export default function ErrorState({
  message = 'Something went wrong.',
  onRetry,
}: ErrorStateProps) {
  return (
    <div className={styles.error}>
      <p className={styles.message}>{message}</p>
      {onRetry && (
        <button className={styles.retryBtn} onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}
