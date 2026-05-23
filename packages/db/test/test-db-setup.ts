// Vitest setup: force this project's suites onto a guarded `_test` database so a
// stray integration test can never connect to (and wipe) the dev/prod database.
import { setupTestDatabaseEnv } from '../src/test-db';

await setupTestDatabaseEnv();
