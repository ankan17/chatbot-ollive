import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../api/models.js', () => ({
  fetchModels: vi.fn(),
}));

import * as modelsApi from '../api/models.js';
import MetricFilters from '../components/MetricFilters.js';
import type { RangePreset } from '../lib/time.js';

const CATALOG = {
  models: [
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', provider: 'google' },
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', provider: 'google' },
    { id: 'gpt-4o', label: 'GPT-4o', provider: 'openai' },
  ],
  defaultModel: 'gemini-2.5-flash',
};

function setup(props: { provider?: string; model?: string } = {}) {
  const onPreset = vi.fn();
  const onProvider = vi.fn();
  const onModel = vi.fn();
  render(
    <MetricFilters
      preset={'24h' as RangePreset}
      provider={props.provider}
      model={props.model}
      onPreset={onPreset}
      onProvider={onProvider}
      onModel={onModel}
    />,
  );
  return { onPreset, onProvider, onModel };
}

describe('MetricFilters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(modelsApi.fetchModels).mockResolvedValue(CATALOG);
  });

  it('renders provider and model as dropdown triggers defaulting to "All"', async () => {
    setup();
    expect(await screen.findByRole('button', { name: /provider: all providers/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /model: all models/i })).toBeInTheDocument();
  });

  it('fires onModel with the model id when a model is picked from the menu', async () => {
    const user = userEvent.setup();
    const { onModel } = setup();
    await user.click(await screen.findByRole('button', { name: /model/i }));
    await user.click(await screen.findByRole('option', { name: 'Gemini 2.5 Pro' }));
    expect(onModel).toHaveBeenCalledWith('gemini-2.5-pro');
  });

  it('fires onModel with undefined when "All models" is picked', async () => {
    const user = userEvent.setup();
    const { onModel } = setup({ model: 'gemini-2.5-flash' });
    await user.click(await screen.findByRole('button', { name: /model/i }));
    await user.click(await screen.findByRole('option', { name: /all models/i }));
    expect(onModel).toHaveBeenCalledWith(undefined);
  });

  it('selecting a provider narrows the model list and resets a now-invalid model', async () => {
    const user = userEvent.setup();
    const { onProvider, onModel } = setup({ model: 'gemini-2.5-flash' });
    await user.click(await screen.findByRole('button', { name: /provider/i }));
    await user.click(await screen.findByRole('option', { name: 'openai' }));
    expect(onProvider).toHaveBeenCalledWith('openai');
    // 'gemini-2.5-flash' isn't an OpenAI model, so the model filter is cleared.
    expect(onModel).toHaveBeenCalledWith(undefined);
  });

  it('the model menu lists only the selected provider\'s models', async () => {
    const user = userEvent.setup();
    setup({ provider: 'openai' });
    await user.click(await screen.findByRole('button', { name: /model/i }));
    expect(await screen.findByRole('option', { name: 'GPT-4o' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Gemini 2.5 Flash' })).not.toBeInTheDocument();
  });
});
