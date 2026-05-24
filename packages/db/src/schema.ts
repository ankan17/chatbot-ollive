import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  integer,
  numeric,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  googleSub: text('google_sub').notNull().unique(),
  email: text('email').notNull().unique(),
  name: text('name'),
  avatarUrl: text('avatar_url'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
});

export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull().default('New conversation'),
    titleSource: text('title_source').notNull().default('default'),
    status: text('status').notNull().default('active'),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    clientConversationId: text('client_conversation_id'), // nullable — idempotency key for import
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    // NOTE: updatedAt is NOT auto-maintained by a DB trigger. Every UPDATE path in the
    // application layer must set updatedAt explicitly (or add a BEFORE UPDATE trigger).
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_conv_user_status_updated').on(t.userId, t.status, t.updatedAt),
    check('conv_status_check', sql`${t.status} in ('active','archived')`),
    check('conv_title_source_check', sql`${t.titleSource} in ('default','auto','user')`),
    // Partial unique index — allows multiple NULLs; enforces uniqueness only when non-null
    uniqueIndex('uq_conv_user_client_convo')
      .on(t.userId, t.clientConversationId)
      .where(sql`${t.clientConversationId} is not null`),
  ],
);

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    content: text('content').notNull().default(''),
    tokenCount: integer('token_count'),
    sequence: integer('sequence').notNull(),
    status: text('status').notNull().default('complete'),
    // User-facing reason persisted for failed turns (status='error') so a reload shows
    // the same message the user saw live. Null for non-error messages.
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_msg_conv_seq').on(t.conversationId, t.sequence),
    check('msg_role_check', sql`${t.role} in ('user','assistant','system')`),
    check('msg_status_check', sql`${t.status} in ('complete','partial','error')`),
  ],
);

export const inferenceLogs = pgTable(
  'inference_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requestId: uuid('request_id').notNull().unique(),
    conversationId: uuid('conversation_id').references(() => conversations.id, {
      onDelete: 'set null',
    }),
    messageId: uuid('message_id').references(() => messages.id, { onDelete: 'set null' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    status: text('status').notNull(),
    latencyMs: integer('latency_ms'),
    timeToFirstTokenMs: integer('time_to_first_token_ms'),
    promptTokens: integer('prompt_tokens'),
    completionTokens: integer('completion_tokens'),
    totalTokens: integer('total_tokens'),
    inputPreview: text('input_preview'),
    outputPreview: text('output_preview'),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    // extracted (worker-derived) metadata — PRD §16.1
    estimatedCostUsd: numeric('estimated_cost_usd', { precision: 12, scale: 6 }),
    errorCategory: text('error_category'),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_logs_created').on(t.createdAt),
    index('idx_logs_prov_model').on(t.provider, t.model),
    index('idx_logs_status').on(t.status),
    index('idx_logs_conv').on(t.conversationId),
    check('logs_status_check', sql`${t.status} in ('success','error','cancelled')`),
    check(
      'logs_error_category_check',
      sql`${t.errorCategory} is null or ${t.errorCategory} in ('rate_limit','timeout','auth','content_filter','other')`,
    ),
  ],
);
