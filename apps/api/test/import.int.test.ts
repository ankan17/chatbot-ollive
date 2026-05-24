import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import Redis from 'ioredis';
import { runMigrations, createDb, users as usersTable, conversations as conversationsTable } from '@ollive/db';
import { eq } from 'drizzle-orm';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/app.js';
import { createUserRepository } from '../src/users/repository.js';
import { signSession } from '../src/auth/jwt.js';
import { FakeChatProvider } from './fakes.js';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://ollive:ollive@localhost:5432/ollive';
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

const config = loadConfig({
  DATABASE_URL,
  REDIS_URL,
  PORT: '4000',
  INGESTION_API_KEY: 'test-key',
  JWT_SECRET: 'test-jwt-secret-for-import-tests',
  AUTH_MODE: 'dev',
  WEB_ORIGIN: 'http://localhost:5173',
  NODE_ENV: 'test',
  GEMINI_API_KEY: 'dummy-gemini-key-for-tests',
});

let db: ReturnType<typeof createDb>;
let redis: InstanceType<typeof Redis>;
let app: ReturnType<typeof createApp>;

async function sessionCookieFor(userId: string, email: string): Promise<string> {
  const token = await signSession({ sub: userId, email }, config.jwtSecret);
  return `session=${token}`;
}

beforeAll(async () => {
  await runMigrations(DATABASE_URL);
  db = createDb(DATABASE_URL);
  redis = new Redis(REDIS_URL, { maxRetriesPerRequest: null, db: 1 });
  app = createApp({ db, redis, config });
});

afterAll(async () => {
  redis.disconnect();
  await db.$client.end({ timeout: 5 });
});

afterEach(async () => {
  await db.delete(usersTable);
});

// Verify Task 8.5 migration: column + partial index exist
describe('Task 8.5 — client_conversation_id column + partial-unique index', () => {
  it('conversations table has nullable client_conversation_id column', async () => {
    await db.execute(
      db.select().from(conversationsTable).limit(0).toSQL().sql,
    ).catch(() => null);

    // Check via information_schema
    const result = await db.execute(
      `SELECT column_name, is_nullable FROM information_schema.columns
       WHERE table_name = 'conversations' AND column_name = 'client_conversation_id'`,
    );
    expect((result as any).length).toBeGreaterThan(0);
    const col = (result as any)[0];
    expect(col.column_name).toBe('client_conversation_id');
    expect(col.is_nullable).toBe('YES');
  });

  it('partial-unique index exists on (user_id, client_conversation_id)', async () => {
    const result = await db.execute(
      `SELECT indexname, indexdef FROM pg_indexes
       WHERE tablename = 'conversations' AND indexname = 'uq_conv_user_client_convo'`,
    );
    expect((result as any).length).toBe(1);
    const idx = (result as any)[0];
    expect(idx.indexdef).toContain('client_conversation_id');
    expect(String(idx.indexdef).toLowerCase()).toContain('is not null');
  });

  it('same user + same non-null client_conversation_id → unique constraint violation', async () => {
    const userRepo = createUserRepository(db);
    const user = await userRepo.upsertByGoogleSub({
      googleSub: 'idx-test-sub',
      email: 'idx-test@test.com',
    });

    // Insert first conversation with client_conversation_id
    await db.insert(conversationsTable).values({
      userId: user.id,
      title: 'First',
      titleSource: 'default',
      status: 'active',
      provider: 'google',
      model: 'gemini-2.5-flash',
      clientConversationId: 'client-key-123',
    });

    // Trying to insert a second with the same user + client_conversation_id should fail
    await expect(
      db.insert(conversationsTable).values({
        userId: user.id,
        title: 'Duplicate',
        titleSource: 'default',
        status: 'active',
        provider: 'google',
        model: 'gemini-2.5-flash',
        clientConversationId: 'client-key-123',
      }),
    ).rejects.toThrow();
  });

  it('same user + null client_conversation_id → multiple rows allowed', async () => {
    const userRepo = createUserRepository(db);
    const user = await userRepo.upsertByGoogleSub({
      googleSub: 'null-idx-test-sub',
      email: 'null-idx-test@test.com',
    });

    // Two rows with null should succeed (partial index only covers non-null)
    await db.insert(conversationsTable).values({
      userId: user.id,
      title: 'First null',
      titleSource: 'default',
      status: 'active',
      provider: 'google',
      model: 'gemini-2.5-flash',
      clientConversationId: null,
    });
    await db.insert(conversationsTable).values({
      userId: user.id,
      title: 'Second null',
      titleSource: 'default',
      status: 'active',
      provider: 'google',
      model: 'gemini-2.5-flash',
      clientConversationId: null,
    });

    const all = await db
      .select()
      .from(conversationsTable)
      .where(eq(conversationsTable.userId, user.id));
    expect(all.length).toBe(2);
  });
});

