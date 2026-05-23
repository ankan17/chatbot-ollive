import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import Redis from 'ioredis';
import {
  runMigrations,
  createDb,
  users as usersTable,
  conversations as conversationsTable,
  messages as messagesTable,
} from '@ollive/db';
import { eq } from 'drizzle-orm';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/app.js';
import { createUserRepository } from '../src/users/repository.js';
import { createConversationRepository } from '../src/conversations/repository.js';
import { signSession } from '../src/auth/jwt.js';
import { FakeChatProvider } from './fakes.js';
import type { LLMProvider, ChatRequest, StreamChunk, CallContext } from '@ollive/llm-sdk';

/**
 * TitleFailProvider: succeeds for normal chat calls but throws on title_generation calls.
 * Used to test FR17 (title-gen failure leaves default title intact).
 */
class TitleFailProvider implements LLMProvider {
  readonly name = 'title-fail-fake';

  async *streamChat(
    _req: ChatRequest,
    opts?: { signal?: AbortSignal; context?: CallContext },
  ): AsyncIterable<StreamChunk> {
    if (opts?.context?.metadata?.kind === 'title_generation') {
      throw new Error('title generation service unavailable');
    }
    yield { delta: 'Hello' };
    yield { delta: ' world' };
    yield {
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      finishReason: 'stop',
    };
  }
}

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://ollive:ollive@localhost:5432/ollive';
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

const config = loadConfig({
  DATABASE_URL,
  REDIS_URL,
  PORT: '4000',
  INGESTION_API_KEY: 'test-key',
  JWT_SECRET: 'test-jwt-secret-for-chat-tests',
  AUTH_MODE: 'dev',
  WEB_ORIGIN: 'http://localhost:5173',
  NODE_ENV: 'test',
  GEMINI_API_KEY: 'dummy-gemini-key-for-tests',
});

let db: ReturnType<typeof createDb>;
let redis: InstanceType<typeof Redis>;

async function sessionCookieFor(userId: string, email: string): Promise<string> {
  const token = await signSession({ sub: userId, email }, config.jwtSecret);
  return `session=${token}`;
}

/** Parse SSE event stream text into array of { event, data } objects. */
function parseSseEvents(text: string): { event: string; data: unknown }[] {
  const events: { event: string; data: unknown }[] = [];
  const blocks = text.split('\n\n').filter((b) => b.trim() && !b.startsWith(': '));
  for (const block of blocks) {
    const lines = block.split('\n');
    let event = '';
    let data = '';
    for (const line of lines) {
      if (line.startsWith('event: ')) event = line.slice(7).trim();
      if (line.startsWith('data: ')) data = line.slice(6).trim();
    }
    if (event && data) {
      try {
        events.push({ event, data: JSON.parse(data) });
      } catch {
        events.push({ event, data });
      }
    }
  }
  return events;
}

beforeAll(async () => {
  await runMigrations(DATABASE_URL);
  db = createDb(DATABASE_URL);
  redis = new Redis(REDIS_URL, { maxRetriesPerRequest: null, db: 1 });
});

afterAll(async () => {
  redis.disconnect();
  await db.$client.end({ timeout: 5 });
});

afterEach(async () => {
  await db.delete(usersTable);
});

