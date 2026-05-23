import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, users, conversations, messages, inferenceLogs } from '../src';
import { runMigrations } from '../src/migrate';

const url = process.env.DATABASE_URL ?? 'postgres://ollive:ollive@localhost:5432/ollive';
let db: ReturnType<typeof createDb>;

beforeAll(async () => {
  await runMigrations(url); // idempotent
  db = createDb(url);
});

afterAll(async () => {
  // FK order: logs reference messages/conversations/users
  await db.delete(inferenceLogs);
  await db.delete(messages);
  await db.delete(conversations);
  await db.delete(users);
});

describe('db schema', () => {
  it('persists user → conversation → message → inference log', async () => {
    const [u] = await db
      .insert(users)
      .values({ googleSub: `sub-${Date.now()}`, email: `u${Date.now()}@example.com` })
      .returning();

    const [c] = await db
      .insert(conversations)
      .values({ userId: u.id, provider: 'google', model: 'gemini-2.5-flash' })
      .returning();
    expect(c.title).toBe('New conversation');
    expect(c.titleSource).toBe('default');
    expect(c.status).toBe('active');

    const [m] = await db
      .insert(messages)
      .values({ conversationId: c.id, role: 'user', content: 'hi', sequence: 1 })
      .returning();

    const [log] = await db
      .insert(inferenceLogs)
      .values({
        requestId: crypto.randomUUID(),
        conversationId: c.id,
        messageId: m.id,
        userId: u.id,
        provider: 'google',
        model: 'gemini-2.5-flash',
        status: 'success',
        latencyMs: 1000,
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
        estimatedCostUsd: '0.000015',
        errorCategory: null,
        metadata: { tokensPerSecond: 5 },
      })
      .returning();

    expect(log.totalTokens).toBe(15);
    expect(log.estimatedCostUsd).toBe('0.000015'); // numeric returns as string
  });

  it('enforces unique (conversation_id, sequence)', async () => {
    const [u] = await db
      .insert(users)
      .values({ googleSub: `s-${Date.now()}`, email: `e${Date.now()}@example.com` })
      .returning();
    const [c] = await db
      .insert(conversations)
      .values({ userId: u.id, provider: 'google', model: 'm' })
      .returning();

    await db.insert(messages).values({ conversationId: c.id, role: 'user', content: 'a', sequence: 1 });
    await expect(
      db.insert(messages).values({ conversationId: c.id, role: 'assistant', content: 'b', sequence: 1 }),
    ).rejects.toThrow();
  });

  it('rejects an invalid status via the check constraint', async () => {
    const [u] = await db
      .insert(users)
      .values({ googleSub: `bad-${Date.now()}`, email: `bad${Date.now()}@example.com` })
      .returning();
    await expect(
      db.insert(conversations).values({
        userId: u.id,
        provider: 'google',
        model: 'm',
        status: 'deleted', // violates the check constraint at runtime
      }),
    ).rejects.toThrow();
  });
});
