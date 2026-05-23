import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { runMigrations, createDb, users as usersTable, conversations as conversationsTable, messages as messagesTable } from '@ollive/db';
import { loadConfig } from '../src/config.js';
import { cleanTitle, maybeAutoName } from '../src/chat/naming.js';
import { FakeChatProvider } from './fakes.js';

// ---- Unit tests for cleanTitle ----

describe('cleanTitle', () => {
  it('strips surrounding double quotes and trailing period', () => {
    expect(cleanTitle('"Trip planning to Kyoto."')).toBe('Trip planning to Kyoto');
  });

  it('strips surrounding single quotes', () => {
    expect(cleanTitle("'A quick brown fox'")).toBe('A quick brown fox');
  });

  it('strips trailing period without quotes', () => {
    expect(cleanTitle('My cool title.')).toBe('My cool title');
  });

  it('truncates to first 6 words by default', () => {
    expect(cleanTitle('one two three four five six seven eight')).toBe('one two three four five six');
  });

  it('respects custom maxWords', () => {
    expect(cleanTitle('one two three four five six', 3)).toBe('one two three');
  });

  it('trims leading/trailing whitespace', () => {
    expect(cleanTitle('  hello world  ')).toBe('hello world');
  });

  it('collapses internal whitespace', () => {
    expect(cleanTitle('hello   world  foo')).toBe('hello world foo');
  });

  it('whitespace-only string → "New conversation"', () => {
    expect(cleanTitle('   ')).toBe('New conversation');
  });

  it('empty string → "New conversation"', () => {
    expect(cleanTitle('')).toBe('New conversation');
  });

  it('only quotes → "New conversation"', () => {
    expect(cleanTitle('""')).toBe('New conversation');
  });
});

// ---- Integration tests for maybeAutoName (real Postgres) ----

const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgres://ollive:ollive@localhost:5432/ollive';

const config = loadConfig({
  DATABASE_URL,
  REDIS_URL: process.env['REDIS_URL'] ?? 'redis://localhost:6379',
  PORT: '4000',
  INGESTION_API_KEY: 'test-key',
  JWT_SECRET: 'test-jwt-secret-for-naming',
  AUTH_MODE: 'dev',
  WEB_ORIGIN: 'http://localhost:5173',
  NODE_ENV: 'test',
  GEMINI_API_KEY: 'dummy-gemini-key-for-tests',
});

let db: ReturnType<typeof createDb>;

beforeAll(async () => {
  await runMigrations(DATABASE_URL);
  db = createDb(DATABASE_URL);
});

afterAll(async () => {
  await db.$client.end({ timeout: 5 });
});

afterEach(async () => {
  // Clean up all users (cascade deletes conversations + messages)
  await db.delete(usersTable);
});

/** Seed a user + conversation + messages and return the conversation id */
async function seedConversation(opts: {
  titleSource?: string;
  title?: string;
  firstUserContent?: string;
  firstAsstContent?: string;
}): Promise<{ conversationId: string; userId: string }> {
  const [user] = await db
    .insert(usersTable)
    .values({
      googleSub: `naming-test-${Date.now()}`,
      email: `naming-${Date.now()}@test.com`,
    })
    .returning();

  const [conv] = await db
    .insert(conversationsTable)
    .values({
      userId: user.id,
      title: opts.title ?? 'New conversation',
      titleSource: opts.titleSource ?? 'default',
      provider: 'google',
      model: 'gemini-2.5-flash',
    })
    .returning();

  if (opts.firstUserContent || opts.firstAsstContent) {
    await db.insert(messagesTable).values([
      {
        conversationId: conv.id,
        role: 'user',
        content: opts.firstUserContent ?? 'Hello',
        sequence: 1,
        status: 'complete',
      },
      {
        conversationId: conv.id,
        role: 'assistant',
        content: opts.firstAsstContent ?? 'Hi there',
        sequence: 2,
        status: 'complete',
      },
    ]);
  }

  return { conversationId: conv.id, userId: user.id };
}

