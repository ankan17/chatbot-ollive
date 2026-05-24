/**
 * Serializers: Drizzle rows → @ollive/shared/api response types.
 * Single source of truth for the §2 wire shape — imported by all conversation routes and Plan 5.
 */
import type {
  ConversationSummary,
  Conversation,
  Message,
  ConversationDetail,
} from '@ollive/shared/api';

// Drizzle row shapes (minimal — what the queries return)
export interface ConversationRow {
  id: string;
  title: string;
  status: string;
  provider: string;
  model: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface MessageRow {
  id: string;
  role: string;
  content: string;
  tokenCount: number | null;
  sequence: number;
  status: string;
  errorMessage: string | null;
  createdAt: Date;
}

/**
 * Map a conversation row to a ConversationSummary (list item).
 * NO messages, NO title_source per RESOLUTION 1.
 */
export function toConversationSummary(row: ConversationRow): ConversationSummary {
  return {
    id: row.id,
    title: row.title,
    status: row.status as 'active' | 'archived',
    provider: row.provider,
    model: row.model,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Map a conversation row to a Conversation (POST/PATCH response header).
 * Same shape as ConversationSummary (type alias).
 */
export function toConversation(row: ConversationRow): Conversation {
  return toConversationSummary(row);
}

/**
 * Map a message row to a Message.
 * tokenCount is OMITTED entirely when null (user messages / not-yet-counted).
 */
export function toMessage(row: MessageRow): Message {
  const msg: Message = {
    id: row.id,
    role: row.role as 'user' | 'assistant' | 'system',
    content: row.content,
    status: row.status as 'complete' | 'partial' | 'error',
    sequence: row.sequence,
    createdAt: row.createdAt.toISOString(),
  };
  // tokenCount omitted when null — distinct from 0
  if (row.tokenCount != null) {
    msg.tokenCount = row.tokenCount;
  }
  // errorMessage only present on failed turns
  if (row.errorMessage != null) {
    msg.errorMessage = row.errorMessage;
  }
  return msg;
}

/**
 * Map a conversation row + its message rows to a ConversationDetail.
 * Messages ordered by sequence ASC.
 */
export function toConversationDetail(
  conv: ConversationRow,
  msgs: MessageRow[],
): ConversationDetail {
  return {
    ...toConversation(conv),
    messages: msgs
      .slice()
      .sort((a, b) => a.sequence - b.sequence)
      .map(toMessage),
  };
}
