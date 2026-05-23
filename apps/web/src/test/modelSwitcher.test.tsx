import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../api/models.js', () => ({
  fetchModels: vi.fn(),
  getStoredModel: vi.fn(() => undefined),
  setStoredModel: vi.fn(),
}));

vi.mock('../api/conversations.js', () => ({
  patchConversation: vi.fn(() => Promise.resolve()),
}));

import * as modelsApi from '../api/models.js';
import * as conversationsApi from '../api/conversations.js';
import ModelSwitcher from '../components/ModelSwitcher.js';

const MODELS = {
  models: [
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', provider: 'google', description: 'Fast' },
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', provider: 'google', description: 'Most capable' },
  ],
  defaultModel: 'gemini-2.5-flash',
};

describe('ModelSwitcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(modelsApi.getStoredModel).mockReturnValue(undefined);
    vi.mocked(modelsApi.fetchModels).mockResolvedValue(MODELS);
  });

  it('shows the default model once loaded', async () => {
    render(<ModelSwitcher />);
    expect(await screen.findByRole('button', { name: /gemini 2\.5 flash/i })).toBeInTheDocument();
  });

  it('opens the menu, persists the choice, and updates the label', async () => {
    const user = userEvent.setup();
    render(<ModelSwitcher />);

    await user.click(await screen.findByRole('button', { name: /gemini 2\.5 flash/i }));
    await user.click(await screen.findByRole('option', { name: /gemini 2\.5 pro/i }));

    expect(modelsApi.setStoredModel).toHaveBeenCalledWith('gemini-2.5-pro');
    expect(screen.getByRole('button', { name: /gemini 2\.5 pro/i })).toBeInTheDocument();
  });

  it('reflects the active conversation model and patches it on change', async () => {
    const user = userEvent.setup();
    const onModelChange = vi.fn();
    render(
      <ModelSwitcher
        conversationId="c1"
        conversationModel="gemini-2.5-flash"
        onModelChange={onModelChange}
      />,
    );

    // Shows the conversation's model, not the (empty) stored default
    await user.click(await screen.findByRole('button', { name: /gemini 2\.5 flash/i }));
    await user.click(await screen.findByRole('option', { name: /gemini 2\.5 pro/i }));

    expect(conversationsApi.patchConversation).toHaveBeenCalledWith('c1', { model: 'gemini-2.5-pro' });
    expect(onModelChange).toHaveBeenCalled();
  });

  it('patches again when switching back, before the parent prop refreshes', async () => {
    const user = userEvent.setup();
    // conversationModel stays 'flash' (parent hasn't refreshed yet) — switch-back must still fire.
    render(<ModelSwitcher conversationId="c1" conversationModel="gemini-2.5-flash" />);

    // flash -> pro
    await user.click(await screen.findByRole('button', { name: /gemini 2\.5 flash/i }));
    await user.click(await screen.findByRole('option', { name: /gemini 2\.5 pro/i }));

    // pro -> flash (switch back)
    await user.click(await screen.findByRole('button', { name: /gemini 2\.5 pro/i }));
    await user.click(await screen.findByRole('option', { name: /gemini 2\.5 flash/i }));

    expect(conversationsApi.patchConversation).toHaveBeenNthCalledWith(1, 'c1', { model: 'gemini-2.5-pro' });
    expect(conversationsApi.patchConversation).toHaveBeenNthCalledWith(2, 'c1', { model: 'gemini-2.5-flash' });
  });
});
