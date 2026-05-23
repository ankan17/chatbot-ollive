import { useCallback, useState } from 'react';
import { useAsync } from './useAsync.js';
import {
  listConversations,
  createConversation,
  patchConversation,
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
  refreshOne(): Promise<void>;
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

  const refreshOne = useCallback((): Promise<void> => {
    return run();
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
