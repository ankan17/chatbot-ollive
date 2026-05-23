import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Composer from '../components/Composer.js';

describe('Composer', () => {
  it('sends trimmed text on Enter and clears input', async () => {
    const onSend = vi.fn();
    render(
      <Composer isStreaming={false} onSend={onSend} onStop={() => undefined} />,
    );
    const textarea = screen.getByRole('textbox');
    await userEvent.type(textarea, '  hello world  ');
    await userEvent.keyboard('{Enter}');
    expect(onSend).toHaveBeenCalledWith('hello world');
    expect(textarea).toHaveValue('');
  });

  it('Shift+Enter inserts newline and does not send', async () => {
    const onSend = vi.fn();
    render(
      <Composer isStreaming={false} onSend={onSend} onStop={() => undefined} />,
    );
    const textarea = screen.getByRole('textbox');
    await userEvent.type(textarea, 'line1');
    await userEvent.keyboard('{Shift>}{Enter}{/Shift}');
    expect(onSend).not.toHaveBeenCalled();
    expect(textarea).toHaveValue('line1\n');
  });

  it('does not send empty/whitespace-only input', async () => {
    const onSend = vi.fn();
    render(
      <Composer isStreaming={false} onSend={onSend} onStop={() => undefined} />,
    );
    const textarea = screen.getByRole('textbox');
    await userEvent.type(textarea, '   ');
    await userEvent.keyboard('{Enter}');
    expect(onSend).not.toHaveBeenCalled();
  });

  it('shows Stop button and calls onStop while streaming', async () => {
    const onStop = vi.fn();
    render(
      <Composer isStreaming={true} onSend={() => undefined} onStop={onStop} />,
    );
    const stopBtn = screen.getByRole('button', { name: 'Stop' });
    expect(stopBtn).toBeInTheDocument();
    await userEvent.click(stopBtn);
    expect(onStop).toHaveBeenCalled();
  });

  it('shows Send button when not streaming', () => {
    render(
      <Composer isStreaming={false} onSend={() => undefined} onStop={() => undefined} />,
    );
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
  });
});
