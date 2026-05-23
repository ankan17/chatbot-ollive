# Ingestion Pipeline Implementation Plan (Plan 3 of 7)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.
>
> **Commit convention:** every commit message in this plan must end with the trailer:
> `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`
>
> **Format note:** this is a DESIGN-LEVEL plan. Each task gives the contracts (signatures/types), the algorithm, the patterns/decisions, and the test cases to satisfy (TDD — write tests first). It deliberately does NOT include full function bodies or literal test code; the implementer writes those to make the stated test cases pass.

**Goal:** Deliver a working, curl-testable ingestion vertical slice — `POST /v1/logs` → Redis Streams → worker → a row in `inference_logs` — by standing up the first `apps/api` (app factory, typed config, pino logging, correlation id, error handler, health routes, shared Redis client, the ingestion receiver) plus the second deployable `apps/ingestion-worker` (consumer group, batch consume, metadata extraction, idempotent upsert, `XACK`, `XAUTOCLAIM` recovery, and a DLQ for poison messages).

**Architecture:** Two Node processes share `@ollive/db` and `@ollive/shared` (Plan 1) and reuse `@ollive/llm-sdk`'s `PatternRedactor` (Plan 2) as the ingestion redaction backstop. The API never writes telemetry to Postgres — it validates, re-redacts (defense in depth, IN9), and `XADD`s a single `payload` field (JSON-stringified `InferenceLog`) onto the capped `inference-logs` stream, returning `202`. The worker reads via a consumer group (`ingestion-workers`), normalizes + extracts derived metadata (cost, error category, throughput/size signals, redaction counts), upserts idempotently on `request_id`, and `XACK`s; crashed-consumer entries are reclaimed via `XAUTOCLAIM`, and entries that exceed a bounded retry budget are routed to `inference-logs-dlq` and acked so the pipeline never wedges. This is the transactional-vs-telemetry split (PRD §4.3) made concrete: the chat path is synchronous and fast; telemetry is asynchronous and independently scalable.

**Tech Stack:** TypeScript 5.7, pnpm workspaces, Vitest 3 (root workspace runner), Express 4 + supertest 7, pino 9 + pino-http 10, ioredis 5, Zod 3, `@ollive/shared` / `@ollive/db` / `@ollive/llm-sdk` (workspace), tsx 4 (run TS processes directly — no build step), Node 20 built-ins (`node:crypto` for `randomUUID`). Postgres 16 + Redis 7 from Plan 1's `infra/docker-compose.yml` back the integration tests.

