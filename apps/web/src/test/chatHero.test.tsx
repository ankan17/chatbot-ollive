import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ChatHero from '../components/ChatHero.js';

describe('ChatHero', () => {
  it('renders the title and subtitle', () => {
    render(<ChatHero title="How can I help?" subtitle="Ask anything." onPickPrompt={() => {}} />);
    expect(screen.getByRole('heading', { name: /how can i help/i })).toBeInTheDocument();
    expect(screen.getByText('Ask anything.')).toBeInTheDocument();
  });

  it('calls onPickPrompt with the prompt text when a chip is clicked', async () => {
    const onPick = vi.fn();
    render(<ChatHero title="t" subtitle="s" onPickPrompt={onPick} />);
    await userEvent.click(screen.getByRole('button', { name: /draft an email/i }));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick.mock.calls[0][0]).toMatch(/email/i);
  });
});
