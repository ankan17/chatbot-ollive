import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import Redis from 'ioredis';
import { runMigrations, createDb, users as usersTable, conversations as conversationsTable } from '@ollive/db';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/app.js';
import { createUserRepository } from '../src/users/repository.js';
import { signSession } from '../src/auth/jwt.js';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://ollive:ollive@localhost:5432/ollive';
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

const config = loadConfig({
  DATABASE_URL,
  REDIS_URL,
  PORT: '4000',
  INGESTION_API_KEY: 'test-key',
  JWT_SECRET: 'test-jwt-secret-for-conv-tests',
  AUTH_MODE: 'dev',
  WEB_ORIGIN: 'http://localhost:5173',
  NODE_ENV: 'test',
  GEMINI_API_KEY: 'dummy-gemini-key-for-tests',
});

// Config with both Gemini and Anthropic keys so Anthropic models are available
const configWithAnthropic = loadConfig({
  DATABASE_URL,
  REDIS_URL,
  PORT: '4001',
  INGESTION_API_KEY: 'test-key',
  JWT_SECRET: 'test-jwt-secret-for-conv-tests',
  AUTH_MODE: 'dev',
  WEB_ORIGIN: 'http://localhost:5173',
  NODE_ENV: 'test',
  GEMINI_API_KEY: 'dummy-gemini-key-for-tests',
  ANTHROPIC_API_KEY: 'dummy-anthropic-key-for-tests',
});

let db: ReturnType<typeof createDb>;
let redis: InstanceType<typeof Redis>;
let app: ReturnType<typeof createApp>;
let appWithAnthropic: ReturnType<typeof createApp>;

// Helper: create a session token for a user
async function sessionCookieFor(userId: string, email: string, name?: string): Promise<string> {
  const token = await signSession({ sub: userId, email, name }, config.jwtSecret);
  return `session=${token}`;
}

beforeAll(async () => {
  await runMigrations(DATABASE_URL);
  db = createDb(DATABASE_URL);
  redis = new Redis(REDIS_URL, { maxRetriesPerRequest: null, db: 1 });
  app = createApp({ db, redis, config });
  appWithAnthropic = createApp({ db, redis, config: configWithAnthropic });
});

afterAll(async () => {
  redis.disconnect();
  await db.$client.end({ timeout: 5 });
});

afterEach(async () => {
  // Clean up all users (cascade deletes conversations + messages)
  await db.delete(usersTable);
});

