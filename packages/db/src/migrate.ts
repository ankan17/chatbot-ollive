import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '..', 'drizzle');

// Fixed key for a Postgres session-level advisory lock that serializes concurrent
// migrators. Both the api and the ingestion-worker run runMigrations() on startup
// (DE3), and parallel test projects do too — without this lock they race to apply
// the same migration (drizzle's postgres-js migrator takes no lock of its own).
const MIGRATION_LOCK_KEY = 4827310192;

export async function runMigrations(databaseUrl: string): Promise<void> {
  const client = postgres(databaseUrl, { max: 1 });
  try {
    // max:1 guarantees the lock and the migration run on the same session/connection.
    await client`SELECT pg_advisory_lock(${MIGRATION_LOCK_KEY})`;
    try {
      await migrate(drizzle(client), { migrationsFolder });
    } finally {
      await client`SELECT pg_advisory_unlock(${MIGRATION_LOCK_KEY})`;
    }
  } finally {
    await client.end();
  }
}
