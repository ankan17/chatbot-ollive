import { eq } from 'drizzle-orm';
import { users } from '@ollive/db';
import type { Db } from '@ollive/db';
import type { AuthUser } from '../types.js';

export interface UpsertUserInput {
  googleSub: string;
  email: string;
  name?: string;
  avatarUrl?: string;
}

export interface UserRepository {
  /** Insert-or-update on google_sub conflict; bumps last_login_at. */
  upsertByGoogleSub: (input: UpsertUserInput) => Promise<AuthUser>;
  findById: (id: string) => Promise<AuthUser | null>;
  /** Idempotent; the DevAuthProvider demo identity. */
  seedDemoUser: () => Promise<AuthUser>;
}

export function createUserRepository(db: Db): UserRepository {
  return {
    async upsertByGoogleSub(input: UpsertUserInput): Promise<AuthUser> {
      const now = new Date();
      const rows = await db
        .insert(users)
        .values({
          googleSub: input.googleSub,
          email: input.email,
          name: input.name ?? null,
          avatarUrl: input.avatarUrl ?? null,
          lastLoginAt: now,
        })
        .onConflictDoUpdate({
          target: users.googleSub,
          set: {
            email: input.email,
            name: input.name ?? null,
            avatarUrl: input.avatarUrl ?? null,
            lastLoginAt: now,
          },
        })
        .returning();

      const row = rows[0];
      return rowToAuthUser(row);
    },

    async findById(id: string): Promise<AuthUser | null> {
      const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
      if (rows.length === 0) return null;
      return rowToAuthUser(rows[0]);
    },

    async seedDemoUser(): Promise<AuthUser> {
      return this.upsertByGoogleSub({
        googleSub: 'dev-google-sub',
        email: 'demo@ollive.local',
        name: 'Demo User',
      });
    },
  };
}

function rowToAuthUser(row: {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
}): AuthUser {
  return {
    id: row.id,
    email: row.email,
    ...(row.name != null ? { name: row.name } : {}),
    ...(row.avatarUrl != null ? { avatarUrl: row.avatarUrl } : {}),
  };
}
