import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '../state/themeContext.js';
import ThemeToggle from '../components/ThemeToggle.js';

function mockPrefersLight(prefersLight: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('light') ? prefersLight : !prefersLight,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

function renderToggle() {
  return render(
    <ThemeProvider>
      <ThemeToggle />
    </ThemeProvider>,
  );
}

describe('ThemeToggle', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    mockPrefersLight(false); // default → dark
  });

  it('renders a dark and a light option', () => {
    renderToggle();
    expect(screen.getByRole('button', { name: /dark theme/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /light theme/i })).toBeInTheDocument();
  });

  it('marks the active theme pressed (default dark)', () => {
    renderToggle();
    expect(screen.getByRole('button', { name: /dark theme/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /light theme/i })).toHaveAttribute('aria-pressed', 'false');
  });

  it('switches the theme on click', async () => {
    const user = userEvent.setup();
    renderToggle();
    await user.click(screen.getByRole('button', { name: /light theme/i }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(screen.getByRole('button', { name: /light theme/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /dark theme/i })).toHaveAttribute('aria-pressed', 'false');
  });
});
