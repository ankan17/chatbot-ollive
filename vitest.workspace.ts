import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  { test: { name: 'shared', root: './packages/shared' } },
  {
    test: {
      name: 'db',
      root: './packages/db',
      testTimeout: 30000,
      // Shared `_test` database, sequential execution required — see the `api`
      // project below for why per-project `fileParallelism` doesn't suffice.
      poolOptions: { forks: { singleFork: true } },
      setupFiles: ['./test/test-db-setup.ts'],
    },
  },
  { test: { name: 'llm-sdk', root: './packages/llm-sdk' } },
  {
    test: {
      name: 'api',
      root: './apps/api',
      testTimeout: 30000,
      // These suites share one `_test` database and delete all rows between
      // tests, so they MUST run sequentially. Per-project `fileParallelism` is
      // ignored by Vitest (it's a root/CLI-only option), so pin the project to a
      // single fork — that enforces sequential execution regardless of CLI flags.
      poolOptions: { forks: { singleFork: true } },
      setupFiles: ['./test/test-db-setup.ts'],
    },
  },
  {
    test: {
      name: 'ingestion-worker',
      root: './apps/ingestion-worker',
      testTimeout: 30000,
      // Shared `_test` database, sequential execution required.
      poolOptions: { forks: { singleFork: true } },
      setupFiles: ['./test/test-db-setup.ts'],
    },
  },
  './apps/web/vite.config.ts',
  {
    test: {
      name: 'e2e',
      root: '.',
      include: ['test/e2e/**/*.e2e.test.ts'],
      testTimeout: 30000,
      // Shared `_test` database, sequential execution required.
      poolOptions: { forks: { singleFork: true } },
    },
  },
]);
