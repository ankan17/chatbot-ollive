import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  { test: { name: 'shared', root: './packages/shared' } },
  {
    test: {
      name: 'db',
      root: './packages/db',
      testTimeout: 30000,
      fileParallelism: false,
    },
  },
  { test: { name: 'llm-sdk', root: './packages/llm-sdk' } },
  {
    test: {
      name: 'api',
      root: './apps/api',
      testTimeout: 30000,
      fileParallelism: false,
    },
  },
  {
    test: {
      name: 'ingestion-worker',
      root: './apps/ingestion-worker',
      testTimeout: 30000,
      fileParallelism: false,
    },
  },
  './apps/web/vite.config.ts',
]);