**Context:** The repo root is the existing git repository at `chatbot-ollive/` (already contains `docs/PRD.md`, Plan 1's root config + `@ollive/shared` + `@ollive/db`). Plan 2 (`@ollive/llm-sdk`) is assumed implemented before this plan executes — this plan imports `PatternRedactor` from it. All paths are relative to that root. **Plan 1 conventions you MUST follow:** internal packages/apps are consumed as TS source via `exports` (no build step, run with `tsx`); tests run through the root `vitest.workspace.ts` (one project per package/app); Postgres integration tests read `process.env.DATABASE_URL ?? 'postgres://ollive:ollive@localhost:5432/ollive'`, call `runMigrations` in `beforeAll`, clean up in `afterAll`, and the project entry sets `testTimeout: 30000` + `fileParallelism: false`. We extend that exact harness to Redis (`process.env.REDIS_URL ?? 'redis://localhost:6379'`). Dependency versions pin with caret ranges; if a range does not resolve, substitute the nearest working version of the **same major**. Express stays on `^4.21.0` — do **not** substitute Express 5 (its router/error-handler API differs).

References: PRD §4.3/§4.4 (persistence paths, deployables), §8.4 (ingestion API contract), §8.6 (health), §9 (log wire contract), §10 (DB schema — `inference_logs` already has `estimated_cost_usd` + `error_category`), §16 + §16.1 (IN1–IN10 + extracted metadata), §18 (error handling), §20 (security), §22 (OB3 counters).

> **Pinned contracts (do not invent variants):** stream key `inference-logs`; each entry is a single field `payload` whose value is `JSON.stringify(InferenceLog)` — i.e. one entry is `{ payload: "<json>" }`; DLQ stream key `inference-logs-dlq`; consumer group `ingestion-workers`. These four constants (`INGESTION_STREAM`, `INGESTION_DLQ`, `INGESTION_GROUP`, `PAYLOAD_FIELD`) live in `@ollive/shared` — imported from there in BOTH the API receiver and the worker so the two can never drift (the worker does **not** depend on `@ollive/api`). The log payload shape is **exactly** `@ollive/shared`'s `inferenceLogSchema` — import it, never redefine it. The `inference_logs` table is **exactly** `@ollive/db`'s `inferenceLogs` Drizzle table — import it, never redefine it. App-factory signature: `createApp({ db, redis, config }): express.Express`; later plans (4 & 5) mount additional routers in this same factory. Error shape is always `{ error: <code>, details? }`. There is no `apps/api/src/index.ts`.

---

## File Structure

```
packages/
  shared/
    src/streams.ts                # NEW: pinned ingestion stream constants (INGESTION_STREAM/DLQ/GROUP, PAYLOAD_FIELD) — shared by API receiver + worker
    src/index.ts                  # EDIT: add `export * from './streams';`
  db/
    src/index.ts                  # EDIT: add `export * from './migrate';` so `runMigrations` resolves from the package root (@ollive/db)
apps/
  api/
    package.json                  # @ollive/api — Express app + ingestion receiver; start = tsx src/server.ts
    tsconfig.json
    src/config.ts                 # Zod-validated env/config loader (extensible: later plans add vars)
    src/logger.ts                 # pino root logger factory
    src/redis.ts                  # createRedis(url) — single shared ioredis client (BE9)
    src/errors.ts                 # AppError + error codes + centralized error-handling middleware (§18)
    src/middleware/correlation.ts # per-request correlation-id middleware (BE8, OB2)
    src/middleware/ingestion-auth.ts # Bearer INGESTION_API_KEY auth (AU5)
    src/ingestion/redaction.ts    # redactInferenceLog() — PatternRedactor backstop over previews + string metadata (IN9)
    src/ingestion/stream.ts       # xaddInferenceLog() — imports stream contract from @ollive/shared (IN1/IN2)
    src/routes/health.ts          # GET /healthz (liveness) + GET /readyz (db+redis) (§8.6, OB4)
    src/routes/logs.ts            # POST /v1/logs receiver (IN1, BE6, AU5)
    src/app.ts                    # createApp({ db, redis, config }) — mounts routers, error handler
    src/server.ts                 # entrypoint: build deps, listen, graceful shutdown (BE8). NOTE: this is the entrypoint; there is no src/index.ts
    test/config.test.ts
    test/redaction.test.ts
    test/health.int.test.ts       # supertest + real Redis + real Postgres
    test/logs.int.test.ts         # supertest + real Redis (asserts entry lands on the stream)
  ingestion-worker/
    package.json                  # @ollive/ingestion-worker; start = tsx src/main.ts. Does NOT depend on @ollive/api
    tsconfig.json
    src/config.ts                 # Zod-validated worker env/config loader
    src/logger.ts                 # pino root logger factory
    src/pricing.ts                # per-model price table + estimateCostUsd() (IN10, §16.1)
    src/error-category.ts         # categorizeError() — raw provider error → normalized category (IN10)
    src/extract.ts                # extractMetadata() — derive estimated_cost_usd, error_category, metadata JSONB
    src/upsert.ts                 # upsertInferenceLog(db, row) — idempotent ON CONFLICT (request_id) (IN4)
    src/counters.ts               # Counters: processed/failed/dlq (IN7, OB3)
    src/consumer.ts               # ensureGroup, processBatch (XREADGROUP→extract→upsert→XACK), reclaimStale (XAUTOCLAIM), DLQ routing (IN3/IN4/IN5)
    src/main.ts                   # entrypoint: ensureGroup, heartbeat log, run loop, graceful shutdown (IN10, DE4)
    test/pricing.test.ts
    test/error-category.test.ts
    test/extract.test.ts
    test/consumer.int.test.ts     # real Redis + real Postgres: XADD→process→row; idempotency; poison→DLQ; XAUTOCLAIM
vitest.workspace.ts               # EDIT: add 'api' + 'ingestion-worker' projects (testTimeout 30000, fileParallelism false)
.env.example                      # EDIT: add PORT, INGESTION_API_KEY, INGESTION_STREAM_MAXLEN, worker vars
package.json                      # EDIT: add start scripts for the two deployables
```

**Module responsibilities (single-responsibility, NFR8):** config/logger/redis/errors are app primitives reused by every later API plan. Receiver logic is split into pure pieces (`redaction`, `stream`) + a thin route. Worker extraction is pure functions (`pricing`, `error-category`, `extract`) so they unit-test trivially; `consumer` orchestrates Redis + DB; `main` wires the process. The two deployables expose start commands `pnpm --filter @ollive/api start` and `pnpm --filter @ollive/ingestion-worker start` (Plan 7 wires Dockerfiles/compose).

---

## Task 0: Shared contracts — re-export `runMigrations` from `@ollive/db` + add stream constants to `@ollive/shared`
**Implements:** cross-deployable contract pinning — (1) `runMigrations` resolves from `@ollive/db`'s package root; (2) the four pinned ingestion stream constants live in `@ollive/shared` so the API receiver and the worker import them from there and can never drift.
**Files:**
- Edit: `packages/db/src/index.ts` — append `export * from './migrate';` so `import { runMigrations } from '@ollive/db'` resolves from the package root. There is NO `@ollive/db/migrate` subpath import anywhere in this plan.
- Create: `packages/shared/src/streams.ts` — the four pinned constants.
- Edit: `packages/shared/src/index.ts` — append `export * from './streams';`.
**Design:**
- **Signatures / types:** the contract being exported (from Plan 1) is `runMigrations(databaseUrl: string): Promise<void>`. New constants:
  ```ts
  export const INGESTION_STREAM = 'inference-logs';
  export const INGESTION_DLQ = 'inference-logs-dlq';
  export const INGESTION_GROUP = 'ingestion-workers';
  export const PAYLOAD_FIELD = 'payload'; // each entry: { payload: "<JSON.stringify(InferenceLog)>" }
  ```
- **Algorithm:** pure barrel re-exports + four `const` declarations; no logic.
- **Patterns / decisions / edge cases:** single-source-of-truth constants prevent stream/group drift between the two deployables. Re-export at the package root (not a subpath) so every consumer imports `runMigrations` from `@ollive/db`.
**Test cases (write first, TDD):** none (type-only edits) — verify by typecheck.
**Done when:** `pnpm --filter @ollive/db exec tsc --noEmit` and `pnpm --filter @ollive/shared exec tsc --noEmit` both clean; `import { runMigrations } from '@ollive/db'` and `import { INGESTION_STREAM, INGESTION_DLQ, INGESTION_GROUP, PAYLOAD_FIELD } from '@ollive/shared'` both resolve. commit: `chore(db): re-export runMigrations from index; feat(shared): add ingestion stream constants` (two commits acceptable).

---

## Task 1: Scaffold `apps/api` package + typed config (TDD)
**Implements:** the first `apps/api` (PRD §4.4); the typed env/config module (extensible — later plans add vars).
**Files:**
- Create: `apps/api/package.json` — `@ollive/api`, `type: module`, `exports: { ".": "./src/app.ts" }`, `start: tsx src/server.ts`. Deps: `@ollive/db`/`@ollive/shared`/`@ollive/llm-sdk` (`workspace:*`), `express ^4.21.0`, `ioredis ^5.4.0`, `pino ^9.5.0`, `pino-http ^10.3.0`, `zod ^3.24.0`. Dev: `@types/express ^4.17.21`, `supertest ^7.0.0`, `@types/supertest ^6.0.2`, `tsx ^4.19.0`.
- Create: `apps/api/tsconfig.json` — `extends ../../tsconfig.base.json`, `include: ["src","test"]`.
- Create: `apps/api/src/config.ts`.
- Edit: `vitest.workspace.ts` — add the `api` project (`root: ./apps/api`, `testTimeout: 30000`, `fileParallelism: false`). Keep the `llm-sdk` entry (harmless `No test files found` if Plan 2 hasn't landed).
- Test: `apps/api/test/config.test.ts`.
**Design:**
- **Signatures / types:**
  ```ts
  interface AppConfig {
    port: number;
    databaseUrl: string;
    redisUrl: string;
    ingestionApiKey: string;
    ingestionStreamMaxLen: number;
  }
  function loadConfig(env?: NodeJS.ProcessEnv): AppConfig; // defaults to process.env
  ```
- **Algorithm:** a Zod `envSchema` with `z.coerce.number` for numeric vars and `z.string().min(1)` for required strings; `safeParse(env)`; on failure throw one `Error` listing every offending `path: message`; on success map to `AppConfig`. Defaults: `PORT=4000`, `INGESTION_STREAM_MAXLEN=100000`.
- **Patterns / decisions / edge cases:** typed-config + fail-fast (SE1: secrets via env only). Schema is the single extension point later plans grow. Empty `INGESTION_API_KEY` must fail (min(1)). `INGESTION_STREAM_MAXLEN` bounds stream memory (IN2).
**Test cases (write first, TDD):**
- Valid env → `port` coerced to number, `databaseUrl`/`redisUrl`/`ingestionApiKey` mapped through.
- Missing `PORT` and `INGESTION_STREAM_MAXLEN` → defaults `4000` and `100000`.
- `INGESTION_STREAM_MAXLEN='5000'` → `5000`.
- Missing `DATABASE_URL` → throws, message mentions `DATABASE_URL`.
- Empty `INGESTION_API_KEY` → throws, message mentions `INGESTION_API_KEY`.
**Done when:** `config` tests green + `pnpm --filter @ollive/api exec tsc --noEmit` clean (`pnpm install` first). commit: `feat(api): scaffold apps/api with typed Zod env config`.

---

## Task 2: API primitives — logger, shared Redis client, error handling, correlation id (BE8, BE9, §18)
**Implements:** structured pino logging (BE8/OB2), a single shared Redis client (BE9), the stable error shape + centralized error-handling middleware (§18), and the correlation-id middleware (BE8/OB2). These are small primitives with no branching worth a dedicated unit test (they are exercised by the supertest suites in Tasks 5 & 6); the task ends with a typecheck.
**Files:**
- Create: `apps/api/src/logger.ts`, `apps/api/src/redis.ts`, `apps/api/src/errors.ts`, `apps/api/src/middleware/correlation.ts`.
**Design:**
- **Signatures / types:**
  ```ts
  function createLogger(): Logger; // pino, level from LOG_LEVEL, base { service }
  function createRedis(url: string): Redis; // ioredis, maxRetriesPerRequest: null

  type ErrorCode = 'validation_error' | 'unauthorized' | 'not_found' | 'login_required' | 'internal_error';
  class AppError extends Error {
    readonly code: ErrorCode;
    readonly status: number;   // derived from code unless overridden
    readonly details?: unknown;
    constructor(code: ErrorCode, message: string, details?: unknown, status?: number);
  }
  function errorHandler(logger: Logger): ErrorRequestHandler; // mounted LAST
  function correlationId(): RequestHandler;
  // Express Request augmented with `requestId?: string`.
  ```
- **Algorithm:** `errorHandler` — if `err instanceof AppError`, respond `err.status` with `{ error: code, details? }` and `logger.warn`; else log `logger.error` and respond `500 { error: 'internal_error' }` (raw detail never leaks). `correlationId` — honor inbound `x-request-id` else `randomUUID()`, set it on the response header and `req.requestId`. Status map: validation_error→400, unauthorized→401, not_found→404, login_required→403, internal_error→500.
- **Patterns / decisions / edge cases:** factory functions for DI; `maxRetriesPerRequest: null` so blocking `XREADGROUP` reads aren't aborted by the retry cap; stable wire shape `{ error: <code>, details? }` (§18); the same Redis client type is reused by the worker.
**Test cases (write first, TDD):** none in isolation — covered by Tasks 5 & 6 integration tests (401/400/404 shapes, correlation header echo).
**Done when:** `pnpm --filter @ollive/api exec tsc --noEmit` clean. commit: `feat(api): add pino logger, shared redis client, error handler, correlation id`.

---

## Task 3: Ingestion redaction backstop (IN9) (TDD)
**Implements:** IN9 — the receiver re-applies PII redaction to previews + string metadata before enqueue (defense in depth; the SDK is primary but standalone and could be misconfigured). Reuses `@ollive/llm-sdk`'s `PatternRedactor` (Plan 2) for the same deterministic detector. Pure function → plain Vitest, no network.
**Files:**
- Create: `apps/api/src/ingestion/redaction.ts`.
- Test: `apps/api/test/redaction.test.ts`.
**Design:**
- **Signatures / types:**
  ```ts
  function redactInferenceLog(log: InferenceLog): InferenceLog; // returns a NEW log, does not mutate input
  ```
- **Algorithm:** instantiate one shared stateless `PatternRedactor`; helper `redact(s) = redactor.redact(s).text`. Build a fresh `preview` redacting `input`/`output` when present; build fresh `metadata` mapping each top-level entry — redact string values, pass non-strings through unchanged. Spread into a new log object.
- **Patterns / decisions / edge cases:** pure-function extraction; immutability (no input mutation). Redaction is **shallow** over `metadata` (top-level string values only); nested objects left untouched (documented — the SDK is the primary structure-aware scrubber and the preview cap bounds exposure). Output must remain `inferenceLogSchema`-valid. Handles absent preview and empty metadata.
**Test cases (write first, TDD):**
- PII in `preview.input`/`preview.output` (email, SSN) → replaced with `[EMAIL]`/`[SSN]`; originals gone.
- String metadata value with a credit-card number → `[CREDIT_CARD]`; numeric metadata (`temperature`, `contextMessages`) untouched; nested object value left as-is (shallow).
- Clean log → unchanged previews and result is schema-valid.
- Log with empty preview `{}` and empty metadata `{}` → no throw, result schema-valid.
- Input log object is not mutated (deep-equal before/after).
**Done when:** `redaction` tests green + `tsc --noEmit` clean. commit: `feat(api): add ingestion redaction backstop reusing SDK PatternRedactor`.

---

## Task 4: `XADD` enqueue helper (IN1, IN2)
**Implements:** `xaddInferenceLog()` — `XADD inference-logs MAXLEN ~ N * payload <json>` (IN2). Imports `INGESTION_STREAM` and `PAYLOAD_FIELD` from `@ollive/shared` (Task 0). Thin Redis wrapper; exercised by the receiver integration test in Task 5, so this task ends with a typecheck.
**Files:**
- Create: `apps/api/src/ingestion/stream.ts`.
**Design:**
- **Signatures / types:**
  ```ts
  function xaddInferenceLog(redis: Redis, log: InferenceLog, maxLen: number): Promise<string>; // returns the stream entry id
  ```
- **Algorithm:** call `redis.xadd(INGESTION_STREAM, 'MAXLEN', '~', String(maxLen), '*', PAYLOAD_FIELD, JSON.stringify(log))`; return the id (with `'*'` it is always non-null).
- **Patterns / decisions / edge cases:** approximate `MAXLEN ~ N` bounds stream memory cheaply (Redis trims in whole macro-nodes). Stream contract constants come from `@ollive/shared` so API and worker never drift. Single-field `payload` entry is the pinned wire shape.
**Test cases (write first, TDD):** none here — asserted via Task 5's "entry lands on the stream" integration test.
**Done when:** `pnpm --filter @ollive/api exec tsc --noEmit` clean. commit: `feat(api): add XADD enqueue helper for inference-logs stream`.

---

## Task 5: Ingestion auth + `POST /v1/logs` receiver + `createApp` + health routes (TDD, supertest + real Redis)
**Implements:** Bearer auth (AU5 → 401 `unauthorized`), Zod validation (BE3 → 400 `validation_error` with details), redaction backstop before enqueue (IN9), `XADD` then `202 { accepted, requestId }` with NO DB write (IN1/BE6), the `createApp({ db, redis, config })` factory (mount point for later routers), and health routes (§8.6/OB4). Integration-tested with supertest against a real Redis (assert an entry lands on the stream).
**Files:**
- Create: `apps/api/src/middleware/ingestion-auth.ts`, `apps/api/src/routes/logs.ts`, `apps/api/src/routes/health.ts`, `apps/api/src/app.ts`.
- Test: `apps/api/test/logs.int.test.ts`.
**Design:**
- **Signatures / types:**
  ```ts
  function ingestionAuth(apiKey: string): RequestHandler;

  interface LogsRouterDeps { redis: Redis; ingestionApiKey: string; ingestionStreamMaxLen: number; }
  function logsRouter(deps: LogsRouterDeps): Router; // POST /logs (mounted at /v1)

  interface HealthRouterDeps { db: Db; redis: Redis; }
  function healthRouter(deps: HealthRouterDeps): Router; // GET /healthz, GET /readyz

  interface AppDeps { db: Db; redis: Redis; config: AppConfig; logger?: Logger; }
  function createApp(deps: AppDeps): Express;
  ```
- **Algorithm:**
  - `ingestionAuth`: match `Authorization: Bearer <token>` (case-insensitive); on missing/mismatch `next(new AppError('unauthorized', ...))`.
  - `logsRouter` POST `/logs`: `ingestionAuth` → `inferenceLogSchema.safeParse(req.body)` (fail → `AppError('validation_error', msg, issues)`) → `redactInferenceLog` (IN9) → `xaddInferenceLog` → respond `202 { accepted: true, requestId }`; wrap in try/catch → `next(err)`. Never touches Postgres.
  - `healthRouter`: `GET /healthz` → `200 { status: 'ok' }`. `GET /readyz` → run `db.execute(sql\`select 1\`)` and `redis.ping()` each in their own try/catch, build `{ db, redis }` each `'ok' | 'error'`, respond `200` if both ok else `503`.
  - `createApp`: order is `correlationId()` → `pinoHttp({ logger, genReqId: read x-request-id })` → `express.json({ limit: '1mb' })` → `healthRouter` at `/` → `logsRouter` at `/v1` → **FUTURE mount point (Plans 4/5: auth/conversations/chat/metrics routers go here)** → 404 fallback `next(new AppError('not_found', ...))` → `errorHandler(logger)` LAST.
- **Patterns / decisions / edge cases:** app-factory + dependency injection (no singleton imports) — the documented extension point for Plans 4 & 5. Bearer service-to-service auth (AU5/SE2). 1 MB JSON body cap. Centralized error handler is always last. `/readyz` degrades each dependency independently so a partial outage is visible.
**Test cases (write first, TDD — supertest against real Redis, `afterEach` deletes the stream):**
- POST `/v1/logs` with no/invalid Bearer key → `401 { error: 'unauthorized' }` and `XLEN inference-logs == 0` (nothing enqueued).
- POST with valid key but malformed body → `400`, `error: 'validation_error'`, `details` is an array, and nothing enqueued.
- POST with valid key + valid log → `202 { accepted: true, requestId }`; exactly one stream entry under field `payload`; parsed payload has the right `requestId` and a redacted preview (`[EMAIL]`, original email absent — proves IN9 ran before enqueue).
- `GET /healthz` → `200 { status: 'ok' }`.
- Unknown route → `404 { error: 'not_found' }`.
**Done when:** `logs` tests green against real Redis (infra up) + `tsc --noEmit` clean. commit: `feat(api): add createApp factory, /v1/logs receiver, and health routes`.

---

## Task 6: `server.ts` entrypoint + graceful shutdown (BE8) + health integration test (TDD, real Postgres + Redis)
**Implements:** the `apps/api` process entrypoint (build deps from env, run migrations on startup per DE3, listen on `PORT`, drain db + redis on SIGTERM/SIGINT — BE8), and a `/readyz` integration test against real infra (§8.6, OB4, DE4).
**Files:**
- Create: `apps/api/src/server.ts` (the entrypoint — there is no `src/index.ts`).
- Test: `apps/api/test/health.int.test.ts`.
**Design:**
- **Signatures / types:** module-level `async function main(): Promise<void>`; no exports (it is the process entry, run via `tsx src/server.ts`). Imports `runMigrations`, `createDb` from `@ollive/db` (package root), `createRedis`, `createApp`, `loadConfig`, `createLogger`.
- **Algorithm:** `loadConfig()` → `createLogger()` → `await runMigrations(config.databaseUrl)` (idempotent, DE3) → `createDb` + `createRedis` → `createApp` → `app.listen(config.port)`. `shutdown(signal)`: guard re-entry, `server.close(...)` then `redis.disconnect()` + `await db.$client.end({ timeout: 5 })` then `process.exit(0)`; arm a 10 s hard-cap timer (`.unref()`) → `exit(1)`. Wire `SIGTERM`/`SIGINT`. Top-level `main().catch` logs and `exit(1)`.
- **Patterns / decisions / edge cases:** migrate-on-startup (idempotent); graceful drain with a hard timeout so a stuck connection can't hang the process. Dependencies built once and injected into `createApp`.
**Test cases (write first, TDD — real Postgres + Redis, `runMigrations` in `beforeAll`, cleanup in `afterAll`):**
- `GET /healthz` → `200 { status: 'ok' }`.
- `GET /readyz` → `200 { db: 'ok', redis: 'ok' }` when both dependencies are reachable.
**Done when:** `health` tests green (infra up) + `pnpm --filter @ollive/api exec tsc --noEmit` clean (also validates the `runMigrations` re-export and `db.$client`) + full `--project api` suite green. commit: `feat(api): add server entrypoint with graceful shutdown and readyz check`.

---

## Task 7: Scaffold `apps/ingestion-worker` + config + logger (second deployable)
**Implements:** the second Node process (PRD §4.4) + its typed config + pino logger. The worker imports the stream/group constants from `@ollive/shared` (Task 0) and writes via `@ollive/db`. It does **not** depend on `@ollive/api` — keeping Express/pino-http/supertest out of its dependency graph.
**Files:**
- Create: `apps/ingestion-worker/package.json` — `@ollive/ingestion-worker`, `type: module`, `exports: { ".": "./src/main.ts" }`, `start: tsx src/main.ts`. Deps: `@ollive/db`/`@ollive/shared` (`workspace:*`), `drizzle-orm ^0.38.0` (direct — upsert uses `onConflictDoUpdate`), `ioredis ^5.4.0`, `pino ^9.5.0`, `zod ^3.24.0`. Dev: `tsx ^4.19.0`. NO `@ollive/api` dependency.
- Create: `apps/ingestion-worker/tsconfig.json` — extends base, `include: ["src","test"]`.
- Create: `apps/ingestion-worker/src/config.ts`, `apps/ingestion-worker/src/logger.ts`.
- Edit: `vitest.workspace.ts` — add the `ingestion-worker` project (`testTimeout: 30000`, `fileParallelism: false`).
**Design:**
- **Signatures / types:**
  ```ts
  interface WorkerConfig {
    databaseUrl: string;
    redisUrl: string;
    consumerName: string;   // WORKER_CONSUMER_NAME, default 'worker-1'
    batchSize: number;      // WORKER_BATCH_SIZE, default 50  (IN6 backpressure)
    blockMs: number;        // WORKER_BLOCK_MS, default 5000
    maxDeliveries: number;  // WORKER_MAX_DELIVERIES, default 3 (IN5 retry budget)
    claimIdleMs: number;    // WORKER_CLAIM_IDLE_MS, default 30000 (IN5 XAUTOCLAIM idle)
  }
  function loadWorkerConfig(env?: NodeJS.ProcessEnv): WorkerConfig;
  function createLogger(): Logger; // base service 'ollive-ingestion-worker'
  ```
- **Algorithm:** same Zod fail-fast pattern as the API config; coerce numbers, default the worker tunables; map to `WorkerConfig`.
- **Patterns / decisions / edge cases:** typed config mirrors the API convention. `batchSize` is the backpressure knob (IN6); `maxDeliveries`/`claimIdleMs` govern DLQ + reclaim (IN5). Worker decoupled from `@ollive/api`.
**Test cases (write first, TDD):** none required for this scaffold (config is the same pattern as Task 1; a smoke check that `--project ingestion-worker` reports `No test files found` is sufficient). Optionally a tiny `loadWorkerConfig` defaults test if the implementer wants TDD parity.
**Done when:** `pnpm --filter @ollive/ingestion-worker exec tsc --noEmit` clean and the project is wired into the workspace runner. commit: `feat(worker): scaffold ingestion-worker package, config, logger`.

---

## Task 8: Cost estimation — per-model price table (IN10, §16.1) (TDD)
**Implements:** `estimateCostUsd()` — token usage × a per-model price table, feeding the dedicated `estimated_cost_usd` column. Pure function → plain Vitest.
**Files:**
- Create: `apps/ingestion-worker/src/pricing.ts`.
- Test: `apps/ingestion-worker/test/pricing.test.ts`.
**Design:**
- **Signatures / types:**
  ```ts
  interface ModelPrice { inputPerMillion: number; outputPerMillion: number; } // USD per 1M tokens
  const PRICE_TABLE: Record<string, ModelPrice>; // gemini-2.5-flash {0.30,2.50}, gemini-2.5-pro {1.25,10.0}, gpt-4o-mini {0.15,0.60}, gpt-4o {2.50,10.0}
  function estimateCostUsd(model: string, usage: Usage | null | undefined): number;
  ```
- **Algorithm:** if `!usage` → 0; look up `PRICE_TABLE[model]`, if missing → 0; `cost = promptTokens/1e6 * inputPerMillion + completionTokens/1e6 * outputPerMillion`.
- **Patterns / decisions / edge cases:** small hardcoded config map (public list prices, 2026-05) — NOT a billing source of truth (NG5); extend by adding a row. Unknown model and null usage both price to 0 so the column is always storable. Zero tokens → 0.
**Test cases (write first, TDD):**
- `gemini-2.5-flash` with 1M prompt + 1M completion → ≈ 2.80.
- `gpt-4o-mini` with 2M prompt + 1M completion → ≈ 0.15*2 + 0.60.
- Unknown model → 0.
- Null usage → 0.
- Zero tokens → 0.
- `PRICE_TABLE` includes `gemini-2.5-flash` and `gpt-4o-mini`.
**Done when:** `pricing` tests green. commit: `feat(worker): add per-model price table and cost estimation`.

---

## Task 9: Error categorization (IN10, §16.1) (TDD)
**Implements:** `categorizeError()` — normalize a raw provider error → `rate_limit | timeout | auth | content_filter | other`, feeding the dedicated `error_category` column behind the error dashboard. Pure function → plain Vitest.
**Files:**
- Create: `apps/ingestion-worker/src/error-category.ts`.
- Test: `apps/ingestion-worker/test/error-category.test.ts`.
**Design:**
- **Signatures / types:**
  ```ts
  interface RawError { code: string; message: string; providerCode?: string; } // the SDK error sub-shape (PRD §9)
  function categorizeError(error: RawError | null | undefined): ErrorCategory | null;
  ```
- **Algorithm:** if `!error` → null. Build a lowercased haystack of `code + message + providerCode`. Match in priority order: rate_limit (`429`, `rate limit`, `resource exhausted`, `too many requests`, `quota`) → timeout (`504`/`408`, `timed out`/`timeout`, `deadline`, `etimedout`) → auth (`401`/`403`, `unauthorized`, `unauthenticated`, `permission denied`, `api key`, `forbidden`) → content_filter (`content filter`, `safety`, `blocked`, `moderation`) → fallback `other`.
- **Patterns / decisions / edge cases:** rule-table normalization combining structured signals (HTTP status in `providerCode`) and message keywords. Returns null for success/cancelled logs. Priority order matters (rate_limit before generic 5xx, etc.).
**Test cases (write first, TDD):**
- null/undefined → null.
- rate-limit signals (`429`, `Resource exhausted`, `rate_limit_exceeded`) → `rate_limit`.
- timeout signals (`provider_timeout`, `504`, `etimedout`) → `timeout`.
- auth signals (`401`, `invalid API key`, `403`/`permission_denied`) → `auth`.
- content-filter signals (`content_filter`, `blocked by safety settings`) → `content_filter`.
- unrecognized (`weird` / `500`) → `other`.
**Done when:** `error-category` tests green. commit: `feat(worker): add provider error categorization`.

---

## Task 10: Metadata extraction — assemble the DB row (IN10, §16.1, IN8) (TDD)
**Implements:** `extractMetadata()` — turn a validated `InferenceLog` into the exact `inference_logs` column values: dedicated `estimated_cost_usd` + `error_category` columns plus the derived `metadata` JSONB (`tokensPerSecond`, `promptChars`, `outputChars`, `contextMessageCount`, `redactions`, `sdkVersion`, `appName`, `guestSessionId`) per §16.1. Guest handling (IN8): null `conversationId`/`userId`/`messageId`, `metadata.guestSessionId` carried through. Pure function → plain Vitest.
**Files:**
- Create: `apps/ingestion-worker/src/extract.ts`.
- Test: `apps/ingestion-worker/test/extract.test.ts`.
**Design:**
- **Signatures / types:**
  ```ts
  interface InferenceLogRow {        // field names MATCH the @ollive/db `inferenceLogs` columns so upsert can spread it
    requestId: string;
    conversationId: string | null;
    messageId: string | null;
    userId: string | null;
    provider: string;
    model: string;
    status: InferenceLog['status'];
    latencyMs: number | null;
    timeToFirstTokenMs: number | null;
    promptTokens: number | null;
    completionTokens: number | null;
    totalTokens: number | null;
    inputPreview: string | null;
    outputPreview: string | null;
    errorCode: string | null;
    errorMessage: string | null;
    startedAt: Date | null;
    completedAt: Date | null;
    estimatedCostUsd: string;        // 6-dp string for NUMERIC(12,6) (postgres.js sends NUMERIC as text)
    errorCategory: ErrorCategory | null;
    metadata: Record<string, unknown>; // the derived-signal JSONB
  }
  function extractMetadata(log: InferenceLog): InferenceLogRow;
  ```
- **Algorithm:** read `usage`/`metadata` (defaulting to null/{}); `tokensPerSecond = latencyMs > 0 ? completionTokens / (latencyMs/1000) : 0`; previews → `inputPreview`/`outputPreview` (or null); build derived `metadata` (`promptChars`/`outputChars` from preview lengths, `contextMessageCount` from `meta.contextMessages ?? meta.contextMessageCount ?? 0`, pass through `redactions`/`sdkVersion`/`appName`/`guestSessionId`); map context ids (null when absent — guest); `startedAt`/`completedAt` → `new Date(...)`; `estimatedCostUsd = estimateCostUsd(model, usage).toFixed(6)`; `errorCategory = categorizeError(log.error)`; `errorCode`/`errorMessage` from `log.error` or null.
- **Patterns / decisions / edge cases:** pure function (same input → same output, no I/O). Column-name parity with the Drizzle table lets the upsert spread the object. Guard against zero latency (no division by zero). On an error log: `usage` null → cost `'0.000000'` and token columns null. Guest log (IN8): context ids null, `guestSessionId` preserved in metadata.
**Test cases (write first, TDD):**
- Success path → all base columns mapped (ids, provider/model/status, latency, tokens, previews; error fields null).
- `estimated_cost_usd` formatted to a 6-dp string (e.g. `'0.000596'` for 420 prompt + 188 completion on gemini-2.5-flash).
- Derived metadata: `tokensPerSecond` ≈ completion/(latency/1000); `promptChars`/`outputChars` = preview lengths; `contextMessageCount` from `contextMessages`; `redactions` passed through; `sdkVersion`/`appName` set; `guestSessionId` null when absent.
- Error log (status error, null usage, rate-limit error) → `errorCategory = 'rate_limit'`, `errorCode`/`errorMessage` set, `estimatedCostUsd = '0.000000'`, token columns null.
- Guest log (empty context, `metadata.guestSessionId` set) → `conversationId`/`userId`/`messageId` null, `guestSessionId` carried in metadata (IN8).
- Zero latency → `tokensPerSecond === 0` (no NaN/Infinity).
**Done when:** `extract` tests green. commit: `feat(worker): add metadata extraction mapping wire log to db row`.

---

## Task 11: Idempotent upsert + counters (IN4, IN7/OB3)
**Implements:** `upsertInferenceLog()` — insert into `inference_logs` with `ON CONFLICT (request_id) DO UPDATE` (idempotent at-least-once handling, IN4) via the `@ollive/db` Drizzle client, and a small `Counters` object exposing processed/failed/dlq (IN7, OB3). The upsert is exercised by the worker integration test in Task 13; counters are asserted there too.
**Files:**
- Create: `apps/ingestion-worker/src/upsert.ts`, `apps/ingestion-worker/src/counters.ts`.
**Design:**
- **Signatures / types:**
  ```ts
  interface Counters { processed: number; failed: number; dlq: number; }
  function createCounters(): Counters;

  function upsertInferenceLog(db: Db, row: InferenceLogRow): Promise<void>;
  ```
- **Algorithm:** `db.insert(inferenceLogs).values({...row}).onConflictDoUpdate({ target: inferenceLogs.requestId, set: {...row} })`. The `set` mirrors all mutable columns; `created_at` (ingestion time) is left to its DB default and is NOT overwritten on conflict.
- **Patterns / decisions / edge cases:** idempotent-upsert pattern over the UNIQUE `request_id` (the dedup anchor for at-least-once Redis Streams delivery, A8). Re-delivery updates the existing row rather than inserting a duplicate. `Counters` is a plain mutable object so tests can assert on it and `main.ts`/Plan 7 can surface it. Type notes: `errorCategory` is a `string | null` assignable to the `text` column; `estimatedCostUsd` is a string for the `numeric` column.
**Test cases (write first, TDD):** none in isolation — covered by Task 13 (idempotency: same `request_id` twice → exactly one row; counters increment).
**Done when:** `pnpm --filter @ollive/ingestion-worker exec tsc --noEmit` clean. commit: `feat(worker): add idempotent inference_logs upsert and observability counters`.

---

## Task 12: Consumer — group setup, batch processing, DLQ routing, stale reclaim (IN3/IN4/IN5)
**Implements:** `ensureGroup` (create the consumer group, tolerate `BUSYGROUP` — IN3), `processBatch` (`XREADGROUP` a configurable batch → parse/re-validate → extract → upsert → `XACK`; poison entries past `maxDeliveries` → DLQ + ack so the pipeline never wedges — IN4/IN5/IN6), and `reclaimStale` (`XAUTOCLAIM` entries idle past the threshold for crashed-consumer recovery — IN5). Redis+DB orchestration; integration-tested end-to-end in Task 13, so this task ends with a typecheck.
**Files:**
- Create: `apps/ingestion-worker/src/consumer.ts`.
**Design:**
- **Signatures / types:**
  ```ts
  type StreamEntry = [id: string, fields: string[]]; // ioredis flat [field, value, ...]

  interface ConsumerDeps {
    redis: Redis; db: Db; logger: Logger; counters: Counters;
    consumerName: string; batchSize: number; blockMs: number;
    maxDeliveries: number; claimIdleMs: number;
  }

  function ensureGroup(redis: Redis, logger: Logger): Promise<void>;
  function processBatch(deps: ConsumerDeps): Promise<number>;  // returns # entries read (0 = block timed out)
  function reclaimStale(deps: ConsumerDeps): Promise<number>;  // returns # entries reclaimed
  // internal: readPayload(fields), routeToDlq(deps, id, rawPayload, reason, deliveries), processEntry(deps, entry, deliveries)
  ```
- **Algorithm:**
  1. `ensureGroup`: `XGROUP CREATE inference-logs ingestion-workers '$' MKSTREAM`; swallow a `BUSYGROUP` error (group already exists); rethrow anything else. Idempotent — safe per boot.
  2. `processEntry(entry, deliveries)`: read the `payload` field; if missing or `JSON.parse` throws → `routeToDlq` (dead-on-arrival) and return; `inferenceLogSchema.safeParse` fail → `routeToDlq('schema_validation_failed')`. Else `extractMetadata` → `upsertInferenceLog` → `XACK` → `counters.processed++`. On a thrown (transient) DB error: `counters.failed++`; if `deliveries >= maxDeliveries` → `routeToDlq('exhausted_retries')`; otherwise leave the entry **unacked** (stays in the PEL for `reclaimStale` to retry).
  3. `routeToDlq`: `XADD inference-logs-dlq * payload <raw> reason <reason> deliveries <n> sourceId <id>` then `XACK` the source entry (so it leaves the PEL) and `counters.dlq++`.
  4. `processBatch`: `XREADGROUP GROUP ingestion-workers <consumer> COUNT <batchSize> BLOCK <blockMs> STREAMS inference-logs '>'`; for each entry `processEntry(entry, 1)` (fresh delivery); return count.
  5. `reclaimStale`: `XAUTOCLAIM inference-logs ingestion-workers <consumer> <claimIdleMs> '0' COUNT <batchSize>`; for each reclaimed entry `processEntry(entry, maxDeliveries)` (already delivered + idle → treat as final retry, so a still-failing reclaimed entry goes to the DLQ).
- **Patterns / decisions / edge cases:** consumer-group + named-consumer pattern; XAUTOCLAIM reclaim for crashed-consumer recovery; DLQ + ack so a poison message never wedges the pipeline (§18 "worker never crash-loops"); bounded-retry budget via `deliveries` vs `maxDeliveries`; batch `COUNT` is the backpressure knob (IN6). Distinguish dead-on-arrival (parse/schema → DLQ immediately) from transient (DB → retry then DLQ). ioredis returns `xreadgroup`/`xautoclaim` loosely; narrow with `as` casts to the tuple shapes above.
**Test cases (write first, TDD):** none in isolation — fully covered by Task 13's end-to-end suite.
**Done when:** `pnpm --filter @ollive/ingestion-worker exec tsc --noEmit` clean. commit: `feat(worker): add consumer group setup, batch processing, DLQ routing, reclaim`.

---

## Task 13: Worker end-to-end integration tests (TDD, real Redis + real Postgres)
**Implements:** the vertical-slice proof — `XADD` a payload → run one consumer cycle → assert the `inference_logs` row (incl. extracted fields); idempotency on duplicate `request_id`; poison payloads land in the DLQ. Matches Plan 1's integration harness (real Postgres via `DATABASE_URL` fallback + `runMigrations`/cleanup) extended to real Redis. Note the implementation (consumer/extract/upsert) was built in Tasks 8–12; this task verifies it against real infra.
**Files:**
- Test: `apps/ingestion-worker/test/consumer.int.test.ts`.
**Design:**
- **Harness:** `beforeAll` runs `runMigrations(databaseUrl)` and builds `db` + `redis`; `afterEach` deletes the stream, the DLQ, and truncates `inference_logs`; `afterAll` cleans up and closes both clients. Each test calls `ensureGroup` then enqueues via `XADD ... payload <json>` and drives one `processBatch` per `ConsumerDeps` (fresh counters + unique consumer name).
- **Helpers (signatures only):** `makeLog(overrides?): InferenceLog`, `makeDeps(): ConsumerDeps`, `enqueue(log): Promise<void>`.
**Test cases (write first, TDD):**
- Valid payload → `processBatch` returns 1, `counters.processed === 1`; one `inference_logs` row with right provider/model/totalTokens, `estimated_cost_usd === '0.000596'`, `error_category` null, `metadata.tokensPerSecond ≈ 188`, `metadata.appName` set; `XPENDING` count is 0 (entry was XACK'd).
- Same `request_id` enqueued and processed twice (at-least-once redelivery) → still exactly one row (IN4/AC8 — idempotent upsert).
- Error log (status error, rate-limit error, null usage) → row `status='error'`, `error_category='rate_limit'`, `error_code='rate_limited'`.
- Guest log (empty context, `metadata.guestSessionId`) → row `conversation_id`/`user_id` null, `metadata.guestSessionId` carried (IN8).
- Poison unparseable payload (`'this-is-not-json{'`) → `counters.dlq === 1`, `counters.processed === 0`, no `inference_logs` row, `XLEN inference-logs-dlq === 1`, source `XPENDING` count 0 (acked off the main PEL).
- Schema-invalid payload (valid JSON, wrong shape) → routed to DLQ (`counters.dlq === 1`, DLQ length 1).
**Done when:** `consumer` tests green against real infra (infra up) + full `--project ingestion-worker` suite green. commit: `test(worker): verify e2e ingestion, idempotency, guest, and DLQ against infra`.

---

## Task 14: Worker `main.ts` entrypoint — run loop, heartbeat, graceful shutdown (IN10, DE4)
**Implements:** the worker process entrypoint: validate env, run migrations (DE3), build db + redis, `ensureGroup`, then a run loop interleaving `processBatch` and periodic `reclaimStale`, a readiness heartbeat log (DE4) + periodic counter logs (IN7/OB3), and graceful shutdown on SIGTERM/SIGINT. Process-wiring shell over already-tested units — no unit test; ends with a typecheck + a manual smoke run.
**Files:**
- Create: `apps/ingestion-worker/src/main.ts`.
**Design:**
- **Signatures / types:** module-level `async function main(): Promise<void>`; no exports (run via `tsx src/main.ts`).
- **Algorithm:** `loadWorkerConfig()` → `createLogger()` → `await runMigrations(databaseUrl)` (DE3) → `createDb` + `new Redis(redisUrl, { maxRetriesPerRequest: null })` + `createCounters()` → `ensureGroup` → build `ConsumerDeps`. Log a readiness heartbeat (`'ingestion worker ready'`, DE4). Loop while `running`: `await processBatch(deps)`; every `claimIdleMs` run `reclaimStale`; every 30 s log `{ counters }` (IN7/OB3); wrap the loop body in try/catch that logs and sleeps 1 s on error (never crash-loop, §18). `shutdown(signal)`: guard re-entry, set `running=false`, `redis.disconnect()` + `await db.$client.end({ timeout: 5 })`, `process.exit(0)`, with a 10 s hard-cap timer (`.unref()`). Top-level `main().catch` logs and `exit(1)`.
- **Patterns / decisions / edge cases:** run-loop with interleaved reclaim; resilient loop (catch + backoff so the worker never crash-loops); readiness-via-log heartbeat (DE4); periodic counter logging (OB3); graceful drain with hard timeout.
**Test cases (write first, TDD):** none (process wiring). Verified by the manual curl smoke run below.
- **Manual smoke (full vertical slice, infra up):** start API (`INGESTION_API_KEY=dev-key pnpm --filter @ollive/api start` → logs `migrations applied`, `api listening`), start worker (`pnpm --filter @ollive/ingestion-worker start` → logs `ingestion worker ready`), `curl -XPOST http://localhost:4000/v1/logs` with `Authorization: Bearer dev-key` and a valid `InferenceLog` whose preview contains an email → `202 { accepted: true, requestId }`; the `inference_logs` row shows `input_preview` redacted to `[EMAIL]` and a populated `estimated_cost_usd`. Ctrl-C each → `shutdown complete`.
**Done when:** `pnpm --filter @ollive/ingestion-worker exec tsc --noEmit` clean + smoke run produces the redacted, costed row. commit: `feat(worker): add main entrypoint with run loop, heartbeat, graceful shutdown`.

---

## Task 15: Wire env example + root start scripts; full-suite green
**Implements:** document the new env vars (DE5 partial — the vars this plan introduces) and expose the two deployables' start commands at the repo root so Plan 7 can wire them. Does NOT add Dockerfiles or compose service entries (Plan 7).
**Files:**
- Edit: `.env.example` — append (keeping Plan 1's `DATABASE_URL`/`REDIS_URL`):
  ```dotenv
  # --- API (Plan 3) ---
  PORT=4000
  INGESTION_API_KEY=dev-ingestion-key   # SDK sends `Authorization: Bearer <key>` to /v1/logs (AU5/SE2)
  INGESTION_STREAM_MAXLEN=100000        # approximate cap on the inference-logs stream (IN2)
  # --- Ingestion worker (Plan 3) ---
  WORKER_CONSUMER_NAME=worker-1
  WORKER_BATCH_SIZE=50
  WORKER_BLOCK_MS=5000
  WORKER_MAX_DELIVERIES=3
  WORKER_CLAIM_IDLE_MS=30000
  ```
- Edit: `package.json` — add scripts `start:api`, `start:worker`, `dev:api`, `dev:worker` (each a `pnpm --filter @ollive/{api,ingestion-worker} {start,dev}`) alongside the existing `test`/`db:*` scripts.
**Design:**
- **Algorithm:** documentation + script wiring only; no code logic.
- **Patterns / decisions / edge cases:** env-as-config doc surface (DE5); root scripts are the documented launch contract Plan 7 wires into Dockerfiles/compose.
**Test cases (write first, TDD):** none (config/docs). Verified by the full-suite gates.
**Done when:** `pnpm test` passes all projects with Postgres + Redis up (`llm-sdk` reporting `No test files found` is acceptable if Plan 2 hasn't landed) + `pnpm typecheck` clean. commit: `chore: document ingestion env vars and add deployable start scripts`.

---

## Definition of Done

- [ ] `pnpm install` resolves `@ollive/api` and `@ollive/ingestion-worker` with their deps + `workspace:*` links.
- [ ] `pnpm --filter @ollive/api exec tsc --noEmit` and `pnpm --filter @ollive/ingestion-worker exec tsc --noEmit` pass.
- [ ] `pnpm exec vitest run --project api` passes (config, redaction, logs, health).
- [ ] `pnpm exec vitest run --project ingestion-worker` passes (pricing, error-category, extract, consumer).
- [ ] `pnpm test` passes all projects (with Postgres + Redis running).
- [ ] Curl smoke test (Task 14): `POST /v1/logs` → `202` → a row in `inference_logs` with a redacted `input_preview` and a populated `estimated_cost_usd`.
- [ ] `apps/api` exposes `pnpm --filter @ollive/api start`; `apps/ingestion-worker` exposes `pnpm --filter @ollive/ingestion-worker start`.
- [ ] No real LLM API call occurs anywhere in this plan.

### Ingestion requirement → task map (coverage check)

| Requirement | Where |
|---|---|
| IN1 — receiver: API-key auth → Zod → XADD → 202, no DB write | Tasks 4, 5 |
| IN2 — stream capped with approximate MAXLEN ~ N | Tasks 1 (config), 4 (xadd) |
| IN3 — consumer group `ingestion-workers`, named consumer XREADGROUP | Task 12 (ensureGroup, processBatch) |
| IN4 — parse → normalize → extract → idempotent upsert on request_id → XACK | Tasks 10, 11, 12 |
| IN5 — XAUTOCLAIM stale recovery; poison → DLQ + ack | Task 12 (reclaimStale, routeToDlq), Task 13 (tests) |
| IN6 — backpressure via worker-controlled batch size | Tasks 7 (config batchSize), 12 (COUNT) |
| IN7 — structured logs + processed/failed/DLQ counters | Tasks 11 (counters), 14 (logging) |
| IN8 — guest logs: null conv/user id, metadata.guestSessionId | Tasks 10 (extract), 13 (test) |
| IN9 — receiver redaction backstop on previews + string metadata | Tasks 3, 5 |
| IN10 — extracted metadata (cost column, error_category column, derived JSONB) | Tasks 8, 9, 10 |
| §8.4 — `/v1/logs` 202/400/401 contract | Task 5 |
| §8.6 / OB4 / DE4 — `/healthz`, `/readyz` (db+redis), worker heartbeat | Tasks 5 (health), 6 (readyz int test), 14 (heartbeat) |
| BE6 — receiver enqueues, never writes Postgres | Task 5 |
| BE8 — pino + correlation id + graceful shutdown | Tasks 2, 6, 14 |
| BE9 — single shared Redis client | Task 2 |
| AU5 / SE2 — ingestion Bearer key auth | Task 5 |
| §18 — stable `{ error: <code> }` shape; worker never crash-loops | Tasks 2 (errorHandler), 12/14 (DLQ + run-loop catch) |

This plan is consumed by Plan 4 (API — mounts auth/conversations/chat routers in the same `createApp` factory and ships chat logs through this receiver) and Plan 7 (Deployment — wires the two deployables' Dockerfiles/compose services using the documented start commands).