describe('POST /v1/conversations/:id/messages — happy path', () => {
  it('streams events; user + assistant messages persisted; conversations.updated_at advanced', async () => {
    const chatProvider = new FakeChatProvider({
      deltas: ['Hello', ' world'],
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    });
    const app = createApp({ db, redis, config, chatProvider });
    const userRepo = createUserRepository(db);
    const user = await userRepo.upsertByGoogleSub({ googleSub: 'chat-happy-sub', email: 'chat-happy@test.com' });
    const cookie = await sessionCookieFor(user.id, user.email);

    const convRepo = createConversationRepository(db);
    const conv = await convRepo.create({ userId: user.id, provider: 'google', model: config.defaultModel });
    const before = new Date(conv.updatedAt);

    const res = await request(app)
      .post(`/v1/conversations/${conv.id}/messages`)
      .set('Cookie', cookie)
      .set('Content-Type', 'application/json')
      .send({ content: 'Hi there' });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);

    const events = parseSseEvents(res.text);
    const eventNames = events.map((e) => e.event);
    expect(eventNames[0]).toBe('start');
    // `done` terminates the message stream; on a first response a `title` event
    // may trail it (auto-naming). Nothing other than `title` follows `done`.
    const doneIdx = eventNames.indexOf('done');
    expect(doneIdx).toBeGreaterThan(-1);
    expect(eventNames.slice(doneIdx + 1).every((n) => n === 'title')).toBe(true);
    expect(eventNames.some((n) => n === 'token')).toBe(true);

    // start event
    const startEvent = events.find((e) => e.event === 'start')!;
    const startData = startEvent.data as { messageId: string; requestId: string };
    expect(startData.messageId).toBeTruthy();
    expect(startData.requestId).toBeTruthy();

    // done event has usage
    const doneEvent = events.find((e) => e.event === 'done')!;
    const doneData = doneEvent.data as { messageId: string; finishReason: string; usage: { promptTokens: number; completionTokens: number; totalTokens: number } };
    expect(doneData.messageId).toBe(startData.messageId);
    expect(doneData.finishReason).toBe('stop');
    expect(doneData.usage).toBeDefined();
    expect(doneData.usage.promptTokens).toBe(10);
    expect(doneData.usage.completionTokens).toBe(5);
    expect(doneData.usage.totalTokens).toBe(15);

    // Check messages persisted
    const msgs = await db.select().from(messagesTable).where(eq(messagesTable.conversationId, conv.id)).orderBy(messagesTable.sequence);
    expect(msgs.length).toBe(2);
    expect(msgs[0].role).toBe('user');
    expect(msgs[0].content).toBe('Hi there');
    expect(msgs[0].status).toBe('complete');
    expect(msgs[1].role).toBe('assistant');
    expect(msgs[1].content).toBe('Hello world');
    expect(msgs[1].status).toBe('complete');
    expect(msgs[1].tokenCount).toBe(5); // completionTokens from usage

    // Check conversations.updated_at advanced
    const updatedConv = await db.select().from(conversationsTable).where(eq(conversationsTable.id, conv.id)).limit(1);
    expect(new Date(updatedConv[0].updatedAt).getTime()).toBeGreaterThanOrEqual(before.getTime());
  });
});

describe('POST /v1/conversations/:id/messages — done.usage always present', () => {
  it('done carries zeroed usage even when FakeChatProvider emits no usage chunk', async () => {
    const chatProvider = new FakeChatProvider({ deltas: ['Hi'] }); // no usage
    const app = createApp({ db, redis, config, chatProvider });
    const userRepo = createUserRepository(db);
    const user = await userRepo.upsertByGoogleSub({ googleSub: 'chat-no-usage-sub', email: 'chat-no-usage@test.com' });
    const cookie = await sessionCookieFor(user.id, user.email);
    const convRepo = createConversationRepository(db);
    const conv = await convRepo.create({ userId: user.id, provider: 'google', model: config.defaultModel });

    const res = await request(app)
      .post(`/v1/conversations/${conv.id}/messages`)
      .set('Cookie', cookie)
      .send({ content: 'Hello' });

    const events = parseSseEvents(res.text);
    const doneEvent = events.find((e) => e.event === 'done')!;
    const doneData = doneEvent.data as { usage: { promptTokens: number; completionTokens: number; totalTokens: number } };
    expect(doneData.usage).toBeDefined();
    expect(doneData.usage.promptTokens).toBe(0);
    expect(doneData.usage.completionTokens).toBe(0);
    expect(doneData.usage.totalTokens).toBe(0);
  });
});

