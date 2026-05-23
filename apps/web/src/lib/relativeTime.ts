const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Format an ISO timestamp relative to `now` (defaults to Date.now()).
 * Buckets:
 *   < 1 min  → "just now"
 *   < 1 hour → "Nm ago"
 *   < 24 hrs → "Nh ago"
 *   < 48 hrs → "yesterday"
 *   else     → short date e.g. "May 21"
 */
export function formatRelative(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const diff = now.getTime() - then.getTime();

  if (diff < MINUTE) return 'just now';
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h ago`;
  if (diff < 2 * DAY) return 'yesterday';

  return then.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
