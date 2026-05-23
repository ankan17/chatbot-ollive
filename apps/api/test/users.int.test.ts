import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { runMigrations, createDb, users } from '@ollive/db';
import { createUserRepository } from '../src/users/repository.js';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://ollive:ollive@localhost:5432/ollive';
let db: ReturnType<typeof createDb>;
let repo: ReturnType<typeof createUserRepository>;

beforeAll(async () => {
  await runMigrations(DATABASE_URL);
  db = createDb(DATABASE_URL);
  repo = createUserRepository(db);
});

afterAll(async () => {
  await db.$client.end({ timeout: 5 });
});

afterEach(async () => {
  // Clean up users table between tests
  await db.delete(users);
});

describe('upsertByGoogleSub', () => {
  it('first call → inserts; returns AuthUser with uuid id, matching email/name', async () => {
    const user = await repo.upsertByGoogleSub({
      googleSub: 'google-sub-test-1',
      email: 'user1@test.com',
      name: 'User One',
    });
    expect(user.id).toBeTruthy();
    expect(user.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(user.email).toBe('user1@test.com');
    expect(user.name).toBe('User One');
  });

  it('same googleSub with changed name → same id, name updated; exactly one row', async () => {
    const first = await repo.upsertByGoogleSub({
      googleSub: 'google-sub-test-2',
      email: 'user2@test.com',
      name: 'Original Name',
    });

    const second = await repo.upsertByGoogleSub({
      googleSub: 'google-sub-test-2',
      email: 'user2@test.com',
      name: 'Updated Name',
    });

    expect(second.id).toBe(first.id);
    expect(second.name).toBe('Updated Name');
  });

  it('findById(returnedId) → same AuthUser; findById(random uuid) → null', async () => {
    const user = await repo.upsertByGoogleSub({
      googleSub: 'google-sub-test-3',
      email: 'user3@test.com',
    });

    const found = await repo.findById(user.id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(user.id);

    const notFound = await repo.findById('00000000-0000-0000-0000-000000000000');
    expect(notFound).toBeNull();
  });
});

describe('seedDemoUser', () => {
  it('called twice → same id both times; exactly one demo row (idempotent)', async () => {
    const first = await repo.seedDemoUser();
    const second = await repo.seedDemoUser();

    expect(first.id).toBe(second.id);
    expect(first.email).toBe('demo@ollive.local');
    expect(first.name).toBe('Demo User');
  });
});