describe('POST /v1/conversations/import', () => {
  it('without session cookie → 401 { error: "unauthorized" }', async () => {
    const res = await request(app)
      .post('/v1/conversations/import')
      .send({ messages: [{ role: 'user', content: 'Hello' }] });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('unauthorized');
  });

  it('import 2 messages → 201 ConversationDetail with correct fields', async () => {
    const userRepo = createUserRepository(db);
    const user = await userRepo.upsertByGoogleSub({
      googleSub: 'import-sub-1',
      email: 'import1@test.com',
    });
    const cookie = await sessionCookieFor(user.id, user.email);

    const res = await request(app)
      .post('/v1/conversations/import')
      .set('Cookie', cookie)
      .send({
        messages: [
          { role: 'user', content: 'Plan a 3-day trip to Kyoto' },
          { role: 'assistant', content: 'Day 1 ...' },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
    expect(res.body.title).toBe('New conversation');
    expect(res.body.status).toBe('active');
    expect(res.body.provider).toBe('google');
    expect(res.body.model).toBe(config.defaultModel);
    expect(Array.isArray(res.body.messages)).toBe(true);
    expect(res.body.messages.length).toBe(2);
    expect(res.body.messages[0].role).toBe('user');
    expect(res.body.messages[0].sequence).toBe(1);
    expect(res.body.messages[1].role).toBe('assistant');
    expect(res.body.messages[1].sequence).toBe(2);

    // Verify DB has title_source='default' and client_conversation_id IS NULL
    const dbConvs = await db
      .select()
      .from(conversationsTable)
      .where(eq(conversationsTable.id, res.body.id));
    expect(dbConvs[0].titleSource).toBe('default');
    expect(dbConvs[0].clientConversationId).toBeNull();
  });

  it('idempotency: same clientConversationId + same user → same conversation id, no duplicate', async () => {
    const userRepo = createUserRepository(db);
    const user = await userRepo.upsertByGoogleSub({
      googleSub: 'import-idempotent-sub',
      email: 'import-idempotent@test.com',
    });
    const cookie = await sessionCookieFor(user.id, user.email);

    const clientConversationId = 'client-key-abc-123';
    const payload = {
      clientConversationId,
      messages: [{ role: 'user', content: 'Hello' }],
    };

    // Import twice
    const res1 = await request(app)
      .post('/v1/conversations/import')
      .set('Cookie', cookie)
      .send(payload);

    const res2 = await request(app)
      .post('/v1/conversations/import')
      .set('Cookie', cookie)
      .send(payload);

    expect(res1.status).toBe(201);
    expect(res2.status).toBe(201);
    expect(res1.body.id).toBe(res2.body.id); // Same conversation

    // Only one row in DB
    const dbConvs = await db
      .select()
      .from(conversationsTable)
      .where(eq(conversationsTable.userId, user.id));
    expect(dbConvs.length).toBe(1);
  });

  it('two imports without clientConversationId → distinct conversation ids', async () => {
    const userRepo = createUserRepository(db);
    const user = await userRepo.upsertByGoogleSub({
      googleSub: 'import-no-id-sub',
      email: 'import-no-id@test.com',
    });
    const cookie = await sessionCookieFor(user.id, user.email);

    const res1 = await request(app)
      .post('/v1/conversations/import')
      .set('Cookie', cookie)
      .send({ messages: [{ role: 'user', content: 'First' }] });

    const res2 = await request(app)
      .post('/v1/conversations/import')
      .set('Cookie', cookie)
      .send({ messages: [{ role: 'user', content: 'Second' }] });

    expect(res1.status).toBe(201);
    expect(res2.status).toBe(201);
    expect(res1.body.id).not.toBe(res2.body.id);
  });

  it('different clientConversationId → distinct conversations', async () => {
    const userRepo = createUserRepository(db);
    const user = await userRepo.upsertByGoogleSub({
      googleSub: 'import-diff-id-sub',
      email: 'import-diff-id@test.com',
    });
    const cookie = await sessionCookieFor(user.id, user.email);

    const res1 = await request(app)
      .post('/v1/conversations/import')
      .set('Cookie', cookie)
      .send({
        clientConversationId: 'key-one',
        messages: [{ role: 'user', content: 'One' }],
      });

    const res2 = await request(app)
      .post('/v1/conversations/import')
      .set('Cookie', cookie)
      .send({
        clientConversationId: 'key-two',
        messages: [{ role: 'user', content: 'Two' }],
      });

    expect(res1.status).toBe(201);
    expect(res2.status).toBe(201);
    expect(res1.body.id).not.toBe(res2.body.id);
  });

  it('empty messages array → 400 validation_error', async () => {
    const userRepo = createUserRepository(db);
    const user = await userRepo.upsertByGoogleSub({
      googleSub: 'import-empty-sub',
      email: 'import-empty@test.com',
    });
    const cookie = await sessionCookieFor(user.id, user.email);

    const res = await request(app)
      .post('/v1/conversations/import')
      .set('Cookie', cookie)
      .send({ messages: [] });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_error');
  });

  it('system role in messages → 400 validation_error', async () => {
    const userRepo = createUserRepository(db);
    const user = await userRepo.upsertByGoogleSub({
      googleSub: 'import-system-sub',
      email: 'import-system@test.com',
    });
    const cookie = await sessionCookieFor(user.id, user.email);

    const res = await request(app)
      .post('/v1/conversations/import')
      .set('Cookie', cookie)
      .send({
        messages: [{ role: 'system', content: 'You are a helpful assistant' }],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_error');
  });

  it('same clientConversationId reused by different user → separate conversation (per-user dedup)', async () => {
    const userRepo = createUserRepository(db);
    const user1 = await userRepo.upsertByGoogleSub({
      googleSub: 'import-cross-user-1',
      email: 'import-cross-user1@test.com',
    });
    const user2 = await userRepo.upsertByGoogleSub({
      googleSub: 'import-cross-user-2',
      email: 'import-cross-user2@test.com',
    });
    const cookie1 = await sessionCookieFor(user1.id, user1.email);
    const cookie2 = await sessionCookieFor(user2.id, user2.email);

    const clientConversationId = 'shared-client-key';
    const msgs = [{ role: 'user', content: 'Hello' }];

    const res1 = await request(app)
      .post('/v1/conversations/import')
      .set('Cookie', cookie1)
      .send({ clientConversationId, messages: msgs });

    const res2 = await request(app)
      .post('/v1/conversations/import')
      .set('Cookie', cookie2)
      .send({ clientConversationId, messages: msgs });

    expect(res1.status).toBe(201);
    expect(res2.status).toBe(201);
    expect(res1.body.id).not.toBe(res2.body.id); // Different users → different conversations
  });
});

// PRD §7.1: "Because title_source='default', auto-naming runs against the imported exchange."
describe('POST /v1/conversations/import — auto-naming', () => {
  it('auto-names the imported conversation from its first exchange', async () => {
    const provider = new FakeChatProvider({ deltas: ['Capital', ' of', ' France'], finishReason: 'stop' });
    const namingApp = createApp({ db, redis, config, chatProvider: provider });

    const userRepo = createUserRepository(db);
    const user = await userRepo.upsertByGoogleSub({ googleSub: 'import-naming', email: 'import-naming@test.com' });
    const cookie = await sessionCookieFor(user.id, user.email);

    const res = await request(namingApp)
      .post('/v1/conversations/import')
      .set('Cookie', cookie)
      .send({
        messages: [
          { role: 'user', content: 'What is the capital of France?' },
          { role: 'assistant', content: 'The capital of France is Paris.' },
        ],
      });

    expect(res.status).toBe(201);
    const [row] = await db
      .select({ title: conversationsTable.title, titleSource: conversationsTable.titleSource })
      .from(conversationsTable)
      .where(eq(conversationsTable.id, res.body.id));
    expect(row.titleSource).toBe('auto');
    expect(row.title).toBe('Capital of France');
  });
});
