import postgres from 'postgres';

/**
 * Test database safety helpers.
 *
 * Integration tests DELETE data (e.g. `db.delete(users)` in afterEach), which
 * cascades to conversations/messages. If they run against the dev/prod database
 * they wipe it. These helpers force every DB-backed suite onto a dedicated
 * `_test` database and refuse to run against anything else.
 */

const DEFAULT_TEST_DATABASE_URL = 'postgres://ollive:ollive@localhost:5432/ollive_test';

function stripQuery(url: string): string {
  const q = url.indexOf('?');
  return q === -1 ? url : url.slice(0, q);
}

/** The database name (last path segment) of a Postgres connection URL. */
export function databaseName(url: string): string {
  return stripQuery(url).split('/').pop() ?? '';
}

/**
 * Resolve the database URL for tests, refusing to target anything that isn't a
 * dedicated test database. The name must end in `_test` (default: a local
 * `ollive_test`). Set `ALLOW_NON_TEST_DB=1` to bypass — you almost never want to.
 */
export function testDatabaseUrl(): string {
  const url = process.env.DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;
  const name = databaseName(url);
  if (process.env.ALLOW_NON_TEST_DB !== '1' && !name.endsWith('_test')) {
    throw new Error(
      `Refusing to run tests against database "${name}". ` +
        `Integration tests delete data; point DATABASE_URL at a database whose name ` +
        `ends in "_test" (default: ${DEFAULT_TEST_DATABASE_URL}), or set ` +
        `ALLOW_NON_TEST_DB=1 to override.`,
    );
  }
  return url;
}

/** Replace the database in a connection URL with the maintenance `postgres` db. */
function maintenanceUrl(url: string): string {
  const q = url.indexOf('?');
  const base = q === -1 ? url : url.slice(0, q);
  const query = q === -1 ? '' : url.slice(q);
  return base.slice(0, base.lastIndexOf('/')) + '/postgres' + query;
}

/**
 * Create the test database if it doesn't already exist, by connecting to the
 * server's maintenance `postgres` database. Idempotent.
 */
export async function ensureTestDatabase(url: string = testDatabaseUrl()): Promise<void> {
  const name = databaseName(url);
  const sql = postgres(maintenanceUrl(url), { max: 1, connect_timeout: 5 });
  try {
    const existing = await sql`SELECT 1 FROM pg_database WHERE datname = ${name}`;
    if (existing.length === 0) {
      // Identifier can't be parameterized; `name` is validated to end in `_test`.
      await sql.unsafe(`CREATE DATABASE "${name}"`);
    }
  } finally {
    await sql.end();
  }
}

/**
 * Vitest `setupFiles` hook for DB-backed projects: enforce the `_test`-database
 * guard, pin DATABASE_URL onto it for the suite, and create it if missing. The
 * guard is fatal (it prevents data loss); creating the DB is best-effort so that
 * pure unit tests still run when Postgres isn't up.
 */
export async function setupTestDatabaseEnv(): Promise<void> {
  const url = testDatabaseUrl();
  process.env.DATABASE_URL = url;
  try {
    await ensureTestDatabase(url);
  } catch (err) {
    console.warn(
      `[test-db] could not ensure database "${databaseName(url)}" exists ` +
        `(${(err as Error).message}); DB-backed suites will fail until Postgres is reachable.`,
    );
  }
}
