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
]);
