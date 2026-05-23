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
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/app.js';
import { FakeChatProvider } from './fakes.js';
import { signGuestId } from '../src/middleware/guest-session.js';

const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgres://ollive:ollive@localhost:5432/ollive';
const REDIS_URL = process.env['REDIS_URL'] ?? 'redis://localhost:6379';

// Use limit=2 (same as default)
const config = loadConfig({
  DATABASE_URL,
  REDIS_URL,
  PORT: '4000',
  INGESTION_API_KEY: 'test-key',
  JWT_SECRET: 'test-jwt-secret-for-guest-tests',
  AUTH_MODE: 'dev',
  WEB_ORIGIN: 'http://localhost:5173',
  NODE_ENV: 'test',
  GEMINI_API_KEY: 'dummy-gemini-key-for-tests',
  GUEST_MESSAGE_LIMIT: '2',
});

let db: ReturnType<typeof createDb>;
let redis: InstanceType<typeof Redis>;

/** Parse SSE event stream text into array of { event, data } objects. */
function parseSseEvents(text: string): Array<{ event: string; data: unknown }> {
  const events: Array<{ event: string; data: unknown }> = [];
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

/** Extract guest_session cookie value from response Set-Cookie headers. */
function extractGuestCookie(res: request.Response): string | null {
  const setCookie = res.headers['set-cookie'] as string[] | string | undefined;
  if (!setCookie) return null;
  const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
  for (const c of cookies) {
    const match = c.match(/^guest_session=([^;]+)/);
    if (match) return match[1]!;
  }
  return null;
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
  // Clean up Redis guest keys
  const keys = await redis.keys('guest:*');
  if (keys.length > 0) await redis.del(...keys);
  // Clean up any test users
  await db.delete(usersTable);
});

describe('POST /v1/guest/messages — under cap', () => {
  it('streams text/event-stream; start + token + done; messageId=null; no DB rows; Redis incremented', async () => {
    const chatProvider = new FakeChatProvider({
      deltas: ['Hello', ' guest'],
      usage: { promptTokens: 8, completionTokens: 4, totalTokens: 12 },
    });
    const app = createApp({ db, redis, config, chatProvider });

    const msgsBefore = await db.select().from(messagesTable);
    const convsBefore = await db.select().from(conversationsTable);

    const res = await request(app)
      .post('/v1/guest/messages')
      .send({ messages: [], content: 'Hello' });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);

    const events = parseSseEvents(res.text);
    const eventNames = events.map((e) => e.event);
    expect(eventNames[0]).toBe('start');
    expect(eventNames[eventNames.length - 1]).toBe('done');
    expect(eventNames).toContain('token');

    // messageId=null for guest
    const startData = events.find((e) => e.event === 'start')!.data as { messageId: null; requestId: string };
    expect(startData.messageId).toBeNull();
    expect(startData.requestId).toBeTruthy();

    const doneData = events.find((e) => e.event === 'done')!.data as { messageId: null; finishReason: string; usage: { promptTokens: number } };
    expect(doneData.messageId).toBeNull();
    expect(doneData.usage).toBeDefined();
    expect(doneData.usage.promptTokens).toBe(8);

    // No DB rows added
    const msgsAfter = await db.select().from(messagesTable);
    const convsAfter = await db.select().from(conversationsTable);
    expect(msgsAfter.length).toBe(msgsBefore.length);
    expect(convsAfter.length).toBe(convsBefore.length);

    // Redis counter incremented
    const guestCookieValue = extractGuestCookie(res);
    expect(guestCookieValue).toBeTruthy();
    // cookie value is `guestId.signature` — extract guestId
    const guestId = guestCookieValue!.split('.')[0];
    const count = await redis.get(`guest:${guestId}:count`);
    expect(Number(count)).toBe(1);
  });

  it('done.usage always present even with no usage chunk', async () => {
    const chatProvider = new FakeChatProvider({ deltas: ['Hi'] }); // no usage
    const app = createApp({ db, redis, config, chatProvider });

    const res = await request(app)
      .post('/v1/guest/messages')
      .send({ messages: [], content: 'Hi' });

    const events = parseSseEvents(res.text);
    const doneData = events.find((e) => e.event === 'done')!.data as { usage: { promptTokens: number; completionTokens: number; totalTokens: number } };
    expect(doneData.usage.promptTokens).toBe(0);
    expect(doneData.usage.completionTokens).toBe(0);
    expect(doneData.usage.totalTokens).toBe(0);
  });
});

