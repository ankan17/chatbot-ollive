# API Auth + Conversations Implementation Plan (Plan 4 of 7)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Format note (design-level):** This plan specifies *what* to build and *what to test* — it gives **type/function signatures, algorithms, test-case descriptions, and design patterns**, not finished implementation code and not literal `it(...)`/`expect(...)` test bodies. The implementing subagent authors the real code and the real Vitest/supertest tests, driving them from the test cases listed here (TDD: write the test, watch it fail, implement, watch it pass). Code fences contain ONLY interface/type declarations and bare function signatures (no bodies); `// pseudocode` comments and tiny wire/JSON snippets that ARE the contract are allowed. Signatures and config interfaces are the contract — implement them verbatim.
>
> **Commit convention:** every commit message in this plan must end with the trailer:
> `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`
>
> **Authoritative contract:** `docs/API-CONTRACTS.md` is the single source of truth for **every endpoint, request/response shape, and error code** in this app. This plan implements its **§1 Auth & Session** and **§2 Conversations (incl. import)** sections (and creates the shared DTO module spec'd in its **§8**). Where this plan and `docs/API-CONTRACTS.md` ever disagree, the contract wins. All request validation and response typing in this plan come from the shared `@ollive/shared/api` module (Task 1.5 below) — **no ad-hoc redefinition of request/response shapes anywhere**: routes import the `*Schema` request validators and the response TS types from `@ollive/shared/api`, and the serializers return those exact types.

**Goal:** Extend the `apps/api` Express app that Plan 3 bootstrapped with the authentication + conversations layer: a JWT session (stateless httpOnly cookie), an `AuthProvider` abstraction with a Google OIDC implementation and a `dev`-mode bypass, the auth routes (`/auth/google`, `/auth/google/callback`, `/auth/logout`, `/auth/me`, `/v1/session`), a `requireAuth` middleware, a guest-session middleware + Redis-backed message-cap enforcement (the semi-public guest trial), a user repository (upsert-by-`google_sub` + idempotent demo-user seed), the user-scoped conversations CRUD router, and the buffered-guest-conversation `import` endpoint. Everything mounts into the existing `createApp({ db, redis, config })` factory at its documented extension point; conversation/message wire shapes are exactly those of `docs/API-CONTRACTS.md` §2 (typed by `@ollive/shared/api`) and every query is scoped to `req.user.id`. This plan also creates the shared `@ollive/shared/api` DTO module (Task 1.5) — the compiler-enforced contract surface consumed by Plans 4/5/6.

**Architecture:** This plan adds the API's *transactional* user-facing surface on top of Plan 3's primitives (typed config, pino, correlation id, `AppError`/`errorHandler`, shared `ioredis` client, the `createApp` factory + `// FUTURE (Plan 4/5)` mount point). Auth is stateless — a signed JWT carried in an httpOnly `session` cookie (no server-side session store, AU2/SE3/S5). The IdP sits behind an `AuthProvider` interface (PRD §15): `GoogleAuthProvider` does the real OIDC code-exchange, while `AUTH_MODE=dev` selects a `DevAuthProvider` whose callback returns a seeded demo identity so `docker compose up` works with no Google credentials (A5/AU4/S1). The OAuth CSRF-`state` is round-tripped through a short-lived signed cookie. The guest trial is enforced *server-side* (never client-trusted): a signed httpOnly `guest_session` cookie carries a random `guestSessionId`, and a Redis counter `guest:{id}:count` (TTL) caps messages at `GUEST_MESSAGE_LIMIT` (BE10/AU7/SE10); a simple in-memory IP limiter backs it up (SE9/S4). Conversations/messages persist synchronously via the existing `@ollive/db` Drizzle tables (`users`/`conversations`/`messages`), every read/write filtered by `user_id` (SE8), with wire shapes matching `docs/API-CONTRACTS.md` §2 exactly (typed by the shared `@ollive/shared/api` module). Import is idempotent on an optional client key via a **new nullable `conversations.client_conversation_id` column + partial-unique index** (a Plan-4 migration on `@ollive/db`, Task 8.5 below) — the conversation PK stays a random UUID — and leaves `title_source='default'` so Plan 5's auto-naming can run. Plan 5 (chat/metrics) imports the middleware + guest helpers this plan exports — those signatures are pinned below and must not drift. This plan also **owns `DEFAULT_MODEL`** in the API config (Task 1): it adds it to `loadConfig`/`AppConfig` (default `gemini-2.5-flash`) and uses it to stamp new conversations' `provider='google'`/`model`; Plan 5 only READS `config.defaultModel` and must NOT re-add it.

**Tech Stack:** TypeScript 5.7, pnpm workspaces, Vitest 3 (root workspace runner), Express 4 (`^4.21.0` — do **not** substitute Express 5) + supertest 7, `cookie-parser ^1.4.7`, `cors ^2.8.5`, **`jose ^5.9.0`** (JWT sign/verify — see Task 3 justification), **`google-auth-library ^9.15.0`** (Google OIDC code-exchange — see Task 4 justification), pino 9 + pino-http 10, ioredis 5, Zod 3, `@ollive/db` / `@ollive/shared` (workspace), `node:crypto` (`randomUUID`, `timingSafeEqual`, `createHmac`), tsx 4 (run TS as source — no build step). Postgres 16 + Redis 7 from Plan 1's `infra/docker-compose.yml` back the integration tests.

**Context:** The repo root is the existing git repository at `chatbot-ollive/`. Plans 1–3 are assumed implemented before this plan executes: `@ollive/shared` (enums + `inferenceLogSchema`), `@ollive/db` (`createDb`, `runMigrations`, `Db` type, and the `users`/`conversations`/`messages`/`inferenceLogs` Drizzle tables), and `apps/api` (Plan 3: `loadConfig`/`AppConfig`, `createLogger`, `createRedis`, `AppError`/`errorHandler`, `correlationId`, the `createApp({ db, redis, config }): Express` factory with a documented `// FUTURE (Plan 4/5)` router mount point before the 404 + `errorHandler`, the `/v1/logs` receiver, and the health routes). **Plan 1/3 conventions you MUST follow:** internal packages/apps are consumed as TS source via `exports` (no build step, run with `tsx`); tests run through the root `vitest.workspace.ts` (the `api` project is already registered — `testTimeout: 30000`, `fileParallelism: false`); Postgres integration tests read `process.env.DATABASE_URL ?? 'postgres://ollive:ollive@localhost:5432/ollive'` and `process.env.REDIS_URL ?? 'redis://localhost:6379'`, call `runMigrations` in `beforeAll`, and clean up in `afterAll`/`afterEach`. Dependency versions pin with caret ranges; if a range does not resolve, substitute the nearest working version of the **same major**. Reuse `AppError`/`errorHandler` — do not build a parallel error path. Dependencies are injected (DI), never imported as singletons.

References: PRD §3 (A5 AUTH_MODE, A11 guest trial, A12 naming), §5 (FR13/FR15/FR16, FR1/FR5/FR6/FR7), §7.1/§7.4 (flows), §8.1 (auth contracts), §8.2 (conversations contracts incl. import), §10 (DB schema), §12 (BE1/BE3/BE8/BE9/BE10/BE11), §15 (AU1–AU8 + `AuthProvider` interface), §20 (SE3/SE4/SE8/SE9/SE10), §25 (S1/S9).

> **Pinned cross-plan contracts (Plan 5 imports these EXACT shapes — do not invent variants):**
>
> ```ts
> // Augmented Express Request (declared once in src/types.ts, merged into express.Request)
> interface AuthUser { id: string; email: string; name?: string; avatarUrl?: string }
> interface GuestIdentity { id: string }
> // Request gains: req.user?: AuthUser; req.guest?: GuestIdentity; req.requestId?: string (Plan 3)
>
> // Auth middleware — verifies the JWT session cookie; sets req.user on success, throws AppError('unauthorized') on failure.
> function requireAuth(deps: AuthMiddlewareDeps): RequestHandler;
> interface AuthMiddlewareDeps { config: AppConfig; }   // reads config.jwtSecret + cookie name
>
> // Guest middleware — ensures a signed httpOnly guest_session cookie (random guestSessionId, TTL = GUEST_SESSION_TTL); sets req.guest.
> function guestSession(deps: GuestMiddlewareDeps): RequestHandler;
> interface GuestMiddlewareDeps { config: AppConfig; }
>
> // Guest counter — increment per guest message, cap at GUEST_MESSAGE_LIMIT; Plan 5 calls this on each guest turn.
> function checkAndIncrementGuest(
>   redis: Redis, guestId: string, limit: number, ttlSeconds: number,
> ): Promise<{ allowed: boolean; remaining: number }>;
>
> // Read-only variant used by GET /v1/session (does NOT increment).
> function readGuestRemaining(
>   redis: Redis, guestId: string, limit: number,
> ): Promise<{ remaining: number; limit: number }>;
> ```
>
> Redis key for the guest counter is **exactly** `guest:{guestSessionId}:count` (TTL `GUEST_SESSION_TTL`). The session-cookie name is **`session`**; the guest cookie is **`guest_session`**; the OAuth-state cookie is **`oauth_state`**. Conversation/message JSON shapes are **exactly** `docs/API-CONTRACTS.md` §2 — these shapes are the `Conversation` / `Message` / `ConversationDetail` / `ConversationSummary` / `ConversationListPage` **TS types exported from `@ollive/shared/api`** (Task 1.5); the serializers in `src/conversations/serialize.ts` produce those exact types and are reused by every conversations route (and importable by Plan 5). The pinned middleware/helper contracts above (`requireAuth → req.user`, `guestSession → req.guest`, `checkAndIncrementGuest`, `readGuestRemaining`) are **unchanged** and already match the contract; route handlers simply validate inbound requests with the shared `*Schema` Zod validators and type their responses with the shared response types. The `users`/`conversations`/`messages` tables are **exactly** `@ollive/db`'s Drizzle tables — import them, never redefine them (Task 8.5 adds one nullable column + index to `conversations`). The `createApp` factory signature is unchanged; new routers mount at the existing `// FUTURE (Plan 4/5)` point, BEFORE the 404 fallback + `errorHandler`.

---

## File Structure

```
packages/
  shared/
    package.json                      # EDIT: add `"./api": "./src/api/index.ts"` subpath export (Task 1.5)
    src/api/index.ts                  # NEW: re-export common/errors/auth/conversations/chat/metrics (Task 1.5)
    src/api/common.ts                 # NEW: ISOString, cursorSchema, Page<T>, usage re-export (Task 1.5)
    src/api/errors.ts                 # NEW: AppErrorCode / SseErrorCode unions + error-body types (Task 1.5)
    src/api/auth.ts                   # NEW: AuthUser/SessionUser/MeResponse/SessionResponse + oauthCallbackQuerySchema (Task 1.5)
    src/api/conversations.ts          # NEW: Conversation/Message DTOs + list/create/patch/import schemas (Task 1.5)
    src/api/chat.ts                   # NEW: chat/guest request schemas + SseEvent payload types (Task 1.5; consumed by Plan 5/6)
    src/api/metrics.ts                # NEW: metricsQuerySchema + overview/series response types (Task 1.5; consumed by Plan 5/6)
  db/
    src/schema.ts                     # EDIT: add nullable `client_conversation_id` column + partial-unique index to `conversations` (Task 8.5)
    drizzle/000X_*.sql                # NEW: drizzle-kit generated migration for the column + index (Task 8.5)
apps/
  api/
    package.json                      # EDIT: add jose, google-auth-library, cookie-parser, cors (+ @types)
    src/config.ts                     # EDIT: extend env schema + AppConfig with auth/guest/cors vars (conditional Google validation)
    src/types.ts                      # NEW: Express Request augmentation (req.user, req.guest) + AuthUser/GuestIdentity
    src/auth/jwt.ts                   # NEW: signSession/verifySession (jose) + session cookie set/clear helpers (AU2/SE3)
    src/auth/provider.ts              # NEW: AuthProvider interface + createAuthProvider(config) factory (AU1/AU4)
    src/auth/google-provider.ts       # NEW: GoogleAuthProvider — getAuthorizationUrl + handleCallback (OIDC) (AU1)
    src/auth/dev-provider.ts          # NEW: DevAuthProvider — returns the seeded demo identity (A5/AU4/S1)
    src/auth/state.ts                 # NEW: signState/verifyState — CSRF state round-trip via oauth_state cookie
    src/middleware/require-auth.ts    # NEW: requireAuth(deps) — pinned contract (AU3)
    src/middleware/guest-session.ts   # NEW: guestSession(deps) + signed-cookie helpers (AU7/BE10)
    src/middleware/rate-limit.ts      # NEW: ipRateLimit(opts) — simple in-memory fixed-window limiter (SE9/S4)
    src/guest/counter.ts              # NEW: checkAndIncrementGuest + readGuestRemaining (Redis counter, pinned) (BE10/AU7/SE10)
    src/users/repository.ts           # NEW: UserRepository — upsertByGoogleSub, findById, seedDemoUser (idempotent) (AU2/DE7)
    src/conversations/serialize.ts    # NEW: toConversationSummary / toConversation / toMessage / toConversationDetail (return @ollive/shared/api types; contract §2)
    src/conversations/repository.ts   # NEW: ConversationRepository — list/create/getWithMessages/patch/importConversation (user-scoped, SE8)
    src/conversations/validation.ts   # NEW: re-exports the shared @ollive/shared/api request schemas used by each route (BE3; no local redefinition)
    src/routes/auth.ts                # NEW: authRouter(deps) — /auth/google, /callback, /logout, /me, /v1/session
    src/routes/conversations.ts       # NEW: conversationsRouter(deps) — list/create/get/patch/import (mounted at /v1)
    src/app.ts                        # EDIT: cookie-parser + CORS + mount authRouter & conversationsRouter at the FUTURE point
    src/server.ts                     # EDIT: seed demo user on startup in dev mode (DE7); no other change
    test/config.test.ts               # EDIT: add cases for new auth/guest/cors vars + conditional Google validation
    test/jwt.test.ts                  # NEW: sign/verify round-trip, tamper rejection, expiry (unit)
    test/redactor... (unchanged)
    test/state.test.ts                # NEW: signState/verifyState round-trip + tamper rejection (unit)
    test/counter.int.test.ts          # NEW: checkAndIncrementGuest cap + TTL + readGuestRemaining (real Redis)
    test/users.int.test.ts            # NEW: upsertByGoogleSub idempotency + seedDemoUser idempotency (real Postgres)
    test/auth.int.test.ts             # NEW: supertest — dev-mode login flow, /auth/me, /v1/session, logout, mocked Google callback
    test/conversations.int.test.ts    # NEW: supertest — CRUD, user-scoping (404 cross-user), pagination, rename title_source, archive
    test/import.int.test.ts           # NEW: supertest — import persists + idempotency on clientConversationId
.env.example                          # EDIT: add JWT_SECRET, GOOGLE_*, AUTH_MODE, WEB_ORIGIN, GUEST_* vars
```

**Module responsibilities (single-responsibility, NFR8):** `auth/jwt` and `auth/state` are pure crypto seams (unit-tested in isolation). `auth/provider` + `google-provider` + `dev-provider` are the IdP strategy (Google mocked in tests; dev path real). `middleware/*` are thin DI factories returning `RequestHandler`s. `guest/counter` is a pure-ish Redis helper (the pinned Plan-5 contract). `users/repository` and `conversations/repository` own all DB access (repository pattern, user-scoped). `conversations/serialize` maps Drizzle rows to the `@ollive/shared/api` response types (`ConversationSummary`/`Conversation`/`Message`/`ConversationDetail`) so the contract §2 wire shape can never drift across routes. `routes/*` validate inbound requests with the shared `*Schema` Zod validators, then wire validation → repository → serializer → response and translate failures into `AppError`. `app.ts`/`server.ts` change minimally — only to mount the new middleware/routers and to seed in dev mode.

---

## Task 1: Config extension — auth/guest/CORS env vars + `DEFAULT_MODEL` + conditional Google validation (TDD)
**Implements:** A5/AU4 (`AUTH_MODE`), SE3 (`JWT_SECRET`), SE4 (`WEB_ORIGIN`), AU7/SE10 (`GUEST_MESSAGE_LIMIT`, `GUEST_SESSION_TTL`), AU1 (`GOOGLE_CLIENT_ID/SECRET`), A10 (`DEFAULT_MODEL`). Extends Plan 3's `loadConfig`/`AppConfig` — does NOT introduce a parallel config module.
> **`DEFAULT_MODEL` ownership (contract §0 / A10):** Plan 4 OWNS `DEFAULT_MODEL`. It is added to the env schema + `AppConfig` HERE and used to stamp new conversations' `provider='google'`/`model` (Tasks 10/11). **Plan 5 only READS `config.defaultModel` (guest chat uses it directly) and MUST NOT re-add it** to the config — there is exactly one definition.
**Files:**
- Edit: `apps/api/src/config.ts` — add fields to the Zod env schema + `AppConfig`; add conditional Google validation.
- Edit: `apps/api/test/config.test.ts` — add the cases below.
**Design:**
- **Signatures / types:** extend the existing interface (do not rename it):
  ```ts
  interface AppConfig {
    // ...Plan 3 fields (port, databaseUrl, redisUrl, ingestionApiKey, ingestionStreamMaxLen)...
    jwtSecret: string;
    authMode: 'dev' | 'google';
    googleClientId?: string;
    googleClientSecret?: string;
    googleRedirectUri: string;     // derived/explicit; default `${apiBaseUrl}/auth/google/callback`
    webOrigin: string;             // SE4 CORS allowlist + post-login redirect target
    guestMessageLimit: number;     // default 2
    guestSessionTtl: number;       // seconds; guest cookie + Redis counter TTL
    defaultModel: string;          // A10 — default 'gemini-2.5-flash'; new conversations use provider='google' + this model. Plan 5 READS this; never re-adds it.
    nodeEnv: 'development' | 'production' | 'test';  // drives Secure cookie flag
  }
  // loadConfig(env?: NodeJS.ProcessEnv): AppConfig  — signature unchanged
  ```
- **Algorithm:** add to the existing `envSchema`: `JWT_SECRET = z.string().min(1)`; `AUTH_MODE = z.enum(['dev','google']).default('dev')`; `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` as `z.string().optional()`; `WEB_ORIGIN = z.string().url().default('http://localhost:5173')`; `GUEST_MESSAGE_LIMIT = z.coerce.number().int().positive().default(2)`; `GUEST_SESSION_TTL = z.coerce.number().int().positive().default(86400)`; `DEFAULT_MODEL = z.string().min(1).default('gemini-2.5-flash')`; `NODE_ENV = z.enum([...]).default('development')`. After `safeParse`, apply a **conditional refinement**: when `AUTH_MODE === 'google'`, both `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` must be present/non-empty — otherwise throw the same one-error-lists-all-paths Error Plan 3 uses. Map into `AppConfig`; derive `googleRedirectUri` from an optional `API_BASE_URL` (default `http://localhost:${port}`) + `/auth/google/callback` unless `GOOGLE_REDIRECT_URI` is set explicitly.
- **Patterns / decisions / edge cases:** typed-config + fail-fast (Plan 3 convention). Conditional validation keeps `docker compose up` one-command in dev (Google creds optional) while making `AUTH_MODE=google` refuse to boot without them (A5/AU4). `webOrigin` is the single source for both CORS and the post-callback redirect. `nodeEnv` gates the `Secure` cookie attribute (SE3) so tests over plain HTTP still receive cookies.
**Test cases (write first, TDD):**
- Valid dev env (no Google creds) → `authMode === 'dev'`, defaults applied (`guestMessageLimit === 2`, `guestSessionTtl === 86400`, `webOrigin` default, `defaultModel === 'gemini-2.5-flash'`).
- `DEFAULT_MODEL='gemini-2.5-pro'` → `defaultModel === 'gemini-2.5-pro'` (override honored).
- `AUTH_MODE=google` WITHOUT `GOOGLE_CLIENT_ID`/`SECRET` → throws; message mentions `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
- `AUTH_MODE=google` WITH both Google vars → parses; `googleClientId`/`googleClientSecret` mapped through; `googleRedirectUri` ends with `/auth/google/callback`.
- Missing `JWT_SECRET` → throws, message mentions `JWT_SECRET`.
- `GUEST_MESSAGE_LIMIT='5'` and `GUEST_SESSION_TTL='3600'` coerced to numbers `5`/`3600`.
- Invalid `WEB_ORIGIN` (`'not-a-url'`) → throws, message mentions `WEB_ORIGIN`.
**Done when:** `config` tests green + `pnpm --filter @ollive/api exec tsc --noEmit` clean (run `pnpm install` after editing `package.json` in Task 2 if ordering requires; config-only deps are stdlib). commit: `feat(api): extend config with auth, guest, and CORS env vars`.

---

## Task 1.5: Create the `@ollive/shared/api` DTO module — the contract surface for Plans 4/5/6 (TDD)
**Implements:** `docs/API-CONTRACTS.md` **§8 (`@ollive/shared/api` module spec)** — the single canonical typed representation of every HTTP/SSE shape. Plan 4 is the first API plan, so it creates the **whole** module (Plans 5 and 6 only import from it; they do NOT add to it for their own endpoints unless a future shape is genuinely new). **No Express dependency — this task can run FIRST**, before/parallel to Task 1.
**Files:**
- Edit: `packages/shared/package.json` — add the `./api` subpath to `exports`: `"exports": { ".": "./src/index.ts", "./api": "./src/api/index.ts" }`. This is REQUIRED — a package `exports` map blocks undeclared subpaths, so without it `import … from '@ollive/shared/api'` will not resolve. Do NOT re-export the api module from the root `src/index.ts`; `@ollive/shared/api` is the single canonical import path for API DTOs (root stays enums/log/streams).
- Create: `packages/shared/src/api/index.ts` — `export *` from `./common`, `./errors`, `./auth`, `./conversations`, `./chat`, `./metrics`.
- Create: `packages/shared/src/api/common.ts`, `errors.ts`, `auth.ts`, `conversations.ts`, `chat.ts`, `metrics.ts`.
- Test: `packages/shared/test/api.test.ts` (or per-file tests) — schemas parse valid / reject invalid; types compile.
**Design:** Author each file **exactly per the module spec in `docs/API-CONTRACTS.md` §8** (that section IS the contract; the schema/type *names and field shapes* below are authoritative — keep design-level, declaring schema fields and type members but no logic beyond the field declarations / `.refine` predicates already specified there). Conventions (matching the existing package): **Zod 3**, TS source consumed directly (no build step), `z.infer` for request types. Request bodies/queries are `*Schema` Zod values; responses are TS types.
- **`common.ts`** — `type ISOString = string` (ISO-8601 UTC brand); re-export `usageSchema` + `type Usage` from `../log`; `const cursorSchema = z.string().min(1)` (opaque keyset cursor = last item's id); `interface Page<T> { items: T[]; nextCursor: string | null }` (note: `nextCursor` always present, `null` on last page).
- **`errors.ts`** — `const appErrorCode = z.enum(['validation_error','unauthorized','login_required','not_found','rate_limited','internal_error'])` + `type AppErrorCode`; `const sseErrorCode = z.enum(['rate_limited','provider_timeout','provider_error','internal_error'])` + `type SseErrorCode`; `interface ApiErrorBody { error: AppErrorCode; details?: unknown }`; `interface LoginRequiredBody { error: 'login_required'; remaining: number }` (the one HTTP error carrying an extra field). This is the **canonical error catalog** (contract §7) — Plan 4's `rate_limited`(429, IP limiter) and every other code reference this enum rather than inventing shapes; the HTTP error body is `{ error: <code>, details? }`.
- **`auth.ts`** — `interface AuthUser { id; email; name?; avatarUrl? }` (full profile, `GET /auth/me`); `interface SessionUser { id; email; name? }` (slim, no `avatarUrl`, echoed in `/v1/session`); `interface MeResponse { user: AuthUser }`; `type SessionResponse = { authenticated: false; guest: { remaining: number; limit: number } } | { authenticated: true; user: SessionUser }` (discriminated union; never 401); `const oauthCallbackQuerySchema = z.object({ code: z.string().min(1), state: z.string().min(1) })` + `type OauthCallbackQuery`.
- **`conversations.ts`** — Response DTOs: `interface ConversationSummary { id; title; status:'active'|'archived'; provider; model; createdAt:ISOString; updatedAt:ISOString }` (**NO `messages`, NO `title_source`**); `type Conversation = ConversationSummary` (POST/PATCH header); `interface Message { id; role:'user'|'assistant'|'system'; content; tokenCount?:number; status:'complete'|'partial'|'error'; sequence:number; createdAt:ISOString }` (`tokenCount` **omitted** for user msgs / when unknown — distinct from `0`); `interface ConversationDetail extends Conversation { messages: Message[] }`; `type ConversationListPage = Page<ConversationSummary>`. Request schemas: `listConversationsQuerySchema = z.object({ status: conversationStatus.default('active'), limit: z.coerce.number().int().min(1).max(100).default(20), cursor: z.string().min(1).optional() })`; `createConversationSchema = z.object({ title: z.string().min(1).optional() })`; `patchConversationSchema = z.object({ title: z.string().min(1).optional(), status: conversationStatus.optional() }).refine(at-least-one-of-title-or-status)`; `importMessageSchema = z.object({ role: z.enum(['user','assistant']), content: z.string().min(1) })`; `importConversationSchema = z.object({ clientConversationId: z.string().min(1).max(200).optional(), messages: z.array(importMessageSchema).min(1) })`. Reuse `conversationStatus`/`messageRole`/`messageStatus` from `../enums`. Export the `z.infer` request types (`ListConversationsQuery`, `CreateConversationBody`, `PatchConversationBody`, `ImportConversationBody`).
- **`chat.ts`** (consumed by Plan 5/6 — created here so the module is complete) — `chatMessageSchema = z.object({ content: z.string().min(1) })`; `guestTurnSchema = z.object({ role: z.enum(['user','assistant']), content: z.string() })`; `guestMessageSchema = z.object({ messages: z.array(guestTurnSchema).max(50), content: z.string().min(1) })`; SSE payload types `SseStartData { messageId: string|null; requestId: string }`, `SseTokenData { delta: string }`, `SseDoneData { messageId: string|null; finishReason: string; usage: Usage }` (usage **always present**), `SseErrorData { code: 'rate_limited'|'provider_timeout'|'provider_error'|'internal_error'; message: string }`, and the discriminated `SseEvent` union over `start|token|done|error`. Export the `z.infer` request types (`ChatMessageBody`, `GuestMessageBody`).
- **`metrics.ts`** (consumed by Plan 5/6) — `metricsBucket = z.enum(['1m','5m','1h','1d'])`; `metricsQuerySchema = z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional(), provider: z.string().min(1).optional(), model: z.string().min(1).optional(), bucket: metricsBucket.default('1m') }).refine(from <= to)`; response types `MetricsRange`, `OverviewMetrics`, point types `LatencyPoint`/`ThroughputPoint { t; count }`/`ErrorPoint { t; count; errorCount; errorRate }`/`TokenPoint { t; promptTokens; completionTokens; totalTokens }`, the generic `MetricsSeries<P> { bucket: MetricsBucket; series: P[] }`, and the `LatencySeries`/`ThroughputSeries`/`ErrorSeries`/`TokenSeries` aliases.
- **Patterns / decisions / edge cases:** the module follows the existing `@ollive/shared` conventions (no build step, `export *` from index). Requests are **runtime-validated** (Zod) server-side (BE3); responses are **compile-time** TS contracts (the server produces them, the frontend types its client with them — NFR7). Reuse `usageSchema`/`Usage` from `log.ts` (do not redefine token usage) and the enums from `enums.ts`. This task is decoupled from Express so it can land first; Tasks 9–11 then `import` the conversation schemas/types from here rather than defining their own.
**Test cases (write first, TDD):**
- `listConversationsQuerySchema` parses `{}` → defaults (`status='active'`, `limit=20`); coerces `limit='50'`→`50`; **rejects** `limit=101` and `limit=0` and a bad `status`.
- `createConversationSchema` accepts `{}` and `{ title:'x' }`; rejects `{ title:'' }`.
- `patchConversationSchema` accepts `{ title }`, `{ status }`, both; **rejects `{}`** (the at-least-one refinement) and a bad `status` enum.
- `importConversationSchema` accepts a 1+-message array with `user`/`assistant` roles; **rejects** empty `messages`, a `system` role, empty `content`, and a `clientConversationId` over 200 chars.
- `chatMessageSchema` rejects empty `content`; `guestMessageSchema` accepts history + `content` and rejects empty `content`.
- `metricsQuerySchema` defaults `bucket='1m'`, coerces `from`/`to` to dates, and **rejects `from > to`**.
- Type-level: a sample `ConversationDetail`/`OverviewMetrics`/`SseEvent` literal compiles; `tsc --noEmit` clean across `@ollive/shared`.
**Done when:** `pnpm --filter @ollive/shared exec vitest run` (the new api schema tests) green + `pnpm --filter @ollive/shared exec tsc --noEmit` clean; `import { listConversationsQuerySchema, type ConversationDetail } from '@ollive/shared/api'` resolves. commit: `feat(shared): add @ollive/shared/api DTO module (HTTP + SSE contract types)`.

---

## Task 2: Add deps + Request augmentation + cookie-parser & CORS wiring (BE8, SE4)
**Implements:** SE4 (CORS locked to `WEB_ORIGIN` with credentials), cookie parsing for all subsequent tasks, and the `req.user`/`req.guest` typings every later task relies on. Wiring + types — exercised by Tasks 9–11 supertest suites, so this task ends with a typecheck.
**Files:**
- Edit: `apps/api/package.json` — add deps `jose ^5.9.0`, `google-auth-library ^9.15.0`, `cookie-parser ^1.4.7`, `cors ^2.8.5`; dev deps `@types/cookie-parser ^1.4.8`, `@types/cors ^2.8.17`.
- Create: `apps/api/src/types.ts` — Express `Request` augmentation.
- Edit: `apps/api/src/app.ts` — mount `cookieParser()` and `cors(...)` early; leave the `// FUTURE (Plan 4/5)` mount point for Tasks 9–11.
**Design:**
- **Signatures / types:**
  ```ts
  // src/types.ts — module augmentation (no runtime export)
  export interface AuthUser { id: string; email: string; name?: string; avatarUrl?: string }
  export interface GuestIdentity { id: string }
  declare global {
    namespace Express {
      interface Request {
        user?: AuthUser;
        guest?: GuestIdentity;
        // requestId?: string already declared by Plan 3's correlation middleware
      }
    }
  }
  ```
