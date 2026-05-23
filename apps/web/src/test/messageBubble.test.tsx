import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import MessageBubble from '../components/MessageBubble.js';
import type { ChatMessage } from '../api/types.js';

function makeMsg(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: 'msg-1',
    role: 'user',
    content: 'hello',
    status: 'complete',
    sequence: 0,
    createdAt: '2026-05-23T00:00:00.000Z',
    ...overrides,
  };
}

describe('MessageBubble', () => {
  it('renders assistant markdown — **bold** becomes <strong>', () => {
    const msg = makeMsg({ role: 'assistant', content: '**bold text**' });
    render(<MessageBubble message={msg} />);
    const strong = screen.getByRole('strong') ?? document.querySelector('strong');
    // react-markdown renders **bold** as <strong>
    expect(document.querySelector('strong')).not.toBeNull();
    expect(document.querySelector('strong')?.textContent).toBe('bold text');
  });

  it('renders user message as plain text, not markdown', () => {
    const msg = makeMsg({ role: 'user', content: '**not bold**' });
    const { container } = render(<MessageBubble message={msg} />);
    expect(container.querySelector('strong')).toBeNull();
    expect(container.textContent).toContain('**not bold**');
  });

  it('shows Stopped tag for assistant partial status', () => {
    const msg = makeMsg({ role: 'assistant', content: 'partial', status: 'partial' });
    render(<MessageBubble message={msg} />);
    expect(screen.getByText('Stopped')).toBeInTheDocument();
  });

  it('shows Error tag for error status', () => {
    const msg = makeMsg({ role: 'assistant', content: '', status: 'error' });
    render(<MessageBubble message={msg} />);
    expect(screen.getByText('Error')).toBeInTheDocument();
  });
});
