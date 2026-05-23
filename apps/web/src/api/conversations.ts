import { request } from './http.js';
import type {
  ConversationListPage,
  Conversation,
  ConversationDetail,
  GuestMessageInput,
} from './types.js';

interface ListConversationsParams {
  status: 'active' | 'archived';
  cursor?: string;
  limit?: number;
}

export function listConversations(
  params: ListConversationsParams,
  signal?: AbortSignal,
): Promise<ConversationListPage> {
  return request<ConversationListPage>('/v1/conversations', {
    query: { status: params.status, cursor: params.cursor, limit: params.limit },
    signal,
  });
}

export function createConversation(input?: { title?: string; model?: string }): Promise<Conversation> {
  return request<Conversation>('/v1/conversations', { method: 'POST', body: input ?? {} });
}

export function getConversation(id: string, signal?: AbortSignal): Promise<ConversationDetail> {
  return request<ConversationDetail>(`/v1/conversations/${id}`, { signal });
}

export function patchConversation(
  id: string,
  patch: { title?: string; status?: 'active' | 'archived'; model?: string },
): Promise<Conversation> {
  return request<Conversation>(`/v1/conversations/${id}`, { method: 'PATCH', body: patch });
}

export function importConversation(input: {
  clientConversationId?: string;
  messages: GuestMessageInput[];
}): Promise<ConversationDetail> {
  return request<ConversationDetail>('/v1/conversations/import', { method: 'POST', body: input });
}
