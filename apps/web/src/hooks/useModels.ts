import { useAsync } from './useAsync.js';
import { fetchModels } from '../api/models.js';
import type { ModelInfo } from '../api/types.js';
import type { ApiError } from '../api/errors.js';

export interface UseModelsResult {
  models: ModelInfo[];
  defaultModel?: string;
  loading: boolean;
  error?: ApiError;
}

/** Loads the available models. On failure returns an empty list + the error. */
export function useModels(): UseModelsResult {
  const { status, data, error } = useAsync((signal) => fetchModels(signal), []);
  return {
    models: data?.models ?? [],
    defaultModel: data?.defaultModel,
    loading: status === 'idle' || status === 'loading',
    error,
  };
}