describe('POST /v1/conversations/:id/messages — sequence numbering', () => {
  it('two turns produce sequences 1,2,3,4 with no gaps', async () => {
    const chatProvider = new FakeChatProvider({
      deltas: ['A'],
      usage: { promptTokens: 5, completionTokens: 2, totalTokens: 7 },
    });
    const app = createApp({ db, redis, config, chatProvider });
    const userRepo = createUserRepository(db);
    const user = await userRepo.upsertByGoogleSub({ googleSub: 'chat-seq-sub', email: 'chat-seq@test.com' });
    const cookie = await sessionCookieFor(user.id, user.email);
    const convRepo = createConversationRepository(db);
    const conv = await convRepo.create({ userId: user.id, provider: 'google', model: config.defaultModel });

    await request(app)
      .post(`/v1/conversations/${conv.id}/messages`)
      .set('Cookie', cookie)
      .send({ content: 'First' });

    // Reset provider for second turn
    const chatProvider2 = new FakeChatProvider({
      deltas: ['B'],
      usage: { promptTokens: 5, completionTokens: 2, totalTokens: 7 },
    });
    const app2 = createApp({ db, redis, config, chatProvider: chatProvider2 });

    await request(app2)
      .post(`/v1/conversations/${conv.id}/messages`)
      .set('Cookie', cookie)
      .send({ content: 'Second' });

    const msgs = await db.select().from(messagesTable).where(eq(messagesTable.conversationId, conv.id)).orderBy(messagesTable.sequence);
    expect(msgs.length).toBe(4);
    expect(msgs.map((m) => m.sequence)).toEqual([1, 2, 3, 4]);
  });
});

describe('POST /v1/conversations/:id/messages — not-owned / unknown', () => {
  it('returns 404 not_found for unknown conversation id', async () => {
    const chatProvider = new FakeChatProvider({ deltas: ['Hi'] });
    const app = createApp({ db, redis, config, chatProvider });
    const userRepo = createUserRepository(db);
    const user = await userRepo.upsertByGoogleSub({ googleSub: 'chat-notfound-sub', email: 'chat-notfound@test.com' });
    const cookie = await sessionCookieFor(user.id, user.email);

    const res = await request(app)
      .post('/v1/conversations/00000000-0000-0000-0000-000000000000/messages')
      .set('Cookie', cookie)
      .send({ content: 'Hi' });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('not_found');

    // No messages written
    const msgs = await db.select().from(messagesTable);
    expect(msgs.length).toBe(0);
  });

  it('returns 404 not_found for conversation owned by another user', async () => {
    const chatProvider = new FakeChatProvider({ deltas: ['Hi'] });
    const app = createApp({ db, redis, config, chatProvider });
    const userRepo = createUserRepository(db);
    const user1 = await userRepo.upsertByGoogleSub({ googleSub: 'chat-owner-sub', email: 'chat-owner@test.com' });
    const user2 = await userRepo.upsertByGoogleSub({ googleSub: 'chat-other-sub', email: 'chat-other@test.com' });
    const convRepo = createConversationRepository(db);
    const conv = await convRepo.create({ userId: user1.id, provider: 'google', model: config.defaultModel });
    const cookie2 = await sessionCookieFor(user2.id, user2.email);

    const res = await request(app)
      .post(`/v1/conversations/${conv.id}/messages`)
      .set('Cookie', cookie2)
      .send({ content: 'Hi' });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('not_found');
  });
});