/** Wait for maybeAutoName's detached promise to settle (polls DB up to maxMs). */
async function waitForTitleUpdate(
  conversationId: string,
  expectedSource: string,
  maxMs = 3000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const [row] = await db
      .select({ titleSource: conversationsTable.titleSource })
      .from(conversationsTable)
      .where(eq(conversationsTable.id, conversationId));
    if (row?.titleSource === expectedSource) return;
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe('maybeAutoName integration', () => {
  it('title_source=default → updates title and sets title_source=auto on success', async () => {
    const { conversationId } = await seedConversation({
      firstUserContent: 'What is the capital of France?',
      firstAsstContent: 'The capital of France is Paris.',
    });

    const provider = new FakeChatProvider({
      deltas: ['Capital', ' of', ' France'],
      finishReason: 'stop',
    });

    maybeAutoName({ db, provider, model: 'gemini-2.5-flash' }, conversationId);
    await waitForTitleUpdate(conversationId, 'auto');

    const [row] = await db
      .select({ title: conversationsTable.title, titleSource: conversationsTable.titleSource })
      .from(conversationsTable)
      .where(eq(conversationsTable.id, conversationId));

    expect(row.titleSource).toBe('auto');
    expect(row.title).toBe('Capital of France');
  });

  it('title_source=user → title unchanged (FR18)', async () => {
    const { conversationId } = await seedConversation({
      titleSource: 'user',
      title: 'My Custom Title',
      firstUserContent: 'Hello',
      firstAsstContent: 'Hi',
    });

    const provider = new FakeChatProvider({
      deltas: ['Something else'],
      finishReason: 'stop',
    });

    maybeAutoName({ db, provider, model: 'gemini-2.5-flash' }, conversationId);

    // Wait a bit for the async to settle (it should no-op quickly)
    await new Promise((r) => setTimeout(r, 200));

    const [row] = await db
      .select({ title: conversationsTable.title, titleSource: conversationsTable.titleSource })
      .from(conversationsTable)
      .where(eq(conversationsTable.id, conversationId));

    expect(row.titleSource).toBe('user');
    expect(row.title).toBe('My Custom Title');
  });

  it('title_source=auto → title unchanged (FR18)', async () => {
    const { conversationId } = await seedConversation({
      titleSource: 'auto',
      title: 'Already Auto Named',
      firstUserContent: 'Hello',
      firstAsstContent: 'Hi',
    });

    const provider = new FakeChatProvider({
      deltas: ['New title'],
      finishReason: 'stop',
    });

    maybeAutoName({ db, provider, model: 'gemini-2.5-flash' }, conversationId);

    await new Promise((r) => setTimeout(r, 200));

    const [row] = await db
      .select({ title: conversationsTable.title, titleSource: conversationsTable.titleSource })
      .from(conversationsTable)
      .where(eq(conversationsTable.id, conversationId));

    expect(row.titleSource).toBe('auto');
    expect(row.title).toBe('Already Auto Named');
  });

  it('provider failure → default title preserved, title_source=default (FR17)', async () => {
    const { conversationId } = await seedConversation({
      firstUserContent: 'Tell me a joke',
      firstAsstContent: 'Why did the chicken cross the road?',
    });

    const throwingProvider = new FakeChatProvider({
      deltas: [],
      throwAfter: 0,
      throwError: new Error('provider_error: generation failed'),
    });

    const warnCalls: unknown[] = [];
    const logger = { warn: (...args: unknown[]) => warnCalls.push(args) };

    maybeAutoName({ db, provider: throwingProvider, model: 'gemini-2.5-flash', logger }, conversationId);

    // Wait a bit for the async to settle
    await new Promise((r) => setTimeout(r, 300));

    const [row] = await db
      .select({ title: conversationsTable.title, titleSource: conversationsTable.titleSource })
      .from(conversationsTable)
      .where(eq(conversationsTable.id, conversationId));

    expect(row.titleSource).toBe('default');
    expect(row.title).toBe('New conversation');
    // Logger should have been called with a warning
    expect(warnCalls.length).toBeGreaterThan(0);
  });
});
