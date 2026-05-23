import { useCallback, useState } from 'react';
import { useAsync } from './useAsync.js';
import {
  listConversations,
  createConversation,
  patchConversation,
  getConversation,
} from '../api/conversations.js';
import type { Conversation } from '../api/types.js';
import type { ApiError } from '../api/errors.js';

export interface UseConversationsResult {
  items: Conversation[];
  status: 'idle' | 'loading' | 'success' | 'error';
  error?: ApiError;
  statusFilter: 'active' | 'archived';
  setStatusFilter(s: 'active' | 'archived'): void;
  reload(): Promise<void>;
  create(): Promise<Conversation>;
  rename(id: string, title: string): Promise<void>;
  archive(id: string, archived: boolean): Promise<void>;
  refreshOne(id: string): Promise<void>;
}

export function useConversations(): UseConversationsResult {
  const [statusFilter, setStatusFilter] = useState<'active' | 'archived'>('active');

  const { status, data, error, run } = useAsync(
    (signal) => listConversations({ status: statusFilter }, signal),
    [statusFilter],
  );

  const items = data?.items ?? [];

  const reload = useCallback(() => run(), [run]);

  const create = useCallback(async (): Promise<Conversation> => {
    const conv = await createConversation();
    await run();
    return conv;
  }, [run]);

  const rename = useCallback(async (id: string, title: string): Promise<void> => {
    await patchConversation(id, { title });
    await run();
  }, [run]);

  const archive = useCallback(async (id: string, archived: boolean): Promise<void> => {
    await patchConversation(id, { status: archived ? 'archived' : 'active' });
    await run();
  }, [run]);

  const refreshOne = useCallback(async (id: string): Promise<void> => {
    const updated = await getConversation(id);
    // We don't have a setter for partial updates, so just reload the whole list
    // This is fine for MVP — the list is short
    void run();
    // Suppress the unused variable; the reload is what matters
    void updated;
  }, [run]);

  return {
    items,
    status,
    error,
    statusFilter,
    setStatusFilter,
    reload,
    create,
    rename,
    archive,
    refreshOne,
  };
}