describe('POST /v1/conversations', () => {
  it('creates conversation with defaults; returns 201 Conversation with correct fields', async () => {
    // Seed a user
    const userRepo = createUserRepository(db);
    const user = await userRepo.upsertByGoogleSub({
      googleSub: 'conv-test-sub-1',
      email: 'conv1@test.com',
    });
    const cookie = await sessionCookieFor(user.id, user.email);

    const res = await request(app)
      .post('/v1/conversations')
      .set('Cookie', cookie)
      .set('Content-Type', 'application/json')
      .send({});

    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
    expect(res.body.title).toBe('New conversation');
    expect(res.body.status).toBe('active');
    expect(res.body.provider).toBe('google');
    expect(res.body.model).toBe(config.defaultModel);
    expect(res.body.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(res.body.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // No messages or title_source in body
    expect(res.body.messages).toBeUndefined();
    expect(res.body.title_source).toBeUndefined();
    expect(res.body.titleSource).toBeUndefined();
  });

  it('without session cookie → 401 { error: "unauthorized" }', async () => {
    const res = await request(app)
      .post('/v1/conversations')
      .send({});
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('unauthorized');
  });

  it('with custom title → title is set', async () => {
    const userRepo = createUserRepository(db);
    const user = await userRepo.upsertByGoogleSub({
      googleSub: 'conv-test-sub-title',
      email: 'conv-title@test.com',
    });
    const cookie = await sessionCookieFor(user.id, user.email);

    const res = await request(app)
      .post('/v1/conversations')
      .set('Cookie', cookie)
      .send({ title: 'My Custom Title' });

    expect(res.status).toBe(201);
    expect(res.body.title).toBe('My Custom Title');
  });

  it('Gemini model → provider is google', async () => {
    const userRepo = createUserRepository(db);
    const user = await userRepo.upsertByGoogleSub({
      googleSub: 'conv-provider-google-sub',
      email: 'conv-provider-google@test.com',
    });
    const cookie = await sessionCookieFor(user.id, user.email);

    const res = await request(app)
      .post('/v1/conversations')
      .set('Cookie', cookie)
      .send({ model: 'gemini-2.5-flash' });

    expect(res.status).toBe(201);
    expect(res.body.provider).toBe('google');
    expect(res.body.model).toBe('gemini-2.5-flash');
  });

  it('Anthropic model → provider is anthropic', async () => {
    const userRepo = createUserRepository(db);
    const user = await userRepo.upsertByGoogleSub({
      googleSub: 'conv-provider-anthropic-sub',
      email: 'conv-provider-anthropic@test.com',
    });
    const cookie = await sessionCookieFor(user.id, user.email);

    const res = await request(appWithAnthropic)
      .post('/v1/conversations')
      .set('Cookie', cookie)
      .send({ model: 'claude-sonnet-4-6' });

    expect(res.status).toBe(201);
    expect(res.body.provider).toBe('anthropic');
    expect(res.body.model).toBe('claude-sonnet-4-6');
  });
});

describe('GET /v1/conversations', () => {
  it('returns list of user conversations (most recent first), no messages/title_source', async () => {
    const userRepo = createUserRepository(db);
    const user = await userRepo.upsertByGoogleSub({
      googleSub: 'conv-list-sub',
      email: 'conv-list@test.com',
    });
    const cookie = await sessionCookieFor(user.id, user.email);

    // Create two conversations
    await request(app)
      .post('/v1/conversations')
      .set('Cookie', cookie)
      .send({ title: 'First' });

    await new Promise((r) => setTimeout(r, 10)); // ensure distinct updatedAt

    await request(app)
      .post('/v1/conversations')
      .set('Cookie', cookie)
      .send({ title: 'Second' });

    const res = await request(app)
      .get('/v1/conversations?status=active')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.items).toBeDefined();
    expect(res.body.nextCursor).toBeDefined(); // always present (may be null)
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.items.length).toBeGreaterThanOrEqual(2);

    // Most recently updated first
    const titles = res.body.items.map((c: { title: string }) => c.title);
    const secondIdx = titles.indexOf('Second');
    const firstIdx = titles.indexOf('First');
    expect(secondIdx).toBeLessThan(firstIdx);

    // No messages or title_source on items
    for (const item of res.body.items) {
      expect(item.messages).toBeUndefined();
      expect(item.title_source).toBeUndefined();
      expect(item.titleSource).toBeUndefined();
    }
  });

  it('limit=101 → 400 validation_error', async () => {
    const userRepo = createUserRepository(db);
    const user = await userRepo.upsertByGoogleSub({
      googleSub: 'conv-limit-sub',
      email: 'conv-limit@test.com',
    });
    const cookie = await sessionCookieFor(user.id, user.email);

    const res = await request(app)
      .get('/v1/conversations?limit=101')
      .set('Cookie', cookie);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_error');
  });

  it('cursor pagination: create 3, limit=2 → first page 2 items + nextCursor; follow → 1 item + null cursor', async () => {
    const userRepo = createUserRepository(db);
    const user = await userRepo.upsertByGoogleSub({
      googleSub: 'conv-page-sub',
      email: 'conv-page@test.com',
    });
    const cookie = await sessionCookieFor(user.id, user.email);

    // Create 3 conversations sequentially
    for (const t of ['A', 'B', 'C']) {
      await request(app)
        .post('/v1/conversations')
        .set('Cookie', cookie)
        .send({ title: t });
      await new Promise((r) => setTimeout(r, 5));
    }

    // First page
    const page1 = await request(app)
      .get('/v1/conversations?limit=2')
      .set('Cookie', cookie);

    expect(page1.status).toBe(200);
    expect(page1.body.items.length).toBe(2);
    expect(page1.body.nextCursor).not.toBeNull();

    // Second page
    const page2 = await request(app)
      .get(`/v1/conversations?limit=2&cursor=${page1.body.nextCursor}`)
      .set('Cookie', cookie);

    expect(page2.status).toBe(200);
    expect(page2.body.items.length).toBe(1);
    expect(page2.body.nextCursor).toBeNull();
  });
});

describe('GET /v1/conversations/:id', () => {
  it('own conversation → 200 ConversationDetail with messages array', async () => {
    const userRepo = createUserRepository(db);
    const user = await userRepo.upsertByGoogleSub({
      googleSub: 'conv-get-sub',
      email: 'conv-get@test.com',
    });
    const cookie = await sessionCookieFor(user.id, user.email);

    const createRes = await request(app)
      .post('/v1/conversations')
      .set('Cookie', cookie)
      .send({});

    const convId = createRes.body.id;

    const res = await request(app)
      .get(`/v1/conversations/${convId}`)
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(convId);
    expect(Array.isArray(res.body.messages)).toBe(true);
  });

  it('nonexistent id → 404 not_found', async () => {
    const userRepo = createUserRepository(db);
    const user = await userRepo.upsertByGoogleSub({
      googleSub: 'conv-404-sub',
      email: 'conv-404@test.com',
    });
    const cookie = await sessionCookieFor(user.id, user.email);

    const res = await request(app)
      .get('/v1/conversations/00000000-0000-0000-0000-000000000000')
      .set('Cookie', cookie);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('not_found');
  });

  it('another user\'s conversation → 404 not_found (SE8 user-scoping)', async () => {
    const userRepo = createUserRepository(db);
    const user1 = await userRepo.upsertByGoogleSub({
      googleSub: 'conv-scope-sub-1',
      email: 'conv-scope1@test.com',
    });
    const user2 = await userRepo.upsertByGoogleSub({
      googleSub: 'conv-scope-sub-2',
      email: 'conv-scope2@test.com',
    });
    const cookie1 = await sessionCookieFor(user1.id, user1.email);
    const cookie2 = await sessionCookieFor(user2.id, user2.email);

    // Create conversation as user1
    const createRes = await request(app)
      .post('/v1/conversations')
      .set('Cookie', cookie1)
      .send({});
    const convId = createRes.body.id;

    // Try to get it as user2 → 404
    const res = await request(app)
      .get(`/v1/conversations/${convId}`)
      .set('Cookie', cookie2);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('not_found');
  });
});