describe('POST /v1/conversations/:id/messages — validation', () => {
  it('empty content → 400 validation_error; nothing written', async () => {
    const chatProvider = new FakeChatProvider({ deltas: ['Hi'] });
    const app = createApp({ db, redis, config, chatProvider });
    const userRepo = createUserRepository(db);
    const user = await userRepo.upsertByGoogleSub({ googleSub: 'chat-val-sub', email: 'chat-val@test.com' });
    const cookie = await sessionCookieFor(user.id, user.email);
    const convRepo = createConversationRepository(db);
    const conv = await convRepo.create({ userId: user.id, provider: 'google', model: config.defaultModel });

    const res = await request(app)
      .post(`/v1/conversations/${conv.id}/messages`)
      .set('Cookie', cookie)
      .send({ content: '' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_error');

    const msgs = await db.select().from(messagesTable).where(eq(messagesTable.conversationId, conv.id));
    expect(msgs.length).toBe(0);
  });
});

describe('POST /v1/conversations/:id/messages — cancel (ST4)', () => {
  it('FakeChatProvider abortAfter:1 → assistant row is partial; no done/error event', async () => {
    const chatProvider = new FakeChatProvider({
      deltas: ['Hello', ' world'],
      abortAfter: 1, // AbortError after 1st delta
    });
    const app = createApp({ db, redis, config, chatProvider });
    const userRepo = createUserRepository(db);
    const user = await userRepo.upsertByGoogleSub({ googleSub: 'chat-cancel-sub', email: 'chat-cancel@test.com' });
    const cookie = await sessionCookieFor(user.id, user.email);
    const convRepo = createConversationRepository(db);
    const conv = await convRepo.create({ userId: user.id, provider: 'google', model: config.defaultModel });

    const res = await request(app)
      .post(`/v1/conversations/${conv.id}/messages`)
      .set('Cookie', cookie)
      .send({ content: 'Hi' });

    const events = parseSseEvents(res.text);
    const eventNames = events.map((e) => e.event);

    // Must have start + at least one token before abort
    expect(eventNames).toContain('start');
    expect(eventNames).toContain('token');
    // No done or error event on cancel
    expect(eventNames).not.toContain('done');
    expect(eventNames).not.toContain('error');

    // Assistant row ends as partial with partial content
    const msgs = await db.select().from(messagesTable).where(eq(messagesTable.conversationId, conv.id)).orderBy(messagesTable.sequence);
    const asstMsg = msgs.find((m) => m.role === 'assistant');
    expect(asstMsg).toBeDefined();
    expect(asstMsg!.status).toBe('partial');
    // Content has whatever was accumulated before abort (the first delta)
    expect(asstMsg!.content).toBe('Hello');
  });
});

describe('POST /v1/conversations/:id/messages — mid-stream error (ST6)', () => {
  it('provider throws 429 → SSE error event with code:rate_limited; assistant row is error', async () => {
    const chatProvider = new FakeChatProvider({
      deltas: ['Hi'],
      throwAfter: 1,
      throwError: new Error('429 rate limit exceeded'),
    });
    const app = createApp({ db, redis, config, chatProvider });
    const userRepo = createUserRepository(db);
    const user = await userRepo.upsertByGoogleSub({ googleSub: 'chat-err-sub', email: 'chat-err@test.com' });
    const cookie = await sessionCookieFor(user.id, user.email);
    const convRepo = createConversationRepository(db);
    const conv = await convRepo.create({ userId: user.id, provider: 'google', model: config.defaultModel });

    const res = await request(app)
      .post(`/v1/conversations/${conv.id}/messages`)
      .set('Cookie', cookie)
      .send({ content: 'Hi' });

    const events = parseSseEvents(res.text);
    const errorEvent = events.find((e) => e.event === 'error');
    expect(errorEvent).toBeDefined();
    const errData = errorEvent!.data as { code: string; message: string };
    expect(errData.code).toBe('rate_limited');
    expect(typeof errData.message).toBe('string');

    // No done event
    expect(events.map((e) => e.event)).not.toContain('done');

    // Assistant row ends as error
    const msgs = await db.select().from(messagesTable).where(eq(messagesTable.conversationId, conv.id)).orderBy(messagesTable.sequence);
    const asstMsg = msgs.find((m) => m.role === 'assistant');
    expect(asstMsg!.status).toBe('error');
    expect(asstMsg!.content).toBe('Hi'); // partial content saved
  });
});

describe('POST /v1/conversations/:id/messages — auto-naming (BE12)', () => {
  it('first response on title_source=default conversation → title updated to auto; title_source=user left unchanged', async () => {
    // FakeChatProvider must serve both the main chat AND the title gen call
    const chatProvider = new FakeChatProvider({
      deltas: ['The answer is 42'],
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    });
    // Create a second FakeChatProvider for title gen? No — same provider handles both
    // Title gen also calls streamChat on the same provider. We need it to serve 2 calls:
    // call 1: main chat → "The answer is 42"
    // call 2: title gen → "Answer Is 42"
    // Since FakeChatProvider serves same script for all calls, title gen will also get "The answer is 42"
    // The cleanTitle of that is "The answer is 42" truncated to 6 words = "The answer is 42"
    const app = createApp({ db, redis, config, chatProvider });
    const userRepo = createUserRepository(db);
    const user = await userRepo.upsertByGoogleSub({ googleSub: 'chat-autoname-sub', email: 'chat-autoname@test.com' });
    const cookie = await sessionCookieFor(user.id, user.email);
    const convRepo = createConversationRepository(db);
    const conv = await convRepo.create({ userId: user.id, provider: 'google', model: config.defaultModel });

    // Confirm initial state
    const initialConv = await db.select().from(conversationsTable).where(eq(conversationsTable.id, conv.id)).limit(1);
    expect(initialConv[0].titleSource).toBe('default');

    await request(app)
      .post(`/v1/conversations/${conv.id}/messages`)
      .set('Cookie', cookie)
      .send({ content: 'What is the answer?' });

    // Poll until title_source is no longer 'default' (fire-and-forget)
    const deadline = Date.now() + 3000;
    let updatedConv = initialConv[0];
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
      const rows = await db.select().from(conversationsTable).where(eq(conversationsTable.id, conv.id)).limit(1);
      updatedConv = rows[0]!;
      if (updatedConv.titleSource !== 'default') break;
    }

    expect(updatedConv.titleSource).toBe('auto');
    expect(updatedConv.title).not.toBe('New conversation');
  });

  it('title-gen throws → title stays "New conversation" and title_source stays "default" (FR17)', async () => {
    const chatProvider = new TitleFailProvider();
    const app = createApp({ db, redis, config, chatProvider });
    const userRepo = createUserRepository(db);
    const user = await userRepo.upsertByGoogleSub({ googleSub: 'chat-fr17-sub', email: 'chat-fr17@test.com' });
    const cookie = await sessionCookieFor(user.id, user.email);
    const convRepo = createConversationRepository(db);
    const conv = await convRepo.create({ userId: user.id, provider: 'google', model: config.defaultModel });

    // Confirm initial state
    const initialConv = await db.select().from(conversationsTable).where(eq(conversationsTable.id, conv.id)).limit(1);
    expect(initialConv[0].titleSource).toBe('default');
    expect(initialConv[0].title).toBe('New conversation');

    const res = await request(app)
      .post(`/v1/conversations/${conv.id}/messages`)
      .set('Cookie', cookie)
      .send({ content: 'What is 42?' });

    // Main stream succeeded
    const events = parseSseEvents(res.text);
    const eventNames = events.map((e) => e.event);
    expect(eventNames).toContain('done');
    expect(eventNames).not.toContain('error');

    // Poll up to ~1s waiting for the detached title-gen work to complete (or fail silently)
    const deadline = Date.now() + 1000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }

    // FR17: title-gen failure left default intact
    const rows = await db.select().from(conversationsTable).where(eq(conversationsTable.id, conv.id)).limit(1);
    expect(rows[0].title).toBe('New conversation');
    expect(rows[0].titleSource).toBe('default');
  });

  it('title_source=user conversation is left unchanged after first response', async () => {
    const chatProvider = new FakeChatProvider({
      deltas: ['OK'],
      usage: { promptTokens: 5, completionTokens: 2, totalTokens: 7 },
    });
    const app = createApp({ db, redis, config, chatProvider });
    const userRepo = createUserRepository(db);
    const user = await userRepo.upsertByGoogleSub({ googleSub: 'chat-usertitle-sub', email: 'chat-usertitle@test.com' });
    const cookie = await sessionCookieFor(user.id, user.email);
    const convRepo = createConversationRepository(db);
    const conv = await convRepo.create({ userId: user.id, provider: 'google', model: config.defaultModel });

    // Manually set title_source to 'user'
    await db.update(conversationsTable).set({ title: 'My Custom Title', titleSource: 'user' }).where(eq(conversationsTable.id, conv.id));

    await request(app)
      .post(`/v1/conversations/${conv.id}/messages`)
      .set('Cookie', cookie)
      .send({ content: 'Hi' });

    // Wait a bit to ensure fire-and-forget doesn't run
    await new Promise((r) => setTimeout(r, 200));

    const rows = await db.select().from(conversationsTable).where(eq(conversationsTable.id, conv.id)).limit(1);
    expect(rows[0].titleSource).toBe('user');
    expect(rows[0].title).toBe('My Custom Title');
  });
});
