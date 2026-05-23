import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { ApiError } from '../api/errors.js';

vi.mock('../api/models.js', () => ({
  fetchModels: vi.fn(),
}));

import * as modelsApi from '../api/models.js';
import { useModels } from '../hooks/useModels.js';

describe('useModels', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the available models and default on success', async () => {
    vi.mocked(modelsApi.fetchModels).mockResolvedValue({
      models: [
        { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', provider: 'google' },
        { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', provider: 'google' },
      ],
      defaultModel: 'gemini-2.5-flash',
    });

    const { result } = renderHook(() => useModels());

    await waitFor(() => expect(result.current.models.length).toBe(2));
    expect(result.current.defaultModel).toBe('gemini-2.5-flash');
    expect(result.current.error).toBeUndefined();
  });

  it('returns an empty list and the error on failure', async () => {
    vi.mocked(modelsApi.fetchModels).mockRejectedValue(new ApiError('network_error', 0, 'boom'));

    const { result } = renderHook(() => useModels());

    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.models).toEqual([]);
  });
});
