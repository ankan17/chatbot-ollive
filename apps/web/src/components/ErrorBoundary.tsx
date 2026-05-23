import React from 'react';
import ErrorState from './states/ErrorState.js';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
}

export default class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <ErrorState
          message="Something went wrong. Please reload the page."
          onRetry={() => window.location.reload()}
        />
      );
    }
    return this.props.children;
  }
}
