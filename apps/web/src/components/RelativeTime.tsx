import React from 'react';
import { formatRelative } from '../lib/relativeTime.js';

interface RelativeTimeProps {
  iso: string;
  className?: string;
}

export default function RelativeTime({ iso, className }: RelativeTimeProps) {
  return (
    <time dateTime={iso} className={className} title={new Date(iso).toLocaleString()}>
      {formatRelative(iso)}
    </time>
  );
}