describe('PATCH /v1/conversations/:id', () => {
  it('rename → 200, title updated, title_source=user', async () => {
    const userRepo = createUserRepository(db);
    const user = await userRepo.upsertByGoogleSub({
      googleSub: 'conv-patch-sub',
      email: 'conv-patch@test.com',
    });
    const cookie = await sessionCookieFor(user.id, user.email);

    const createRes = await request(app)
      .post('/v1/conversations')
      .set('Cookie', cookie)
      .send({});
    const convId = createRes.body.id;

    const patchRes = await request(app)
      .patch(`/v1/conversations/${convId}`)
      .set('Cookie', cookie)
      .send({ title: 'Trip planning' });

    expect(patchRes.status).toBe(200);
    expect(patchRes.body.title).toBe('Trip planning');

    // Verify title_source='user' in DB
    const dbRows = await db.select().from(conversationsTable);
    const conv = dbRows.find((c) => c.id === convId);
    expect(conv!.titleSource).toBe('user');
  });

  it('archive → conversation disappears from active, appears in archived', async () => {
    const userRepo = createUserRepository(db);
    const user = await userRepo.upsertByGoogleSub({
      googleSub: 'conv-archive-sub',
      email: 'conv-archive@test.com',
    });
    const cookie = await sessionCookieFor(user.id, user.email);

    const createRes = await request(app)
      .post('/v1/conversations')
      .set('Cookie', cookie)
      .send({});
    const convId = createRes.body.id;

    // Archive it
    const patchRes = await request(app)
      .patch(`/v1/conversations/${convId}`)
      .set('Cookie', cookie)
      .send({ status: 'archived' });

    expect(patchRes.status).toBe(200);
    expect(patchRes.body.status).toBe('archived');

    // Not in active list
    const activeList = await request(app)
      .get('/v1/conversations?status=active')
      .set('Cookie', cookie);
    const activeIds = activeList.body.items.map((c: { id: string }) => c.id);
    expect(activeIds).not.toContain(convId);

    // In archived list
    const archivedList = await request(app)
      .get('/v1/conversations?status=archived')
      .set('Cookie', cookie);
    const archivedIds = archivedList.body.items.map((c: { id: string }) => c.id);
    expect(archivedIds).toContain(convId);
  });

  it('empty body → 400 validation_error (at-least-one refinement)', async () => {
    const userRepo = createUserRepository(db);
    const user = await userRepo.upsertByGoogleSub({
      googleSub: 'conv-empty-patch-sub',
      email: 'conv-empty-patch@test.com',
    });
    const cookie = await sessionCookieFor(user.id, user.email);

    const createRes = await request(app)
      .post('/v1/conversations')
      .set('Cookie', cookie)
      .send({});
    const convId = createRes.body.id;

    const res = await request(app)
      .patch(`/v1/conversations/${convId}`)
      .set('Cookie', cookie)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_error');
  });

  it('another user\'s conversation → 404 (SE8)', async () => {
    const userRepo = createUserRepository(db);
    const user1 = await userRepo.upsertByGoogleSub({
      googleSub: 'conv-patch-scope1',
      email: 'conv-patch-scope1@test.com',
    });
    const user2 = await userRepo.upsertByGoogleSub({
      googleSub: 'conv-patch-scope2',
      email: 'conv-patch-scope2@test.com',
    });
    const cookie1 = await sessionCookieFor(user1.id, user1.email);
    const cookie2 = await sessionCookieFor(user2.id, user2.email);

    const createRes = await request(app)
      .post('/v1/conversations')
      .set('Cookie', cookie1)
      .send({});
    const convId = createRes.body.id;

    const res = await request(app)
      .patch(`/v1/conversations/${convId}`)
      .set('Cookie', cookie2)
      .send({ title: 'Hacked' });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('not_found');
  });
});
