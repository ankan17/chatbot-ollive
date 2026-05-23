import { describe, it, expect } from 'vitest';
import { formatRelative } from '../lib/relativeTime.js';

const NOW = new Date('2026-05-23T12:00:00.000Z');

function isoAgo(ms: number): string {
  return new Date(NOW.getTime() - ms).toISOString();
}

describe('formatRelative', () => {
  it('30s → "just now"', () => {
    expect(formatRelative(isoAgo(30_000), NOW)).toBe('just now');
  });

  it('3min → "3m ago"', () => {
    expect(formatRelative(isoAgo(3 * 60_000), NOW)).toBe('3m ago');
  });

  it('2h → "2h ago"', () => {
    expect(formatRelative(isoAgo(2 * 60 * 60_000), NOW)).toBe('2h ago');
  });

  it('30h → "yesterday"', () => {
    expect(formatRelative(isoAgo(30 * 60 * 60_000), NOW)).toBe('yesterday');
  });

  it('5 days → a short date string (contains month abbreviation)', () => {
    const result = formatRelative(isoAgo(5 * 24 * 60 * 60_000), NOW);
    // e.g. "May 18" — not "just now", not "ago", not "yesterday"
    expect(result).not.toContain('ago');
    expect(result).not.toBe('just now');
    expect(result).not.toBe('yesterday');
    // Should contain a month name abbreviation
    expect(result).toMatch(/[A-Za-z]{3}/);
  });
});