- **Algorithm (app.ts edits):** import the augmentation for its side effect. After `correlationId()` + `pinoHttp(...)` and BEFORE `express.json(...)`: mount `cookieParser()` (no secret arg — this plan signs cookies itself with HMAC via the jwt/guest helpers, so signing is explicit and testable). Mount `cors({ origin: config.webOrigin, credentials: true, methods: ['GET','POST','PATCH','DELETE'], allowedHeaders: ['content-type'] })`. Order stays: `correlationId` → `pinoHttp` → `cookieParser` → `cors` → `express.json({ limit: '1mb' })` → healthRouter → logsRouter(`/v1`) → **FUTURE mount point (Tasks 9–11 add authRouter + conversationsRouter here)** → 404 → `errorHandler` LAST.
- **Patterns / decisions / edge cases:** CORS `credentials: true` + an explicit single `origin` (never `*`) is required for the cookie to be sent cross-origin (SE4). We do NOT pass a secret to `cookie-parser`; instead each cookie family (`session`, `guest_session`, `oauth_state`) carries its own HMAC/JWT signature so verification lives next to issuance and is unit-testable. Augmentation is global so Plan 5 inherits `req.user`/`req.guest` for free.
**Test cases (write first, TDD):** none in isolation — CORS headers + cookie round-trips are asserted by Tasks 9–11 (e.g. preflight `Access-Control-Allow-Origin` echoes `WEB_ORIGIN`; `Set-Cookie` present on login).
**Done when:** `pnpm install` resolves the new deps; `pnpm --filter @ollive/api exec tsc --noEmit` clean. commit: `feat(api): add auth deps, request augmentation, cookie-parser and CORS`.

