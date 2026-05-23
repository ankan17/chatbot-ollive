import { useCallback } from 'react';
import { useAsync } from './useAsync.js';
import { getConversation } from '../api/conversations.js';
import type { ConversationWithMessages } from '../api/types.js';
import type { ApiError } from '../api/errors.js';

export interface UseConversationResult {
  data?: ConversationWithMessages;
  status: 'idle' | 'loading' | 'success' | 'error';
  error?: ApiError;
  reload: () => Promise<void>;
}

export function useConversation(id: string | undefined): UseConversationResult {
  const { status, data, error, run } = useAsync(
    (signal) => {
      if (!id) return Promise.resolve(undefined as unknown as ConversationWithMessages);
      return getConversation(id, signal);
    },
    [id],
  );

  const reload = useCallback(() => run(), [run]);

  // When id is undefined, show idle so callers can detect no fetch happened
  const effectiveStatus = !id ? 'idle' : status;

  return { data: id ? data : undefined, status: effectiveStatus, error, reload };
}