describe('POST /v1/guest/messages — at/over cap', () => {
  it('after GUEST_MESSAGE_LIMIT accepted turns, next request → 403 login_required remaining:0', async () => {
    const chatProvider = new FakeChatProvider({
      deltas: ['OK'],
      usage: { promptTokens: 5, completionTokens: 2, totalTokens: 7 },
    });
    const app = createApp({ db, redis, config, chatProvider });

    // First request — gets cookie
    const res1 = await request(app)
      .post('/v1/guest/messages')
      .send({ messages: [], content: 'First' });

    expect(res1.status).toBe(200);
    const guestCookieValue = extractGuestCookie(res1);
    const guestCookie = `guest_session=${guestCookieValue}`;

    // Second request — still under limit (limit=2)
    const res2 = await request(app)
      .post('/v1/guest/messages')
      .set('Cookie', guestCookie)
      .send({ messages: [], content: 'Second' });

    expect(res2.status).toBe(200);

    // Third request — over limit
    const res3 = await request(app)
      .post('/v1/guest/messages')
      .set('Cookie', guestCookie)
      .send({ messages: [], content: 'Third — should be blocked' });

    expect(res3.status).toBe(403);
    expect(res3.body.error).toBe('login_required');
    expect(res3.body.remaining).toBe(0);
    // No streaming body
    expect(res3.headers['content-type']).not.toMatch(/text\/event-stream/);
  });
});

describe('POST /v1/guest/messages — validation', () => {
  it('empty content → 400 validation_error', async () => {
    const chatProvider = new FakeChatProvider({ deltas: ['Hi'] });
    const app = createApp({ db, redis, config, chatProvider });

    const res = await request(app)
      .post('/v1/guest/messages')
      .send({ messages: [], content: '' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_error');
  });
});

describe('POST /v1/guest/messages — cancel (Task 7)', () => {
  it('AbortError mid-stream → stream closes cleanly; no error/done event; no DB rows added', async () => {
    const chatProvider = new FakeChatProvider({
      deltas: ['Hello', ' there'],
      abortAfter: 0, // AbortError after 0th delta (before yielding any delta)
    });
    const app = createApp({ db, redis, config, chatProvider });

    const msgsBefore = await db.select().from(messagesTable);
    const convsBefore = await db.select().from(conversationsTable);

    const res = await request(app)
      .post('/v1/guest/messages')
      .send({ messages: [], content: 'Hi' });

    const events = parseSseEvents(res.text);
    const eventNames = events.map((e) => e.event);

    // No error or done event on cancel
    expect(eventNames).not.toContain('error');
    expect(eventNames).not.toContain('done');

    // No persistence for guest
    const msgsAfter = await db.select().from(messagesTable);
    const convsAfter = await db.select().from(conversationsTable);
    expect(msgsAfter.length).toBe(msgsBefore.length);
    expect(convsAfter.length).toBe(convsBefore.length);
  });
});

describe('POST /v1/guest/messages — guestSessionId on log context (IN8)', () => {
  it('callContext.metadata has guestSessionId; no conversationId/userId', async () => {
    const chatProvider = new FakeChatProvider({
      deltas: ['Hi'],
      usage: { promptTokens: 5, completionTokens: 2, totalTokens: 7 },
      recordContext: true,
    });
    const app = createApp({ db, redis, config, chatProvider });

    const res = await request(app)
      .post('/v1/guest/messages')
      .send({ messages: [], content: 'Hi' });

    expect(res.status).toBe(200);

    expect(chatProvider.recordedContexts.length).toBe(1);
    const ctx = chatProvider.recordedContexts[0]!;
    expect(ctx.metadata).toBeDefined();
    expect(typeof (ctx.metadata as any).guestSessionId).toBe('string');
    expect((ctx.metadata as any).guestSessionId.length).toBeGreaterThan(0);
    // No conversationId or userId
    expect((ctx as any).conversationId).toBeUndefined();
    expect((ctx as any).userId).toBeUndefined();
  });
});