---

## Task 3: JWT session helpers — sign/verify + cookie set/clear (AU2, SE3) (TDD)
**Implements:** AU2 (stateless signed JWT, no session store) + SE3 (httpOnly + SameSite=Lax + Secure-in-prod cookie). Pure crypto + cookie helpers → unit-tested, no network/DB.
**Files:**
- Create: `apps/api/src/auth/jwt.ts`.
- Test: `apps/api/test/jwt.test.ts`.
**Design:**
- **Signatures / types:**
  ```ts
  interface SessionClaims { sub: string; email: string; name?: string; avatarUrl?: string }
  const SESSION_COOKIE = 'session';
  function signSession(claims: SessionClaims, secret: string, ttlSeconds?: number): Promise<string>; // default ttl ~7d
  function verifySession(token: string, secret: string): Promise<SessionClaims>;                      // throws on bad/expired
  function setSessionCookie(res: Response, token: string, opts: { secure: boolean; maxAgeSeconds?: number }): void;
  function clearSessionCookie(res: Response, opts: { secure: boolean }): void;
  function sessionClaimsToUser(claims: SessionClaims): AuthUser; // { id: sub, email, name?, avatarUrl? }
  ```
- **Algorithm:** use **jose** `SignJWT` — HS256 over `new TextEncoder().encode(secret)`, set `iat`/`exp` (`exp = now + ttlSeconds`, default 7 days), payload = the claim fields. `verifySession` uses `jwtVerify`; on signature mismatch, malformed token, or expiry it rejects — callers translate that to `AppError('unauthorized')`. `setSessionCookie` writes cookie `session` with `httpOnly: true`, `sameSite: 'lax'`, `secure: opts.secure`, `path: '/'`, `maxAge` in ms. `clearSessionCookie` sets the same cookie to empty with `maxAge: 0` (matching attributes so the browser clears it). `sessionClaimsToUser` maps `sub → id`.
- **Patterns / decisions / edge cases:** **Library choice — `jose`.** It is dependency-light, actively maintained, native ESM (matches the repo's `"type": "module"` + Bundler resolution), promise-based, and works identically in Node and edge runtimes — a better fit than `jsonwebtoken` (CJS, callback-style, heavier). HS256 (symmetric) is correct for a single-service signer (SE3). Stateless: no DB/Redis read on verify (AU2, scalability §19). `Secure` is driven by `nodeEnv === 'production'` so HTTP tests still get the cookie (A9). SameSite=Lax allows the top-level OAuth redirect to carry the cookie while blocking CSRF on cross-site POSTs.
**Test cases (write first, TDD):**
- Round-trip: `signSession(claims, secret)` → `verifySession(token, secret)` returns the same `sub`/`email`/`name`.
- Wrong secret → `verifySession` rejects.
- Tampered token (flip a payload char) → rejects.
- Expired token (`ttlSeconds: -1` or a clock past `exp`) → rejects.
- `setSessionCookie(res, token, { secure: false })` → a `Set-Cookie` for `session` with `HttpOnly`, `SameSite=Lax`, no `Secure`; with `{ secure: true }` → includes `Secure`.
- `clearSessionCookie` → `Set-Cookie` for `session` with `Max-Age=0`.
- `sessionClaimsToUser({ sub: 'u1', email: 'e' })` → `{ id: 'u1', email: 'e' }`.
**Done when:** `jwt` tests green + `tsc --noEmit` clean. commit: `feat(api): add JWT session sign/verify and cookie helpers`.

---

## Task 4: AuthProvider abstraction + Google + dev providers + state CSRF helper (AU1, AU4, A5/S1) (TDD)
**Implements:** AU1 (`AuthProvider` interface so IdPs are swappable), AU4/A5/S1 (`AUTH_MODE` selects Google vs dev), the OIDC code-exchange (Google), and the CSRF-`state` round-trip. Google network is never hit in tests (the provider is injected/mocked in Task 9); `signState`/`verifyState` are pure → unit-tested here.
**Files:**
- Create: `apps/api/src/auth/provider.ts` — interface + `createAuthProvider(config)` factory.
- Create: `apps/api/src/auth/google-provider.ts` — `GoogleAuthProvider`.
- Create: `apps/api/src/auth/dev-provider.ts` — `DevAuthProvider`.
- Create: `apps/api/src/auth/state.ts` — `signState`/`verifyState`.
- Test: `apps/api/test/state.test.ts`.
**Design:**
- **Signatures / types:** (PRD §15 interface — author verbatim)
  ```ts
  interface AuthIdentity { sub: string; email: string; name?: string; avatarUrl?: string }
  interface AuthProvider {
    name: string;                                  // 'google' | 'dev'
    getAuthorizationUrl(state: string): string;    // redirect target for GET /auth/google
    handleCallback(code: string): Promise<AuthIdentity>;
  }
  function createAuthProvider(config: AppConfig): AuthProvider; // 'google' → GoogleAuthProvider, else DevAuthProvider

  // google-provider.ts
  class GoogleAuthProvider implements AuthProvider {
    constructor(opts: { clientId: string; clientSecret: string; redirectUri: string });
    // name = 'google'
  }
  // dev-provider.ts
  class DevAuthProvider implements AuthProvider {
    constructor(opts?: { demoEmail?: string; demoName?: string }); // name = 'dev'
  }

  // state.ts (HMAC-signed, time-bounded CSRF token; carried in the oauth_state cookie)
  function signState(secret: string, ttlSeconds?: number): { state: string };   // default ttl ~10min
  function verifyState(state: string, secret: string): boolean;                  // false on tamper/expiry/mismatch
  ```
- **Algorithm:**
  - `GoogleAuthProvider.getAuthorizationUrl(state)`: build the Google OAuth 2.0 consent URL via `google-auth-library`'s `OAuth2Client.generateAuthUrl({ scope: ['openid','email','profile'], state, access_type: 'offline', prompt: 'consent' })` (or the equivalent authorize endpoint with `response_type=code`).
  - `GoogleAuthProvider.handleCallback(code)`: `OAuth2Client.getToken(code)` → obtain the `id_token`; `verifyIdToken({ idToken, audience: clientId })` → read `sub`, `email`, `name`, `picture`; return `{ sub, email, name, avatarUrl: picture }`. Any failure throws (the route maps it to `AppError('unauthorized')` and redirects to sign-in with an error flag).
  - `DevAuthProvider.handleCallback`: ignore `code`; return a fixed demo identity `{ sub: 'dev-google-sub', email: demoEmail ?? 'demo@ollive.local', name: demoName ?? 'Demo User' }`. `getAuthorizationUrl(state)` returns the API's own callback URL with `?code=dev&state=<state>` so even the redirect path stays exercisable in dev without Google.
  - `createAuthProvider(config)`: `config.authMode === 'google'` → `new GoogleAuthProvider({ clientId, clientSecret, redirectUri })` (creds guaranteed present by Task 1's conditional validation); else `new DevAuthProvider()`.
  - `signState(secret, ttl)`: `state = base64url(JSON({ nonce: randomUUID(), exp: now+ttl }))` + `.` + `HMAC-SHA256(payload, secret)` (via `node:crypto.createHmac`). `verifyState`: split, recompute HMAC, compare with `timingSafeEqual`, and reject if `exp` is past.
  - **Library choice — `google-auth-library`.** It is Google's official OAuth2/OIDC client: it owns the token endpoint, `id_token` signature/issuer/audience verification, and Google's JWKS rotation. Using it (over hand-rolling endpoints or pulling in the heavier generic `openid-client`) means we never re-implement OIDC validation, and the IdP detail stays fully behind our `AuthProvider` seam (AU1) so swapping IdPs touches only one file.
- **Patterns / decisions / edge cases:** Strategy pattern (`AuthProvider`) + factory (`createAuthProvider`) — route logic depends only on the interface (AU1). Dev provider keeps `docker compose up` credential-free (A5/AU4/S1) and keeps the full redirect/callback code path testable. CSRF-`state` is HMAC-signed + time-bounded and verified against the `oauth_state` cookie set in `GET /auth/google` (defends the OAuth flow). `timingSafeEqual` avoids signature-comparison timing leaks.
**Test cases (write first, TDD — state only; providers are covered in Task 9):**
- `signState` then `verifyState` with the same secret → `true`.
- `verifyState` with a different secret → `false`.
- Tampered state (mutate payload, keep signature) → `false`.
- Expired state (`ttlSeconds: -1`) → `false`.
- Two `signState` calls → distinct `state` values (nonce differs).
**Done when:** `state` tests green + `tsc --noEmit` clean (compiles `GoogleAuthProvider` against the installed `google-auth-library`). commit: `feat(api): add AuthProvider abstraction, Google + dev providers, CSRF state`.

---

## Task 5: `requireAuth` middleware (AU3, pinned contract)
**Implements:** AU3 — verify the session cookie on protected routes; set `req.user` or throw `AppError('unauthorized')`. The pinned contract Plan 5's chat/metrics routers import. Exercised by Tasks 9–11 supertest suites, so this task ends with a typecheck.
**Files:**
- Create: `apps/api/src/middleware/require-auth.ts`.
**Design:**
- **Signatures / types:**
  ```ts
  interface AuthMiddlewareDeps { config: AppConfig; }
  function requireAuth(deps: AuthMiddlewareDeps): RequestHandler;
  ```
- **Algorithm:** read `req.cookies['session']`; if absent → `next(new AppError('unauthorized', 'authentication required'))`. Else `await verifySession(token, config.jwtSecret)` inside try/catch; on success set `req.user = sessionClaimsToUser(claims)` and `next()`; on any verify error → `next(new AppError('unauthorized', ...))`. Never reads DB (stateless, AU2).
- **Patterns / decisions / edge cases:** middleware factory + DI (config injected, no singleton). Reuses `verifySession` (Task 3) — single verification path. Throws via the central `errorHandler` so the `{ error: 'unauthorized' }` shape (HTTP 401) is consistent (§18). Async handler errors are forwarded with `next(err)` (Express 4 does not auto-catch async throws).
**Test cases (write first, TDD):** none in isolation — covered by Tasks 9 (`/auth/me` 200 vs 401) and 10/11 (conversations require auth → 401 without cookie).
**Done when:** `pnpm --filter @ollive/api exec tsc --noEmit` clean. commit: `feat(api): add requireAuth session middleware`.

---

## Task 6: Guest counter (Redis) + readonly variant (BE10/AU7/SE10, pinned contract) (TDD)
**Implements:** the server-side guest message cap — `checkAndIncrementGuest` (increment + cap) and `readGuestRemaining` (read-only, for `/v1/session`). Redis key `guest:{guestSessionId}:count` with TTL = `GUEST_SESSION_TTL`. Plan 5 calls `checkAndIncrementGuest` per guest turn. Integration-tested against real Redis.
**Files:**
- Create: `apps/api/src/guest/counter.ts`.
- Test: `apps/api/test/counter.int.test.ts`.
**Design:**
- **Signatures / types:** (pinned — author verbatim)
  ```ts
  function checkAndIncrementGuest(
    redis: Redis, guestId: string, limit: number, ttlSeconds: number,
  ): Promise<{ allowed: boolean; remaining: number }>;
  function readGuestRemaining(
    redis: Redis, guestId: string, limit: number,
  ): Promise<{ remaining: number; limit: number }>;
  const guestKey = (guestId: string) => `guest:${guestId}:count`;
  ```
- **Algorithm:**
  - `checkAndIncrementGuest`: `const n = await redis.incr(key)`; if `n === 1` set TTL (`redis.expire(key, ttlSeconds)`) so the window starts on first use; `allowed = n <= limit`; `remaining = Math.max(0, limit - n)`. **Edge:** because `INCR` already consumed a slot, when `n > limit` we have over-counted by the rejected attempt — that is acceptable (the cap is a friction trial, S9) and keeps the operation a single atomic `INCR` (no read-modify-write race). `remaining` is clamped at 0.
  - `readGuestRemaining`: `const raw = await redis.get(key)`; `used = raw ? Number(raw) : 0`; `remaining = Math.max(0, limit - used)`; return `{ remaining, limit }`. Never mutates (so polling `/v1/session` doesn't burn the trial).
- **Patterns / decisions / edge cases:** atomic `INCR` is the canonical server-side counter (SE10 — never client-trusted). TTL set only on first increment (key absent → `INCR` returns 1) gives a sliding-from-first-use window matching the guest cookie TTL. Read-only variant is deliberately separate so `GET /v1/session` reports remaining without spending it. Resettable by clearing cookies — acceptable for a trial (S9). Guard `remaining` against negatives.
**Test cases (write first, TDD — real Redis, unique guestId per test, `afterEach` deletes the key):**
- First `checkAndIncrementGuest(redis, id, 2, ttl)` → `{ allowed: true, remaining: 1 }`; key TTL is set (`> 0`).
- Second call → `{ allowed: true, remaining: 0 }`.
- Third call (over the cap) → `{ allowed: false, remaining: 0 }`.
- `readGuestRemaining` after two increments → `{ remaining: 0, limit: 2 }`; after zero increments → `{ remaining: 2, limit: 2 }` and does NOT create/mutate the key.
- TTL: the key has a positive expiry close to `ttlSeconds` after the first increment.
**Done when:** `counter` tests green against real Redis + `tsc --noEmit` clean. commit: `feat(api): add Redis-backed guest message counter and readonly variant`.

---

## Task 7: Guest session middleware + in-memory IP rate limiter (AU7/BE10, SE9/S4)
**Implements:** `guestSession(deps)` — ensure a signed httpOnly `guest_session` cookie (random `guestSessionId`, TTL = `GUEST_SESSION_TTL`), set `req.guest` (pinned contract); plus `ipRateLimit(opts)` — a simple in-memory fixed-window limiter as the abuse backstop (SE9/S4). Exercised by the auth/session supertest suite (Task 9) and reused by Plan 5's guest chat; ends with a typecheck.
**Files:**
- Create: `apps/api/src/middleware/guest-session.ts` — `guestSession` + signed-cookie helpers.
- Create: `apps/api/src/middleware/rate-limit.ts` — `ipRateLimit`.
**Design:**
- **Signatures / types:**
  ```ts
  interface GuestMiddlewareDeps { config: AppConfig; }
  const GUEST_COOKIE = 'guest_session';
  function guestSession(deps: GuestMiddlewareDeps): RequestHandler;          // sets req.guest = { id }
  function signGuestId(guestId: string, secret: string): string;             // `${id}.${HMAC}` (HMAC-SHA256)
  function verifyGuestCookie(value: string, secret: string): string | null;  // returns guestId or null on tamper

  interface RateLimitOptions { windowMs: number; max: number; keyFn?: (req: Request) => string; }
  function ipRateLimit(opts: RateLimitOptions): RequestHandler;              // 429 -> AppError on overflow
  ```
- **Algorithm:**
  - `guestSession`: read `req.cookies['guest_session']`; if present, `verifyGuestCookie` → on valid signature use that `guestId`; if absent/tampered, `guestId = randomUUID()` and re-issue. Set `req.guest = { id: guestId }`. When (re)issuing, `res.cookie('guest_session', signGuestId(guestId, config.jwtSecret), { httpOnly: true, sameSite: 'lax', secure: config.nodeEnv==='production', path: '/', maxAge: config.guestSessionTtl*1000 })`. (Reuse `JWT_SECRET` as the HMAC key — a single secret to manage; the value is not a JWT, just a signed id.)
  - `signGuestId` / `verifyGuestCookie`: HMAC-SHA256 over the id; verify with `timingSafeEqual`; reject if the id is not a valid UUID shape or the MAC mismatches.
  - `ipRateLimit`: a module-level `Map<key, { count: number; resetAt: number }>`. Per request: `key = keyFn?.(req) ?? (req.ip ?? 'unknown')`; if `now > entry.resetAt` reset the window (`count=0`, `resetAt=now+windowMs`); `count++`; if `count > max` the limiter responds directly `res.status(429).json({ error: 'rate_limited' })` and returns (does NOT call `next()`); otherwise `next()`. Bound the map by lazily pruning entries whose `resetAt < now` on access (and dropping expired entries when the map grows past a soft cap).
- **Patterns / decisions / edge cases:** middleware factories + DI. The guest cookie is signed (HMAC) so a client cannot forge another guest's id to dodge the cap; a tampered/absent cookie yields a fresh guest (acceptable — S9). The in-memory limiter is intentionally simple (single-process, demo scale — SE9/S4); a distributed limiter is the documented next step. **Error-shape decision (contract §7 catalog):** `rate_limited` (429) is part of the canonical `AppErrorCode` catalog (defined in `@ollive/shared/api` `errors.ts`, Task 1.5), but the contract notes it is **emitted by the in-memory IP limiter as a direct `{ error: 'rate_limited' }` (429) body, outside the typed `AppError` path** — so `ipRateLimit` writes that JSON directly (`res.status(429).json({ error: 'rate_limited' })`) and returns, rather than throwing an `AppError` through the central handler. The body still matches the catalog's `{ error: <code> }` shape (no `details`). (Plan 3's `AppError` `ErrorCode` union is left untouched; `rate_limited` lives in the shared catalog used for typing/client-side normalization.) Reuse `JWT_SECRET` for guest-cookie HMAC to avoid a second secret.
**Test cases (write first, TDD):** none in isolation — `guest_session` issuance + signature and the limiter are asserted via Task 9 (`GET /v1/session` sets `guest_session`; replaying the cookie keeps the same `guestSessionId`; a forged cookie is rejected and re-issued). A small optional unit test for `signGuestId`/`verifyGuestCookie` round-trip + tamper is encouraged for TDD parity.
**Done when:** `pnpm --filter @ollive/api exec tsc --noEmit` clean. commit: `feat(api): add guest session middleware and in-memory IP rate limiter`.

---

## Task 8: User repository — upsert-by-google_sub + idempotent demo seed (AU2, DE7) (TDD)
**Implements:** AU2 (upsert the user by `google_sub` on login) and DE7 (idempotently seed the demo user for dev mode). All DB access for users lives here (repository pattern). Integration-tested against real Postgres.
**Files:**
- Create: `apps/api/src/users/repository.ts`.
- Test: `apps/api/test/users.int.test.ts`.
**Design:**
- **Signatures / types:**
  ```ts
  interface UpsertUserInput { googleSub: string; email: string; name?: string; avatarUrl?: string }
  interface UserRepository {
    upsertByGoogleSub(input: UpsertUserInput): Promise<AuthUser>;  // insert-or-update on google_sub conflict; bumps last_login_at
    findById(id: string): Promise<AuthUser | null>;
    seedDemoUser(): Promise<AuthUser>;                             // idempotent; the DevAuthProvider identity
  }
  function createUserRepository(db: Db): UserRepository;
  ```
- **Algorithm:**
  - `upsertByGoogleSub`: `db.insert(users).values({ googleSub, email, name, avatarUrl, lastLoginAt: now }).onConflictDoUpdate({ target: users.googleSub, set: { email, name, avatarUrl, lastLoginAt: now } }).returning()`; map the row → `AuthUser` (`id`, `email`, `name ?? undefined`, `avatarUrl ?? undefined`).
  - `findById`: select by `users.id`; return `AuthUser | null`.
  - `seedDemoUser`: call `upsertByGoogleSub({ googleSub: 'dev-google-sub', email: 'demo@ollive.local', name: 'Demo User' })` — the same fixed identity `DevAuthProvider` returns, so dev login and the seed converge on one row. Idempotent by construction (conflict target `google_sub`).
- **Patterns / decisions / edge cases:** repository pattern centralizes user SQL (parameterized via Drizzle — SE5). Upsert keyed on the UNIQUE `google_sub` (PRD §10) handles repeat logins without duplicates and refreshes profile fields + `last_login_at`. The seed reuses the same upsert so re-running `server.ts` in dev is safe (DE7). `email` is also UNIQUE — a `google_sub` conflict updates the existing row; a brand-new sub with a colliding email would surface a DB error (acceptable: real Google emails are unique per account).
**Test cases (write first, TDD — real Postgres, `runMigrations` in `beforeAll`, truncate `users` in `afterEach`):**
- `upsertByGoogleSub` first call → inserts; returns `AuthUser` with a uuid `id`, matching `email`/`name`.
- `upsertByGoogleSub` again with the same `googleSub` but a changed `name` → returns the SAME `id`; `name` is updated (exactly one row in `users`).
- `findById(returnedId)` → the same `AuthUser`; `findById('<random uuid>')` → `null`.
- `seedDemoUser` twice → same `id` both times; exactly one demo row (idempotent).
**Done when:** `users` tests green against real Postgres + `tsc --noEmit` clean. commit: `feat(api): add user repository with upsert-by-google_sub and idempotent demo seed`.

---

## Task 8.5: `@ollive/db` migration — `conversations.client_conversation_id` column + partial-unique index (contract §2 RESOLUTION 7) (TDD)
**Implements:** the import-idempotency storage that the contract mandates (`docs/API-CONTRACTS.md` §2 import note): a **new nullable `client_conversation_id TEXT` column** on `conversations` plus a **partial-unique index on `(user_id, client_conversation_id) WHERE client_conversation_id IS NOT NULL`**. This **supersedes** the plan's former "UUIDv5-derived primary key" idempotency approach — the conversation PK stays a random UUID; dedup lives in this column. Task 11 (`importConversation`) depends on this.
**Files:**
- Edit: `packages/db/src/schema.ts` — add the column + partial-unique index to the existing `conversations` `pgTable` (do NOT touch its `id`/PK).
- Create (generated): `packages/db/drizzle/000X_*.sql` (+ updated `meta/_journal.json` / snapshot) via `pnpm --filter @ollive/db generate`.
- Test: extend a `@ollive/db` migration/schema test (or `apps/api/test/import.int.test.ts` setup) to assert the column + partial index exist after `runMigrations`.
**Design:**
- **Schema change (Drizzle):** add to the `conversations` table definition:
  ```ts
  // column
  clientConversationId: text('client_conversation_id'),   // nullable
  // in the table's index/constraint array:
  uniqueIndex('uq_conv_user_client_convo')
    .on(t.userId, t.clientConversationId)
    .where(sql`${t.clientConversationId} is not null`),   // PARTIAL unique
  ```
  Leave `id: uuid('id').primaryKey().defaultRandom()` unchanged — the PK is a random UUID; idempotency is the `(user_id, client_conversation_id)` partial-unique pair, not a derived/hashed PK.
- **Migration generation:** run drizzle-kit (`generate` script) to emit the new SQL migration; commit the generated file + the updated `meta/` journal/snapshot. The migration must add a `client_conversation_id text` column and the partial unique index `... WHERE client_conversation_id IS NOT NULL`. Run with the existing `runMigrations` path (no new migrate code).
- **Patterns / decisions / edge cases:** nullable column means rows without a client key are exempt from the unique constraint (multiple `NULL`s allowed) — exactly the "import without `clientConversationId` always creates a fresh conversation" behavior. The pair `(user_id, client_conversation_id)` makes dedup **per-user**: the same client key from a different user is a distinct row. This is an additive, backward-compatible migration (existing rows get `NULL`).
**Test cases (write first, TDD — real Postgres, `runMigrations` in `beforeAll`):**
- After `runMigrations`, `conversations` has a nullable `client_conversation_id` column.
- A partial unique index on `(user_id, client_conversation_id) WHERE client_conversation_id IS NOT NULL` exists (e.g. assert via `pg_indexes`/`information_schema`).
- Inserting two rows for the **same** `user_id` with the **same** non-null `client_conversation_id` violates the unique index; with `NULL` `client_conversation_id` it does not (multiple nulls allowed).
**Done when:** the generated migration applies cleanly via `runMigrations`; `@ollive/db` typecheck + tests green. commit: `feat(db): add conversations.client_conversation_id column + partial-unique index`.

---

## Task 9: Auth routes + `createApp` mount (§1 Auth & Session, AU3/AU4/AU8) (TDD, supertest)
**Implements:** the `docs/API-CONTRACTS.md` **§1** contract: `GET /auth/google` (302 to consent, set `oauth_state`), `GET /auth/google/callback` (verify state → `handleCallback` → upsert user → set `session` cookie → 302 to `WEB_ORIGIN`; on failure 302 to `${WEB_ORIGIN}/?auth_error=1`), `POST /auth/logout` (clear cookie, 204), `GET /auth/me` (200 `MeResponse` | 401 `{ error: 'unauthorized' }`), `GET /v1/session` (never 401; `SessionResponse` discriminated union). Request validation uses `oauthCallbackQuerySchema`; responses are typed `MeResponse` / `SessionResponse` from `@ollive/shared/api`. Mounts the router into `createApp`. Tested in dev mode end-to-end; Google mode tested by INJECTING a fake `AuthProvider` (no network).
**Files:**
- Create: `apps/api/src/routes/auth.ts`.
- Edit: `apps/api/src/app.ts` — accept an optional injected `authProvider` in `AppDeps` (default `createAuthProvider(config)`); build `UserRepository` from `db`; mount `authRouter` at `/` and the `/v1/session` route at `/v1` (or mount the whole router at `/` and let it declare `/v1/session` internally) at the FUTURE point.
- Test: `apps/api/test/auth.int.test.ts`.
**Design:**
- **Signatures / types:**
  ```ts
  interface AuthRouterDeps {
    config: AppConfig;
    redis: Redis;
    users: UserRepository;
    authProvider: AuthProvider;   // injected → tests pass a fake; default createAuthProvider(config)
  }
  function authRouter(deps: AuthRouterDeps): Router;

  // createApp gains an optional override (DI seam for tests):
  interface AppDeps { db: Db; redis: Redis; config: AppConfig; logger?: Logger; authProvider?: AuthProvider; }
  ```
- **Algorithm (per route):**
  - `GET /auth/google`: `const { state } = signState(config.jwtSecret)`; set `oauth_state` cookie (httpOnly, SameSite=Lax, short maxAge ~10min, secure-in-prod); `res.redirect(302, authProvider.getAuthorizationUrl(state))`.
  - `GET /auth/google/callback`: validate `req.query` with `oauthCallbackQuerySchema` (`code`/`state` present non-empty strings; `AppError('validation_error')` if not — note that per contract §1 the callback's own error path redirects to `${webOrigin}/?auth_error=1` rather than returning a JSON body, so the catch-all below covers validation failures too); `verifyState(state, jwtSecret)` AND match against the `oauth_state` cookie — on failure `AppError('unauthorized')`; `const identity = await authProvider.handleCallback(code)`; `const user = await users.upsertByGoogleSub({ googleSub: identity.sub, ...identity })`; `const token = await signSession({ sub: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl }, jwtSecret)`; `setSessionCookie(res, token, { secure })`; clear `oauth_state`; `res.redirect(302, config.webOrigin)`. Wrap in try/catch → on any state/provider/validation failure redirect to `${webOrigin}/?auth_error=1` (don't leak provider detail; no JSON error body — contract §1).
  - `POST /auth/logout`: `clearSessionCookie(res, { secure })`; `res.status(204).end()`.
  - `GET /auth/me`: behind `requireAuth(deps)` → `res.json({ user: req.user })` typed as `MeResponse` (full `AuthUser`, incl. `avatarUrl?`); without a valid cookie → 401 `{ error: 'unauthorized' }` via `requireAuth`.
  - `GET /v1/session` (NEVER 401): try `verifySession(req.cookies['session'])`; on success → `{ authenticated: true, user: { id, email, name } }` (slim `SessionUser` — **no `avatarUrl`** here, per contract §1; use `/auth/me` for the full profile). On failure/absent → ensure a guest identity (run `guestSession` inline or read+issue the `guest_session` cookie) and `const { remaining, limit } = await readGuestRemaining(redis, guestId, config.guestMessageLimit)` → `{ authenticated: false, guest: { remaining, limit } }`. Response typed as the `SessionResponse` discriminated union from `@ollive/shared/api`; wire shape EXACTLY contract §1.
  - In `createApp`: `const authProvider = deps.authProvider ?? createAuthProvider(config)`; `const users = createUserRepository(db)`; mount `authRouter({ config, redis, users, authProvider })`.
- **Patterns / decisions / edge cases:** DI of `AuthProvider` is the test seam — Google-mode tests pass a fake whose `handleCallback` returns a canned identity, so NO real Google call occurs; dev-mode tests use the real `DevAuthProvider`. `/v1/session` must never 401 (it drives the UI guest indicator) — failures degrade to the guest branch. CSRF `state` is double-checked (signature + cookie match). `oauth_state` is single-use (cleared on callback). All async route handlers forward errors with `next(err)`.
**Test cases (write first, TDD — supertest against `createApp` with real Postgres + real Redis; use a supertest agent to persist cookies; `afterEach` truncates `users` + clears guest keys):**
- **Dev-mode full flow:** `GET /auth/google` → 302 with a `Location`; the response sets an `oauth_state` cookie. Following to `GET /auth/google/callback?code=dev&state=<the signed state>` (state from the prior cookie) → 302 to `WEB_ORIGIN`, sets a `session` cookie; a `users` row for `dev-google-sub` exists.
- `GET /auth/me` WITH the session cookie (agent) → 200 `{ user: { id, email: 'demo@ollive.local', name: 'Demo User' } }`; WITHOUT it → 401 `{ error: 'unauthorized' }`.
- `POST /auth/logout` → 204 and clears the `session` cookie (`Max-Age=0`); a subsequent `GET /auth/me` → 401.
- `GET /v1/session` unauthenticated → 200 `{ authenticated: false, guest: { remaining: 2, limit: 2 } }` and sets a `guest_session` cookie; never 401.
- `GET /v1/session` authenticated (with session cookie) → 200 `{ authenticated: true, user: { id, email } }`.
- **Google-mode via injected fake provider:** build `createApp` with `authProvider` = a fake (`handleCallback` returns `{ sub: 'g-123', email: 'a@b.com', name: 'A' }`); drive `/auth/google` → `/auth/google/callback` with a valid signed state → user upserted with `google_sub='g-123'`, session cookie set. (No network.)
- Callback with a tampered/mismatched `state` → 401, no user created, no session cookie.
**Done when:** `auth` tests green (infra up) + `tsc --noEmit` clean. commit: `feat(api): add auth routes (google/dev login, logout, me, session)`.

---

## Task 10: Conversations repository + serializers + validation + CRUD router (contract §2, FR1/FR5/FR6/FR7, SE8) (TDD, supertest)
**Implements:** `docs/API-CONTRACTS.md` **§2** list/create/get/patch — user-scoped (SE8), cursor pagination + status filter (FR5), get-with-messages (FR6), rename (sets `title_source='user'`) + archive (FR7). Wire shapes EXACTLY contract §2, typed by `@ollive/shared/api`: **list returns `{ items: ConversationSummary[], nextCursor: string | null }`** (`ConversationListPage`; items carry NO `messages`, NO `title_source`); detail returns `ConversationDetail` (`Conversation` + `messages: Message[]`); POST/PATCH return `Conversation`. Request validation uses the shared `listConversationsQuerySchema` / `createConversationSchema` / `patchConversationSchema`.
**Files:**
- Create: `apps/api/src/conversations/serialize.ts`, `apps/api/src/conversations/repository.ts`, `apps/api/src/conversations/validation.ts`, `apps/api/src/routes/conversations.ts`.
- Edit: `apps/api/src/app.ts` — mount `conversationsRouter` at `/v1` behind `requireAuth` at the FUTURE point.
- Test: `apps/api/test/conversations.int.test.ts`.
**Design:**
- **Signatures / types:**
  ```ts
  // serialize.ts — maps Drizzle rows to the @ollive/shared/api response types (single source of truth = contract §2).
  // Import the types; do NOT redefine them here.
  import type {
    ConversationSummary, Conversation, Message, ConversationDetail,
  } from '@ollive/shared/api';
  // (Conversation === ConversationSummary; both omit messages + title_source.)
  function toConversationSummary(row: ConversationRow): ConversationSummary;          // list item
  function toConversation(row: ConversationRow): Conversation;                        // POST/PATCH header (same shape)
  function toMessage(row: MessageRow): Message;                                       // tokenCount omitted when null/user msg; status mapped
  function toConversationDetail(conv: ConversationRow, msgs: MessageRow[]): ConversationDetail; // detail / import

  // repository.ts — every method scoped to userId (SE8). Result/query types reuse the shared request/response types.
  import type {
    ConversationSummary, Conversation, ConversationDetail, ConversationListPage,
  } from '@ollive/shared/api';
  interface ListConversationsParams { userId: string; status: 'active'|'archived'; limit: number; cursor?: string }
  // list returns the shared ConversationListPage = { items: ConversationSummary[]; nextCursor: string | null }
  interface CreateConversationInput { userId: string; title?: string; provider: string; model: string }
  interface PatchConversationInput { title?: string; status?: 'active'|'archived' }
  interface ConversationRepository {
    list(p: ListConversationsParams): Promise<ConversationListPage>;
    create(input: CreateConversationInput): Promise<Conversation>;
    getWithMessages(userId: string, id: string): Promise<ConversationDetail | null>;
    patch(userId: string, id: string, input: PatchConversationInput): Promise<Conversation | null>;
  }
  function createConversationRepository(db: Db): ConversationRepository;

  // routes — validation via shared schemas (listConversationsQuerySchema / createConversationSchema / patchConversationSchema)
  interface ConversationsRouterDeps { config: AppConfig; conversations: ConversationRepository }
  function conversationsRouter(deps: ConversationsRouterDeps): Router;
  ```
- **Algorithm (per route, all behind `requireAuth`):**
  - `GET /v1/conversations?status=&limit=&cursor=`: validate query with `listConversationsQuerySchema` (`status` enum default `active`, **`limit` 1–100 default 20** — `limit > 100` is rejected as `validation_error` per contract §2, `cursor` optional opaque string). `repository.list`: `where userId = req.user.id AND status = status`, order by `updatedAt DESC, id DESC`, `limit limit+1`. **Cursor is the opaque last-item id** (contract §2: clients treat it as a black box) — internally it keys the `(updatedAt, id) < (cursorUpdatedAt, cursorId)` predicate (resolve the cursor row's `updatedAt` by id, or encode `updatedAt|id` and treat the encoded form as the opaque token). Take `limit` rows; if a `(limit+1)`th existed, `nextCursor` = the last returned item's id, else `null`. Respond the shared `ConversationListPage` `{ items: ConversationSummary[], nextCursor: string | null }` (items via `toConversationSummary` — NO messages, NO `title_source`).
  - `POST /v1/conversations` `{ title? }` (validate with `createConversationSchema`): `repository.create({ userId, title, provider: 'google', model: config.defaultModel })` → 201 `Conversation` (no messages — a new conversation has none). Provider/model come from config: **`provider='google'`, `model=config.defaultModel`** (owned by Plan 4 Task 1; conversations record the provider/model used, PA4). `title` defaults to `'New conversation'`, `title_source='default'` server-side (never serialized).
  - `GET /v1/conversations/:id`: `repository.getWithMessages(userId, id)`; `null` → `AppError('not_found')` (unknown id OR not owned — no existence leak, SE8); else 200 `ConversationDetail` (`Conversation` + `messages: Message[]`, ordered by `sequence ASC`; per-message `tokenCount` omitted when null).
  - `PATCH /v1/conversations/:id` `{ title?, status? }`: validate with `patchConversationSchema` (its `.refine` requires at least one field → empty body is `validation_error`). When `title` present, also set `titleSource = 'user'` (FR18 — provenance, never inferred from the string). When `status` present, set it. Always bump `updatedAt`. Scoped `where userId AND id`; affected 0 rows → `AppError('not_found')` (unknown or not owned); else 200 `Conversation`.
- **Patterns / decisions / edge cases:** repository pattern + serializer module producing the shared `@ollive/shared/api` types (the contract §2 shape lives in exactly one place; Plan 5 imports `toMessage` for its streamed message persistence). **SE8 user-scoping is enforced in every WHERE clause** — a conversation owned by another user returns `not_found` (404), never another user's data, no existence leak. Keyset (cursor) pagination over `(updatedAt DESC, id DESC)` is stable under inserts and uses `idx_conv_user_status_updated`; `nextCursor` is the opaque last-item id (`null` on the last page), `limit` default 20 / max 100 (over-100 rejected). Rename sets `title_source='user'` so auto-naming (Plan 5) never clobbers it (FR18/A12). Validation uses the shared Zod schemas (BE3) → `validation_error` (400). Timestamp columns serialize to ISO strings; `Message.tokenCount` is **omitted entirely when null** (user messages / not-yet-counted), distinct from a numeric `0` — `status` is always present.
**Test cases (write first, TDD — supertest with two distinct authed agents (two seeded users) where cross-user scoping is tested; real Postgres + Redis; truncate between tests):**
- `POST /v1/conversations` (authed) → 201 `Conversation` with `title === 'New conversation'`, `status === 'active'`, `provider === 'google'`, `model === config.defaultModel` (`'gemini-2.5-flash'` by default), ISO `createdAt`/`updatedAt`, **no `messages` / `title_source` in the body**; shape matches contract §2 exactly.
- `POST /v1/conversations` WITHOUT a session cookie → 401 `{ error: 'unauthorized' }`.
- `GET /v1/conversations?status=active` → `{ items: ConversationSummary[], nextCursor }`; items are the user's active conversations, most-recently-updated first; archived ones excluded; **no `messages` / `title_source` on items**.
- `limit=101` → 400 `validation_error` (over the max of 100).
- Pagination: create 3, `limit=2` → first page `items.length === 2` + a non-null `nextCursor`; following `?cursor=<nextCursor>` → the remaining 1 item, `nextCursor === null`.
- `GET /v1/conversations/:id` for own conversation → 200 `ConversationDetail` with `messages` array (ordered by sequence; `tokenCount` omitted for user messages). For a NON-existent id → 404 `not_found`. For ANOTHER user's conversation id → 404 `not_found` (SE8 — no cross-user read).
- `PATCH /v1/conversations/:id { title: 'Trip planning' }` → 200; reloading shows the title; the row's `title_source === 'user'`.
- `PATCH /v1/conversations/:id { status: 'archived' }` → 200; it disappears from `?status=active` and appears under `?status=archived`.
- `PATCH` another user's conversation → 404 (no cross-user write).
**Done when:** `conversations` tests green (infra up) + `tsc --noEmit` clean. commit: `feat(api): add user-scoped conversations CRUD with cursor pagination`.

---

## Task 11: Import buffered guest conversation (contract §2 import / RESOLUTION 7, BE11/AU8/FR16) (TDD, supertest)
**Implements:** `POST /v1/conversations/import` — persist a buffered guest conversation for the authed user, idempotent on an optional `clientConversationId`, with `title_source='default'` so Plan 5's auto-naming runs (BE11/AU8/FR16/A12). Wire shape EXACTLY contract §2 (returns `ConversationDetail`). Request validation uses the shared `importConversationSchema`. **Idempotency uses the `conversations.client_conversation_id` column + partial-unique index from Task 8.5 (lookup-or-`onConflictDoNothing`) — NOT a hashed/derived primary key.** Depends on Task 8.5.
**Files:**
- Edit: `apps/api/src/conversations/validation.ts` — re-export / wire the shared `importConversationSchema`.
- Edit: `apps/api/src/conversations/repository.ts` — add `importConversation`.
- Edit: `apps/api/src/routes/conversations.ts` — add the `POST /v1/conversations/import` route (behind `requireAuth`).
- Test: `apps/api/test/import.int.test.ts`.
**Design:**
- **Signatures / types:**
  ```ts
  // Request validation = the shared importConversationSchema from @ollive/shared/api
  // ({ clientConversationId?: string (1..200), messages: array(min 1) of { role:'user'|'assistant', content: string min 1 } }).
  import type { ImportConversationBody, ConversationDetail } from '@ollive/shared/api';
  interface ImportConversationInput {
    userId: string;
    clientConversationId?: string;   // optional idempotency key (per user)
    messages: ImportConversationBody['messages'];
    provider: string; model: string;
  }
  // added to ConversationRepository:
  //   importConversation(input): Promise<ConversationDetail>
  ```
  Body schema (Zod): the shared `importConversationSchema` (do not redefine it locally).
- **Algorithm:** in a single transaction, using the `client_conversation_id` column + partial-unique index from Task 8.5 (NO hashed/derived PK):
  1. If `clientConversationId` is provided, **look up** an existing `conversations` row for this `userId` with `client_conversation_id = clientConversationId`. If found → return it with its messages (idempotent; **no duplicate, one row**).
  2. Else insert a new `conversations` row with a **normal random PK** (`id` defaults via `defaultRandom()`), `title='New conversation'`, `title_source='default'`, `status='active'`, `provider`, `model`, and `client_conversation_id = clientConversationId` when provided (else `NULL`). Use `onConflictDoNothing()` targeting the partial-unique index `(user_id, client_conversation_id)` to absorb a concurrent duplicate insert; if the insert returned no row (conflict), re-select the existing row by `(userId, clientConversationId)` and return it.
  3. Insert each message with a monotonic `sequence` starting at 1, in array order, `status='complete'`, `tokenCount` null (omitted in serialization).
  4. Return `toConversationDetail(conv, msgs)`.
  - **Idempotency storage (authoritative — contract §2 RESOLUTION 7):** dedup lives in the dedicated **nullable `conversations.client_conversation_id` column** with a **partial-unique index on `(user_id, client_conversation_id) WHERE client_conversation_id IS NOT NULL`** (added in Task 8.5). The conversation primary key is a **random UUID** — there is **no UUIDv5/derived/hashed PK** anywhere. A re-import of the same `(userId, clientConversationId)` resolves to the same row via lookup-or-`onConflictDoNothing`. When `clientConversationId` is omitted, the column is `NULL` and every import creates a fresh conversation (multiple NULLs allowed by the partial index — no dedup). The same key from a different user is a distinct conversation (the unique pair is per-user).
- **Patterns / decisions / edge cases:** transactional multi-row insert (conversation + its messages) keeps the imported exchange atomic. Idempotency is keyed on the `(user_id, client_conversation_id)` partial-unique pair so re-posting after a flaky network does not duplicate (contract §2 requirement). `title_source='default'` is the signal Plan 5's auto-naming keys on (A12). Messages are validated by the shared schema (BE3); `system` role is rejected for import (guest exchanges are user/assistant only). User-scoped throughout (SE8). Provider/model come from config (`provider='google'`, `model=config.defaultModel`).
**Test cases (write first, TDD — supertest, authed agent, real Postgres):**
- `POST /v1/conversations/import` with two messages (user + assistant), no `clientConversationId` → 201 `ConversationDetail`: server-assigned random `id`, `title === 'New conversation'`, two messages with `sequence` 1 and 2 in order; owned by the caller. (Verify the row's `title_source === 'default'` and `client_conversation_id IS NULL`.)
- Idempotency: import twice with the SAME `clientConversationId` (and same user) → both responses have the SAME conversation `id`; **exactly one conversation row** (assert the DB has one matching row) and the messages are not duplicated.
- Two imports with NO `clientConversationId` (same user) → distinct conversation `id`s (no dedup; multiple NULLs allowed).
- Different `clientConversationId` (same user) → distinct conversation `id`s.
- Import WITHOUT a session cookie → 401 `{ error: 'unauthorized' }`.
- Empty `messages` array → 400 `validation_error`; a `system` role in `messages` → 400 `validation_error`.
- A `clientConversationId` reused by a DIFFERENT user → creates a separate conversation (the partial-unique pair is per-user; no cross-user collision).
**Done when:** `import` tests green (infra up) + `tsc --noEmit` clean. commit: `feat(api): add idempotent guest-conversation import endpoint`.

---

## Task 12: Wire dev-mode seed on startup + env example; full-suite green (DE7, DE5)
**Implements:** seed the demo user on `server.ts` startup when `AUTH_MODE=dev` (DE7), document the new env vars (DE5 partial — the vars this plan introduces), and confirm the whole `api` project is green.
**Files:**
- Edit: `apps/api/src/server.ts` — after `runMigrations` + `createDb`, if `config.authMode === 'dev'` call `createUserRepository(db).seedDemoUser()` (logged, non-fatal on error). No other change to the entrypoint.
- Edit: `.env.example` — append the new vars (keeping prior plans' entries):
  ```dotenv
  # --- Auth (Plan 4) ---
  AUTH_MODE=dev                      # 'dev' (seeded demo user, no Google creds) | 'google' (real OAuth) (A5/AU4)
  JWT_SECRET=dev-jwt-secret-change-me   # HS256 session signing + guest/state HMAC (SE3)
  GOOGLE_CLIENT_ID=                   # required only when AUTH_MODE=google
  GOOGLE_CLIENT_SECRET=               # required only when AUTH_MODE=google
  # GOOGLE_REDIRECT_URI=             # optional override; default ${API_BASE_URL}/auth/google/callback
  WEB_ORIGIN=http://localhost:5173    # CORS allowlist + post-login redirect (SE4)
  GUEST_MESSAGE_LIMIT=2               # guest trial cap (A11/AU7)
  GUEST_SESSION_TTL=86400             # guest cookie + Redis counter TTL in seconds
  DEFAULT_MODEL=gemini-2.5-flash      # provider model for new conversations + guest chat (A10; owned by Plan 4, read by Plan 5)
  ```
**Design:**
- **Algorithm:** documentation + a guarded one-line seed call (idempotent via Task 8). Seed failure logs a warning and does NOT crash startup (a transient DB hiccup shouldn't block the API; the next request through dev login re-upserts the same row).
- **Patterns / decisions / edge cases:** seed-on-startup is the DE7 one-command-startup affordance; idempotent so restarts are safe. Env doc surface is DE5. The seed runs only in dev mode (in google mode users are created on real login).
**Test cases (write first, TDD):** none new (covered by Task 8's seed idempotency unit + Task 9's dev-login flow). Verified by the full-suite gate.
**Done when:** `pnpm exec vitest run --project api` passes ALL api tests (config, jwt, state, counter, users, auth, conversations, import) with Postgres + Redis up; the `@ollive/shared` api-schema tests (Task 1.5) and the `@ollive/db` migration test (Task 8.5) pass; `pnpm --filter @ollive/api exec tsc --noEmit` and `pnpm --filter @ollive/shared exec tsc --noEmit` clean; `pnpm test` passes all projects. commit: `chore(api): seed demo user in dev mode and document auth env vars`.

---

## Definition of Done

- [ ] The `@ollive/shared/api` DTO module exists (`common`/`errors`/`auth`/`conversations`/`chat`/`metrics` + `api/index.ts`), is re-exported from `packages/shared/src/index.ts`, its schema tests pass, and `@ollive/shared` typechecks — all request validation/response typing in this plan imports from it (no ad-hoc shapes).
- [ ] `@ollive/db` has the nullable `conversations.client_conversation_id` column + partial-unique index `(user_id, client_conversation_id) WHERE client_conversation_id IS NOT NULL`, with a generated migration that applies via `runMigrations`. The conversation PK remains a random UUID (NO hashed/derived PK).
- [ ] `pnpm install` resolves the new `apps/api` deps (`jose`, `google-auth-library`, `cookie-parser`, `cors`, `@types/*`).
- [ ] `pnpm --filter @ollive/api exec tsc --noEmit` and `pnpm --filter @ollive/shared exec tsc --noEmit` pass.
- [ ] `pnpm exec vitest run --project api` passes (config, jwt, state, counter, users, auth, conversations, import) with Postgres + Redis running.
- [ ] `pnpm test` passes all projects (with Postgres + Redis up).
- [ ] `DEFAULT_MODEL` is owned by Plan 4's config (default `gemini-2.5-flash`); new conversations use `provider='google'`/`model=config.defaultModel`; Plan 5 only reads it.
- [ ] The conversation list returns `{ items: ConversationSummary[], nextCursor: string | null }` (no messages / no `title_source` on items; limit default 20 / max 100); detail returns `ConversationDetail` with `messages`.
- [ ] Dev-mode login flow works end-to-end via supertest (`/auth/google` → `/auth/google/callback?code=dev` → session cookie → `/auth/me` 200).
- [ ] `GET /v1/session` never returns 401 (guest branch when unauthenticated, user branch when authenticated).
- [ ] Cross-user access is impossible: another user's conversation id returns 404 on GET and PATCH (SE8).
- [ ] Import is idempotent on the `(user_id, client_conversation_id)` partial-unique index (column approach, random PK — no hashed PK) and sets `title_source='default'`; re-import of the same key yields one row.
- [ ] Rename sets `title_source='user'`; archive moves a conversation between `?status=` filters.
- [ ] Guest cap is enforced server-side via the Redis counter; `readGuestRemaining` does not consume the trial.
- [ ] No real Google network call occurs in any test (dev provider real; Google provider injected as a fake).
- [ ] The pinned middleware/helpers are exported for Plan 5: `requireAuth`, `guestSession`, `checkAndIncrementGuest`, `readGuestRemaining` (+ the §8.2 serializers).

### Requirement → task coverage check

| Requirement | Where |
|---|---|
| `docs/API-CONTRACTS.md` §8 — shared `@ollive/shared/api` DTO module (NFR7) | Task 1.5 |
| `docs/API-CONTRACTS.md` §1 — Auth & Session contract | Task 9 |
| `docs/API-CONTRACTS.md` §2 — Conversations (incl. import) contract | Tasks 10, 11 |
| `docs/API-CONTRACTS.md` §7 — error catalog (incl. `rate_limited` 429) | Tasks 1.5 (catalog), 7 (IP limiter), 9–11 (route errors) |
| A10 — `DEFAULT_MODEL` owned by API config | Task 1 (added; Plan 5 only reads) |
| RESOLUTION 7 — `conversations.client_conversation_id` column + partial-unique index migration | Task 8.5 |
| A5 / AU4 / S1 — `AUTH_MODE` dev bypass + seeded demo user | Tasks 1, 4 (DevAuthProvider), 8 (seed), 12 (startup seed) |
| A11 / AU7 / SE10 — guest trial, server-enforced cap | Tasks 1 (vars), 6 (counter), 7 (guest middleware) |
| A12 — `title_source` provenance (default/user) | Tasks 10 (rename → user), 11 (import → default) |
| FR13 — Google OAuth auth | Tasks 4, 9 |
| FR15 / FR16 / AU8 — guest cap + import-on-login | Tasks 6, 7, 11 |
| FR1 / FR5 / FR6 / FR7 — create/list/resume/rename+archive | Task 10 |
| §7.1 / §7.4 — anonymous→import flow; list & resume | Tasks 9 (session), 10 (list/get), 11 (import) |
| §8.1 / contract §1 — auth contracts (google/callback/logout/me/session) | Task 9 |
| §8.2 / contract §2 — conversations contracts incl. import | Tasks 10, 11 |
| §10 — use existing `users`/`conversations`/`messages` tables (+ Task 8.5 additive column) | Tasks 8, 8.5, 10, 11 |
| BE1 — domain-split routers (`auth`, `conversations`) | Tasks 9, 10, 11 |
| BE3 — Zod validation (shared `@ollive/shared/api` schemas), 400 with details | Tasks 1.5, 10, 11 |
| BE8 — pino + correlation id + CORS | Task 2 (CORS; pino/correlation inherited from Plan 3) |
| BE9 — single shared Redis client | Tasks 6, 9 (inject `deps.redis`) |
| BE10 — guest cookie + Redis cap + 403 path | Tasks 6, 7 (Plan 5 calls `checkAndIncrementGuest`) |
| BE11 — import persists buffered conversation, triggers naming, idempotent on client key | Tasks 8.5 (column + index), 11 (`title_source='default'`) |
| AU1 — `AuthProvider` abstraction | Task 4 |
| AU2 — upsert by `google_sub`, stateless JWT cookie | Tasks 3, 8, 9 |
| AU3 — auth middleware → 401 | Task 5 |
| AU7 / AU8 — guest sessions + import on login | Tasks 6, 7, 11 |
| SE3 — httpOnly + SameSite=Lax + Secure-in-prod JWT | Task 3 |
| SE4 — CORS locked to `WEB_ORIGIN` + credentials | Task 2 |
| SE8 — user-scoped queries, no cross-user access | Tasks 10, 11 |
| SE9 / S4 — simple in-memory IP rate limiter | Task 7 |
| SE10 — server-side guest cap (Redis), not client-trusted | Tasks 6, 7 |

This plan is consumed by Plan 5 (Chat & Metrics — mounts the chat (SSE) + metrics routers in the same `createApp` factory; imports `requireAuth`/`guestSession`/`checkAndIncrementGuest`/`readGuestRemaining`, the contract §2 serializers (`toMessage`), and the chat/metrics request schemas + SSE/response types from the `@ollive/shared/api` module created here in Task 1.5; reads `config.defaultModel` (does NOT re-add `DEFAULT_MODEL`); and persists streamed messages into the conversations created/imported here) and Plan 6 (frontend — imports the `@ollive/shared/api` response/request types) and Plan 7 (Deployment — `AUTH_MODE`, `JWT_SECRET`, `WEB_ORIGIN`, `DEFAULT_MODEL`, and the `GOOGLE_*`/`GUEST_*` vars are wired into compose env).
