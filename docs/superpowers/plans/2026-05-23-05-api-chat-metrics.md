# API Chat & Metrics Implementation Plan (Plan 5 of 7)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Format note (design-level):** This plan specifies *what* to build and *what to test* — type/function signatures, algorithms, test-case descriptions, and design patterns, **not** finished implementation bodies and **not** literal `it(...)`/`expect(...)` test code. ` ```ts ` fences hold ONLY interface/type declarations, bare signatures, and `// pseudocode`; tiny SSE/JSON wire snippets that ARE the contract are reproduced verbatim. The implementing subagent authors the real code and the real Vitest/supertest tests, driving them from the listed test cases (TDD: write the test, watch it fail, implement, watch it pass).
>
> **Commit convention:** every commit message in this plan must end with the trailer:
> `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`

**Goal:** Extend `apps/api` (Plans 3 & 4) with the chat product surface — SSE-streamed multi-turn chat (`POST /v1/conversations/:id/messages`), client-abort cancellation with partial-save, token-budget context windowing, no-persistence guest chat (`POST /v1/guest/messages`), async LLM auto-naming of conversations — and the metrics surface (`GET /v1/metrics/{overview,latency,throughput,errors,tokens}`) computed as SQL aggregations over `inference_logs`, all scoped to the authenticated user. Every LLM call flows through the Plan 2 SDK so it self-instruments into the Plan 3 ingestion pipeline; the chat path never blocks on telemetry.

**Architecture:** The chat handler is the synchronous half of the transactional/telemetry split (PRD §4.3): it writes user + assistant `messages` rows itself and streams provider deltas to the client as SSE, while the SDK ships the inference log asynchronously off the hot path. The single key testability decision is a **provider dependency-injection seam**: the chat `LLMProvider` is injected into `createApp` deps (`chatProvider`), so production wires the real instrumented Gemini provider (`withLoggingTransport(googleProviderFactory(), …)`) while tests inject a scripted `FakeProvider` — no test ever calls real Gemini, yet runtime still requires a real `GEMINI_API_KEY`. Cancellation is driven entirely by the client closing the connection: an `AbortController` per request is fired on the response `close` event, propagating to the provider's `signal`; partial assistant output is persisted (`status='partial'`) and the SDK records `status='cancelled'`. Metrics are pure SQL aggregations (`percentile_cont` for latency percentiles, `date_trunc` time-bucketing for series) over `inference_logs`, parameterized via Drizzle and always `WHERE user_id = $auth` (SE8).

**Tech Stack:** TypeScript 5.7, pnpm workspaces, Vitest 3 (root workspace runner), Express 4 + supertest 7, Drizzle ORM (`drizzle-orm`, raw `sql` template for aggregations), ioredis 5, Zod 3, `@ollive/db` / `@ollive/shared` / `@ollive/llm-sdk` (workspace), tsx 4 (run TS source — no build step), Node 20 built-ins (`node:crypto` for `randomUUID`, native `AbortController`). Postgres 16 + Redis 7 from Plan 1's `infra/docker-compose.yml` back the integration tests.

**Context:** The repo root is the existing git repository at `chatbot-ollive/`. Plans 1–4 are assumed implemented before this plan executes. This plan **edits** `apps/api/src/app.ts` and `apps/api/src/config.ts` and `apps/api/src/server.ts` (Plan 3), and **consumes** Plan 4's auth/guest middleware and the `@ollive/db` `conversations`/`messages` tables. All paths are relative to the repo root. **Plan 1/3 conventions you MUST follow:** internal packages are consumed as TS source via `exports` (no build step, run with `tsx`); tests run through the root `vitest.workspace.ts` (the `api` project already exists with `testTimeout: 30000`, `fileParallelism: false`); Postgres/Redis integration tests read `process.env.DATABASE_URL ?? 'postgres://ollive:ollive@localhost:5432/ollive'` and `process.env.REDIS_URL ?? 'redis://localhost:6379'`, call `runMigrations` in `beforeAll`, clean up in `afterAll`. Express stays on `^4.21.0`. Errors use `AppError` + the central `errorHandler` with the stable shape `{ error: <code>, details? }`.

References (PRD): §3 (A3 token-budget window, A4 cancel=abort, A10 default model, A12 auto-naming), §5 (FR2/FR3/FR4, FR8/FR9, FR12, FR15/FR16, FR17/FR18), §7.2/§7.3/§7.5 (flows), §8.3 (chat SSE + guest variant), §8.5 (metrics shapes), §9 (InferenceLog), §10 (messages/conversations/inference_logs columns), §12 (BE4/BE5/BE7/BE12), §14 (LLMProvider/ChatRequest/StreamChunk), §16.1 (extracted metadata the metrics read), §17 (ST1–ST7), §18 (error mapping), §20 (SE8), §22 (OB5 TTFT).

> **Pinned contracts consumed from earlier plans (do NOT invent variants):**
> - **Plan 2 (`@ollive/llm-sdk`):** `withLoggingTransport(provider, config) → { provider, transport }`; `googleProviderFactory(): LLMProvider`; types `LLMProvider`/`ChatRequest`/`StreamChunk`/`CallContext`/`InferenceLoggerConfig`. `streamChat(req, { signal, context })` yields `StreamChunk` (`{ delta? }` deltas, then a final `{ usage?, finishReason? }`); on abort it throws an `AbortError`. The SDK classifies `status` (`success`/`error`/`cancelled`) itself from the abort/throw — the API does **not** ship logs directly.
> - **Plan 3 (`apps/api`):** `createApp({ db, redis, config })`; `loadConfig(env?)`; `AppError(code, message, details?, status?)` + `errorHandler(logger)`; mount new routers at the `// FUTURE (Plans 4/5)` extension point in `src/app.ts`; `INGESTION_API_KEY` already in config. Error codes already include `validation_error|unauthorized|not_found|login_required|internal_error`.
> - **Plan 4 (`apps/api`, drafted in parallel — rely on these PINNED shapes):** `requireAuth(deps): RequestHandler` sets `req.user: { id: string; email: string; name?: string; avatarUrl?: string }` (else 401 `unauthorized`). `guestSession(deps): RequestHandler` sets `req.guest: { id: string }` (issues/verifies the signed httpOnly guest cookie). `checkAndIncrementGuest(redis, guestId, limit, ttl): Promise<{ allowed: boolean; remaining: number }>` enforces the cap. Conversation/message rows are `@ollive/db`'s `conversations`/`messages`; `GUEST_MESSAGE_LIMIT` / `GUEST_SESSION_TTL` config keys exist (Plan 4 owns them).
> - **`@ollive/db`:** `Db` type; tables `conversations` (cols `id, userId, title, titleSource, status, provider, model, createdAt, updatedAt`), `messages` (cols `id, conversationId, role, content, tokenCount, sequence, status, createdAt`), `inferenceLogs` (cols per PRD §10/§16.1). Import tables/`Db` from `@ollive/db`, never redefine.
> - **`@ollive/shared`:** `Usage`, `InferenceLog`, `PREVIEW_MAX_CHARS`, `messageRole`, `conversationStatus`.

---

## File Structure

```
apps/api/
  src/
    config.ts                       # EDIT: add chat config (GEMINI_API_KEY, DEFAULT_MODEL, CONTEXT_TOKEN_BUDGET, PII_REDACTION)
    app.ts                          # EDIT: AppDeps += chatProvider; mount chatRouter, guestChatRouter, metricsRouter at the FUTURE point
    server.ts                       # EDIT: build instrumented chatProvider via withLoggingTransport + inject; close transport on shutdown
    chat/
      tokens.ts                     # estimateTokens(text) heuristic + buildContext(messages, budget, reserve) — pure (BE5/A3)
      sse.ts                        # SseStream helper: start/token/done/error frames, headers, : ping heartbeat (ST1/ST2/ST5)
      naming.ts                     # generateTitle(provider, model, messages) + maybeAutoName(...) async side-effect (BE12/FR17/FR18)
      run-chat.ts                   # runChatStream(): shared streaming engine for chat + guest (abort, forward, finalize)
    routes/
      chat.ts                       # chatRouter: POST /conversations/:id/messages (auth) — persist + stream + finalize (BE4/§7.2)
      guest.ts                      # guestChatRouter: POST /guest/messages (guest cap, no persistence) (BE10/§8.3/IN8)
      metrics.ts                    # metricsRouter: GET /metrics/{overview,latency,throughput,errors,tokens} (BE7/§8.5/SE8)
    metrics/
      sql.ts                        # parameterized Drizzle SQL builders (percentile/bucket/error/token/throughput)
      params.ts                     # Zod parse of from/to/provider/model/bucket query params
  test/
    tokens.test.ts                  # unit: estimateTokens + buildContext budgeting
    sse.test.ts                     # unit: SSE frame formatting + heartbeat
    metrics-sql.test.ts             # unit: bucket-interval mapping + param coercion (pure helpers)
    fakes.ts                        # FakeChatProvider (scripted deltas/usage; abort + throw) + helpers
    chat.int.test.ts                # supertest streaming chat: event sequence, persistence, cancel, error, auto-name
    guest.int.test.ts               # supertest guest chat: cap 403, stream, no persistence, guestSessionId on log
    metrics.int.test.ts             # supertest metrics over seeded inference_logs: aggregation + user scoping + filters
```

**Module responsibilities (single-responsibility, NFR8):** `chat/tokens` and `chat/sse` and `metrics/sql` + `metrics/params` are pure and unit-tested in isolation. `chat/run-chat` is the one streaming engine both routers share (DRY). The route modules are thin: persistence + wiring. `chat/naming` is the fire-and-forget side-effect. The DI seam lives in `app.ts` (`AppDeps.chatProvider`) and is filled by `server.ts` in prod and by tests directly.

---

## Task 1: Config extension — chat env vars (TDD)
**Implements:** the chat-path config surface (DE5 partial): `GEMINI_API_KEY`, `DEFAULT_MODEL` (A10), `CONTEXT_TOKEN_BUDGET` (A3/BE5), `PII_REDACTION` (SDK9). Extends Plan 3's `loadConfig` schema at its documented single extension point.
**Files:**
- Edit: `apps/api/src/config.ts` — add the four keys to the Zod env schema + `AppConfig`.
- Test: `apps/api/test/config.test.ts` — extend Plan 3's existing config test (one-line: add cases for the new keys).

**Design:**
- **Signatures / types:** extend the existing `AppConfig` (do not redefine the Plan 3 fields):
  ```ts
  interface AppConfig {
    // ...Plan 3 fields: port, databaseUrl, redisUrl, ingestionApiKey, ingestionStreamMaxLen
    // ...Plan 4 fields: jwtSecret, webOrigin, authMode, guestMessageLimit, guestSessionTtl (owned by Plan 4)
    geminiApiKey: string;            // GEMINI_API_KEY — required (no runtime mock provider)
    defaultModel: string;            // DEFAULT_MODEL — default 'gemini-2.5-flash'
    contextTokenBudget: number;      // CONTEXT_TOKEN_BUDGET — default 4000
    piiRedaction: 'off' | 'pattern' | 'llm'; // PII_REDACTION — default 'pattern'
  }
  ```
- **Algorithm:** add to the Zod `envSchema`: `GEMINI_API_KEY: z.string().min(1)`; `DEFAULT_MODEL: z.string().default('gemini-2.5-flash')`; `CONTEXT_TOKEN_BUDGET: z.coerce.number().int().positive().default(4000)`; `PII_REDACTION: z.enum(['off','pattern','llm']).default('pattern')`. Map into `AppConfig`. Reuse the existing fail-fast aggregation (one Error listing every offending `path: message`).
- **Patterns / decisions / edge cases:** typed-config + fail-fast, identical to Plan 3. `GEMINI_API_KEY` is **required** even though tests inject a fake provider — the production wiring needs it and a missing key must fail at startup, not mid-request. Tests that build `loadConfig` supply a dummy `GEMINI_API_KEY` in their env fixture; the fake provider never reads it.

**Test cases (write first, TDD):**
- Valid env including the four new keys → `geminiApiKey` passed through, `defaultModel`/`contextTokenBudget`/`piiRedaction` mapped.
- Missing `DEFAULT_MODEL`/`CONTEXT_TOKEN_BUDGET`/`PII_REDACTION` → defaults `'gemini-2.5-flash'`, `4000`, `'pattern'`.
- `CONTEXT_TOKEN_BUDGET='8000'` → coerced number `8000`.
- Missing `GEMINI_API_KEY` → throws, message mentions `GEMINI_API_KEY`.
- `PII_REDACTION='bogus'` → throws (enum violation).

**Done when:** config test cases green + `pnpm --filter @ollive/api exec tsc --noEmit` clean; commit `feat(api): add chat config (gemini key, default model, context budget, redaction)`.

---

## Task 2: Token estimation + context budgeting (BE5/A3) (TDD)
**Implements:** the token-budget sliding window — a pure `estimateTokens` heuristic and `buildContext` that selects the most-recent messages fitting the prompt budget while always keeping the latest user turn. Powers FR3/AC3.
**Files:**
- Create: `apps/api/src/chat/tokens.ts`.
- Test: `apps/api/test/tokens.test.ts`.

**Design:**
- **Signatures / types:**
  ```ts
  import type { ChatRequest } from '@ollive/llm-sdk'; // for the message shape
  type ChatMessage = ChatRequest['messages'][number]; // { role: 'system'|'user'|'assistant'; content: string }

  function estimateTokens(text: string): number;

  interface BuildContextResult {
    messages: ChatMessage[];        // chronological order, ready for ChatRequest.messages
    contextTokens: number;          // sum of estimateTokens over the selected messages
    contextMessageCount: number;    // messages.length (mirrors §16.1 metadata.contextMessages)
    droppedCount: number;           // how many older messages were trimmed
  }

  function buildContext(
    history: ChatMessage[],         // full chronological history INCLUDING the latest user turn as the last element
    budget: number,                 // CONTEXT_TOKEN_BUDGET
    reserveForResponse: number,     // headroom subtracted from budget for the model's reply
  ): BuildContextResult;
  ```
- **Algorithm:**
  - `estimateTokens(text)` — heuristic: `Math.ceil(text.length / 4)` (the standard ~4-chars/token approximation; a `0`-length string → `0`). Deterministic, no tokenizer dependency (documented approximation, not exact).
  - `buildContext` — `available = max(budget - reserveForResponse, 0)`. Walk `history` from the **most recent** backwards, accumulating `estimateTokens(content)`; include a message while the running sum `<= available`; stop at the first message that would overflow. **Always include the latest user turn** (the last element) even if it alone exceeds `available` — never produce an empty context. Preserve chronological order in the output (reverse the collected slice). Return the sum of included tokens, the count, and `droppedCount = history.length - messages.length`.
- **Patterns / decisions / edge cases:** pure function (same input → same output, no I/O), greedy most-recent-first selection. Edge cases: (a) latest user turn alone over budget → output is exactly that one message, `contextTokens` may exceed `available`, `droppedCount = history.length - 1`; (b) empty history → `{ messages: [], contextTokens: 0, contextMessageCount: 0, droppedCount: 0 }` (the caller guarantees the user turn is present in real use, but the function must not throw); (c) a leading `system` message is NOT specially pinned in this plan (budget is the sole selector) — documented simplification; (d) whitespace-only content estimates to a small positive count.

**Test cases (write first, TDD):**
- `estimateTokens('')` is `0`; `estimateTokens` of a 400-char string is `100`; monotonic (longer text → not fewer tokens).
- All messages fit → every message returned in original chronological order; `droppedCount === 0`; `contextTokens` equals the sum.
- Budget forces trimming → only the most-recent messages that fit are returned, oldest dropped first; the **last** (latest user) message is always present; `droppedCount` reflects the trim.
- Latest user turn alone exceeds `budget - reserve` → result is exactly that one message (never empty); `contextMessageCount === 1`.
- `reserveForResponse` reduces effective budget → raising `reserveForResponse` drops more older messages than with reserve `0`.
- Empty history → empty result, no throw.

**Done when:** token test cases green + `tsc --noEmit` clean; commit `feat(api): add token estimation and context-budget windowing`.

---

## Task 3: SSE plumbing — frame writer + heartbeat (ST1/ST2/ST5) (TDD)
**Implements:** the shared SSE abstraction both chat and guest use: correct headers, one JSON object per `data:` line for `start`/`token`/`done`/`error`, and `: ping` comment heartbeats to defeat idle-proxy timeouts.
**Files:**
- Create: `apps/api/src/chat/sse.ts`.
- Test: `apps/api/test/sse.test.ts`.

**Design:**
- **Signatures / types:**
  ```ts
  import type { Response } from 'express';
  import type { Usage } from '@ollive/shared';

  interface SseStartData { messageId: string | null; requestId: string; }
  interface SseTokenData { delta: string; }
  interface SseDoneData  { messageId: string | null; finishReason: string; usage: Usage | null; }
  interface SseErrorData { code: string; message: string; }

  interface SseStream {
    start(data: SseStartData): void;
    token(data: SseTokenData): void;
    done(data: SseDoneData): void;
    error(data: SseErrorData): void;
    close(): void;            // ends the response + clears heartbeat
    readonly ended: boolean;
  }

  function openSse(res: Response, opts?: { heartbeatMs?: number }): SseStream; // default heartbeatMs 15000
  // internal: frame(event, data) → `event: <event>\ndata: <json>\n\n`
  ```
  Wire contract reproduced verbatim (PRD §8.3 / §17 ST2) — each event is `event: <name>` + a single `data:` line of compact JSON, terminated by a blank line:
  ```
  event: start
  data: {"messageId":"m4","requestId":"r-9a…"}

  event: token
  data: {"delta":"Day "}

  event: done
  data: {"messageId":"m4","finishReason":"stop","usage":{"promptTokens":420,"completionTokens":188,"totalTokens":608}}
  ```
  Heartbeat is an SSE comment line (ST5):
  ```
  : ping
  ```
- **Algorithm:** `openSse` writes headers once — `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive` (ST1) — and calls `res.flushHeaders()`. Each emit method writes `frame(event, data)` where `frame` is `` `event: ${event}\ndata: ${JSON.stringify(data)}\n\n` `` (compact single-line JSON; `JSON.stringify` already escapes embedded newlines so a multi-line delta stays on one `data:` line). A `setInterval(heartbeatMs)` writes `: ping\n\n`; `close()` clears it and calls `res.end()` (idempotent — guarded by `ended`). Methods are no-ops once `ended`.
- **Patterns / decisions / edge cases:** thin wrapper around the Express `Response` (no buffering — flush per write so NFR2 ~50ms first-token holds). One JSON object per `data:` line is the ST2 contract; embedded newlines in a delta are safe because `JSON.stringify` escapes them. Heartbeat timer must be cleared on `close()` so it can't keep the event loop alive after the response ends. `ended` guard makes double-`close()` and post-close emits harmless (matters on the cancel path, where close races with the abort handler).

**Test cases (write first, TDD):** drive a fake/mock `Response` (a writable that records chunks; `flushHeaders`/`setHeader` stubbed).
- `openSse` sets `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`.
- `start({messageId:'m4',requestId:'r1'})` writes exactly `event: start\ndata: {"messageId":"m4","requestId":"r1"}\n\n`.
- `token({delta:'Day '})` writes a `token` frame with the delta JSON-encoded; a delta containing a newline stays on a single `data:` line (escaped `\n`).
- `done({messageId:'m4',finishReason:'stop',usage:{promptTokens:1,completionTokens:2,totalTokens:3}})` writes a `done` frame with the usage object.
- `error({code:'rate_limited',message:'…'})` writes an `error` frame.
- heartbeat: with `heartbeatMs: 10`, after ~30ms at least one `: ping\n\n` comment was written; after `close()`, no further pings (timer cleared).
- after `close()`, `ended` is true and subsequent `token()`/`done()` write nothing.

**Done when:** SSE test cases green + `tsc --noEmit` clean; commit `feat(api): add SSE stream helper with typed frames and heartbeat`.

---

## Task 4: Streaming engine — `runChatStream` (abort, forward, finalize) (TDD)
**Implements:** the shared engine that drives an injected `LLMProvider` over SSE for BOTH chat and guest: per-request `AbortController`, client-close → abort wiring (ST4), delta forwarding (FR2/NFR2), completion capture (usage/finishReason), and mid-stream error → `error` event + clean close (ST6). Provider-agnostic and persistence-agnostic — callbacks let each route plug in its own persistence/finalization.
**Files:**
- Create: `apps/api/src/chat/run-chat.ts`.
- Create: `apps/api/test/fakes.ts` — `FakeChatProvider` (authored here, reused by Tasks 5–6).
- Test: covered by the chat/guest integration suites (Tasks 5, 6); this task ends with `tsc --noEmit` + the fakes compiling. (The engine is exercised end-to-end through real routes, not in isolation, to avoid a redundant mock-Response harness.)

**Design:**
- **Signatures / types:**
  ```ts
  import type { Request, Response } from 'express';
  import type { LLMProvider, ChatRequest, CallContext } from '@ollive/llm-sdk';
  import type { Usage } from '@ollive/shared';

  interface RunChatArgs {
    req: Request;
    res: Response;
    provider: LLMProvider;          // injected (real instrumented OR fake)
    chatRequest: ChatRequest;       // model + budgeted messages (from Task 2)
    context: CallContext;           // SDK log context: conversationId/messageId/userId + metadata
    messageId: string | null;       // assistant messageId for SSE start/done (null for guest)
    requestId: string;              // surfaced in SSE start; SDK generates its OWN id for the log
    onDelta?(accumulated: string): void;          // optional progress hook (unused by guest)
    onComplete(result: { content: string; usage: Usage | null; finishReason: string }): Promise<void>;
    onCancel(result: { content: string }): Promise<void>;
    onError(result: { content: string; code: string; message: string }): Promise<void>;
  }

  function runChatStream(args: RunChatArgs): Promise<void>;
  // internal: mapProviderError(err) → { code: ErrorSseCode; message: string }
  type ErrorSseCode = 'rate_limited' | 'provider_timeout' | 'provider_error' | 'internal_error';
  ```
  `FakeChatProvider` (test/fakes.ts) — `implements LLMProvider`, constructed with `{ name?, deltas: string[], usage?: Usage, finishReason?, delayMs?, throwAfter?, throwError?, abortAfter? }`. Its `streamChat(req, { signal })` async-generator yields `{ delta }` per scripted delta (optional `delayMs` before the first → measurable TTFT), then a final `{ usage, finishReason }`; throws `throwError` after `throwAfter` deltas; throws an `Error` with `name==='AbortError'` if `signal.aborted` or after `abortAfter` deltas. Never calls a real model. (Mirrors the Plan 2 SDK fake.)
- **Algorithm:** (pseudocode)
  ```
  const sse = openSse(res);
  const ac = new AbortController();
  let cancelled = false;
  req.on('close', () => { if (!sse.ended) { cancelled = true; ac.abort(); } }); // ST4
  sse.start({ messageId, requestId });
  let content = '';
  try {
    let usage = null, finishReason = 'stop';
    for await (const chunk of provider.streamChat(chatRequest, { signal: ac.signal, context })) {
      if (chunk.delta) { content += chunk.delta; sse.token({ delta: chunk.delta }); onDelta?.(content); }
      if (chunk.usage) usage = chunk.usage;
      if (chunk.finishReason) finishReason = chunk.finishReason;
    }
    await onComplete({ content, usage, finishReason });          // persist BEFORE done
    sse.done({ messageId, finishReason, usage });
  } catch (err) {
    if (cancelled || err.name === 'AbortError' || ac.signal.aborted) {
      await onCancel({ content });                                // save partial; NO SSE error event (client already gone)
    } else {
      const { code, message } = mapProviderError(err);            // §18 mapping
      await onError({ content, code, message });
      if (!sse.ended) sse.error({ code, message });               // ST6
    }
  } finally {
    sse.close();
  }
  ```
  `mapProviderError` (§18): an error whose message/name signals a 429/"rate limit"/"resource exhausted" → `rate_limited`; timeout/deadline/`ETIMEDOUT` → `provider_timeout`; anything else from the provider → `provider_error`; a non-provider/internal failure → `internal_error`. Raw provider text is **not** forwarded — a friendly `message` is sent; full detail lives in the SDK log only.
- **Patterns / decisions / edge cases:** template-method/strategy via the three `on*` callbacks keeps the engine free of persistence concerns so chat and guest reuse it verbatim (DRY). The SDK owns log status classification — the engine never calls a sink; it just drives the provider and the SSE. **Cancel detection** is the response `close` event firing the `AbortController`; the SDK sees the `AbortError` from the same signal and logs `cancelled`, while `onCancel` persists the partial. On cancel we do **not** emit an SSE `error` (the socket is already closing). `onComplete` runs **before** `sse.done` so a client that acts on `done` (e.g. refetch title) sees a consistent DB. `onError`/`onCancel` are awaited but their own failures are swallowed in `finally` so the stream always closes (chat never wedges). Edge case: zero deltas then a clean finish → empty `content`, still `onComplete` + `done`.

**Test cases (write first, TDD):** none in isolation — fully exercised by Tasks 5 & 6 (event sequence, cancel-partial, mid-stream error, no-real-Gemini). This task's gate is `tsc --noEmit` clean and `FakeChatProvider` compiling against the `LLMProvider` interface.

**Done when:** `tsc --noEmit` clean; `FakeChatProvider` type-checks against `@ollive/llm-sdk`'s `LLMProvider`; commit `feat(api): add shared SSE chat-streaming engine with abort and error mapping`.

---

## Task 5: Auto-naming side-effect — `generateTitle` + `maybeAutoName` (BE12/FR17/FR18) (TDD)
**Implements:** async LLM auto-naming after the first assistant response: if `title_source='default'`, generate a ≤6-word title via the injected provider (tagged `metadata.kind='title_generation'`), set it + `title_source='auto'`; failures leave the default intact; never blocks the user's stream.
**Files:**
- Create: `apps/api/src/chat/naming.ts`.
- Test: `apps/api/test/naming.test.ts` — focused unit cases for the pure `cleanTitle` helper. The full async side-effect (`maybeAutoName` setting `title`/`title_source`, FR18 no-clobber, FR17 failure-leaves-default) is verified end-to-end through the chat route in `apps/api/test/chat.int.test.ts` (Task 6).

**Design:**
- **Signatures / types:**
  ```ts
  import type { Db } from '@ollive/db';
  import type { LLMProvider } from '@ollive/llm-sdk';

  function cleanTitle(raw: string, maxWords?: number): string; // default maxWords 6; pure

  async function generateTitle(
    provider: LLMProvider, model: string,
    firstUserText: string, firstAssistantText: string,
  ): Promise<string>;

  // Fire-and-forget: callers DO NOT await this on the hot path.
  function maybeAutoName(deps: {
    db: Db; provider: LLMProvider; model: string; logger?: { warn: Function };
  }, conversationId: string): void;
  ```
- **Algorithm:**
  - `cleanTitle(raw, maxWords=6)` — trim; strip surrounding quotes and a trailing period; collapse whitespace; take the first `maxWords` words; if empty after cleaning, return `'New conversation'` (so a junk model reply never blanks the title). Pure.
  - `generateTitle` — build a one-shot `ChatRequest` (model = `model`, a `system` instruction "Generate a concise title of at most 6 words; no quotes, no punctuation" + a `user` message containing the first exchange), call `provider.streamChat(req, { context: { metadata: { kind: 'title_generation' } } })`, concatenate the `delta`s, `cleanTitle` the result. Because it goes through the injected (instrumented) provider, the SDK logs it as a normal inference with `metadata.kind='title_generation'` (observable in the same dashboards, §23). Caps the input exchange length to keep the title prompt small.
  - `maybeAutoName(deps, conversationId)` — fire-and-forget: re-read the conversation row; if `titleSource !== 'default'` → return (FR18 — never clobber `user`/`auto`). Read the first user + first assistant message (lowest `sequence` of each role). `await generateTitle`; then `UPDATE conversations SET title = $t, title_source = 'auto', updated_at = now() WHERE id = $id AND title_source = 'default'` (the guarded `WHERE` makes it race-safe against a concurrent user rename). On any throw → `logger?.warn` and swallow (FR17: failure leaves the default; retried on the next response). The function returns `void` immediately; the work runs on a detached promise.
- **Patterns / decisions / edge cases:** fire-and-forget side-effect (never awaited on the stream path — BE12/§7.2 step 6); `title_source` provenance flag (never string comparison — A12/FR18); the guarded conditional `UPDATE` (`AND title_source='default'`) is the concurrency safety net so a rename landing mid-generation wins. The title call reuses the provider+SDK path so it is logged like any other call (so guest auto-naming would also appear, but guest conversations are never persisted so `maybeAutoName` is **only** called from the authenticated chat route). Edge cases: model returns an over-long or quoted title → `cleanTitle` normalizes; model returns empty/whitespace → keep `'New conversation'`; conversation already `auto`/`user` → no-op.

**Test cases (write first, TDD):** direct `cleanTitle` unit checks, plus behaviors verified through the chat integration suite (Task 6):
- `cleanTitle('"Trip planning to Kyoto."')` → `'Trip planning to Kyoto'` (quotes + trailing period stripped).
- `cleanTitle('one two three four five six seven eight')` → first 6 words only.
- `cleanTitle('   ')` → `'New conversation'`.
- (integration, Task 6) first response on a `title_source='default'` conversation → after `done`, the row's `title` is the generated title and `title_source='auto'`.
- (integration, Task 6) a conversation with `title_source='user'` → title unchanged after a response (FR18).
- (integration, Task 6) `generateTitle` throwing → conversation keeps `title='New conversation'`, `title_source='default'` (FR17), stream still completed successfully.

**Done when:** `cleanTitle` unit cases green + `tsc --noEmit` clean (full behavior validated in Task 6); commit `feat(api): add async LLM auto-naming with title_source guard`.

---

## Task 6: Chat handler — `POST /v1/conversations/:id/messages` (BE4/§7.2/§8.3/ST4/ST6) (TDD, supertest + real Postgres)
**Implements:** the authenticated streaming chat endpoint: load+scope conversation (404 if not owned — SE8/§18), persist the user message at the next sequence, pre-create the empty assistant message (`status='partial'`), build budgeted context (Task 2), open SSE, drive `runChatStream` (Task 4) with the injected provider, finalize the assistant message on complete/cancel/error, and trigger auto-naming (Task 5) after the first response. Mounts `chatRouter` in `createApp` and extends `AppDeps` with the provider DI seam.
**Files:**
- Create: `apps/api/src/routes/chat.ts`.
- Edit: `apps/api/src/app.ts` — `AppDeps += chatProvider`; mount `chatRouter` at the FUTURE point.
- Test: `apps/api/test/chat.int.test.ts` (supertest + real Postgres; inject `FakeChatProvider`).

**Design:**
- **Signatures / types:**
  ```ts
  // app.ts — the DI seam (the key testability decision)
  interface AppDeps {
    db: Db; redis: Redis; config: AppConfig; logger?: Logger;
    chatProvider: LLMProvider;       // injected instrumented provider (prod) OR FakeChatProvider (tests)
  }

  // routes/chat.ts
  interface ChatRouterDeps { db: Db; config: AppConfig; chatProvider: LLMProvider; logger?: Logger; }
  function chatRouter(deps: ChatRouterDeps): Router; // POST /:id/messages (mounted at /v1/conversations)

  const chatBodySchema = z.object({ content: z.string().min(1) }); // §8.3
  ```
- **Algorithm:** route handler (after `requireAuth` set `req.user`):
  ```
  body = chatBodySchema.parse(req.body)                       // 400 validation_error on fail (BE3)
  conv = SELECT * FROM conversations WHERE id=:id AND user_id=req.user.id   // SE8
  if (!conv) throw AppError('not_found')                      // 404 — also covers not-owned (no leak)
  history = SELECT role,content FROM messages WHERE conversation_id=:id ORDER BY sequence
  // persist user message at next sequence (transactional, monotonic)
  txn:
    maxSeq = SELECT max(sequence) FROM messages WHERE conversation_id=:id  (0 if none)
    userMsg = INSERT messages (conv, role='user', content=body.content, sequence=maxSeq+1, status='complete')
    asstMsg = INSERT messages (conv, role='assistant', content='', sequence=maxSeq+2, status='partial')  // pre-create, get id
  requestId = randomUUID()
  ctx = buildContext([...history, {role:'user',content:body.content}], config.contextTokenBudget, RESERVE)
  chatRequest = { model: conv.model, messages: ctx.messages }
  callContext = { conversationId: conv.id, messageId: asstMsg.id, userId: req.user.id,
                  metadata: { contextMessages: ctx.contextMessageCount, contextTokens: ctx.contextTokens } }
  isFirstResponse = (maxSeq === 0)                            // this is turn 1
  await runChatStream({
    req, res, provider: deps.chatProvider, chatRequest, context: callContext,
    messageId: asstMsg.id, requestId,
    onComplete: ({content, usage, finishReason}) =>
      UPDATE messages SET content, token_count = usage?.completionTokens ?? estimateTokens(content),
             status='complete' WHERE id=asstMsg.id;
      UPDATE conversations SET updated_at=now() WHERE id=conv.id;
      if (isFirstResponse) maybeAutoName({db, provider, model: conv.model, logger}, conv.id);  // fire-and-forget
    onCancel: ({content}) => UPDATE messages SET content, status='partial' WHERE id=asstMsg.id;  // ST4
    onError:  ({content}) => UPDATE messages SET content, status='error'   WHERE id=asstMsg.id;  // ST6
  })
  ```
  `RESERVE` (response headroom) is a module constant (e.g. `1024`) subtracted from the budget per A3/BE5.
- **Patterns / decisions / edge cases:** request validation (BE3) before any write; ownership scoping returns `404 not_found` for both unknown and not-owned conversations (no existence leak, SE8/§18). User + pre-created assistant messages are inserted in one transaction so the `(conversation_id, sequence)` unique constraint can't interleave with a concurrent turn; the assistant row starts `status='partial'` and is promoted to `complete` only on success (so a dropped connection leaves a truthful `partial`). `isFirstResponse` is computed from `maxSeq===0` (turn 1) so auto-naming fires exactly once. The SDK generates its own log `requestId`; the SSE `requestId` here is a separate correlation value surfaced to the client. The route never awaits telemetry (the injected provider is already instrumented; logging is fire-and-forget inside the SDK). `token_count` prefers the provider's `usage.completionTokens`, falling back to `estimateTokens(content)` for cancel/partial.

**Test cases (write first, TDD — supertest, real Postgres, `FakeChatProvider` injected via `createApp({...deps, chatProvider})`; auth stubbed so `req.user` is a seeded user; `afterEach` truncates messages/conversations):**
- happy path → response is `text/event-stream`; the raw body parses into the ordered event sequence `start` → one or more `token` (deltas concatenate to the scripted reply) → `done` (with `finishReason='stop'` and the scripted `usage`); the `messages` table has the user row (`status='complete'`) and the assistant row updated to `content`=full reply, `status='complete'`, `token_count` set; `conversations.updated_at` advanced; **no real Gemini call** (fake provider only).
- sequence numbering → after two turns, message sequences are `1,2,3,4` with no gaps/dupes (the unique constraint held).
- not-owned / unknown conversation → `404 { error: 'not_found' }`; no message rows written.
- validation → empty `content` → `400 { error: 'validation_error' }`; nothing written.
- cancel (ST4) → with a `FakeChatProvider` set to `abortAfter: 1` and the supertest client aborting the request after the first token, the assistant row ends `status='partial'` with the partial content saved; no `error` event was emitted; (the SDK would log `cancelled` — not asserted here, that is Plan 3's pipeline).
- mid-stream error (ST6) → `FakeChatProvider` throwing a rate-limit error after 1 delta → the stream emits an `error` event with `code='rate_limited'`; assistant row ends `status='error'` with the partial content; stream closed cleanly (no hang).
- auto-naming (BE12) → first response on a `title_source='default'` conversation → after the stream, the conversation `title` equals the fake-provider title-generation reply (cleaned) and `title_source='auto'`; a `title_source='user'` conversation is left unchanged (FR18); a title-generation throw leaves `title='New conversation'`/`'default'` and the main stream still succeeded (FR17).

**Done when:** chat integration cases green against real Postgres + `tsc --noEmit` clean; commit `feat(api): add streaming chat endpoint with persistence, cancel, and auto-naming`.

---

## Task 7: Guest chat — `POST /v1/guest/messages` (BE10/§8.3/IN8) (TDD, supertest + real Redis)
**Implements:** the no-persistence guest streaming endpoint: enforce the guest cap via `checkAndIncrementGuest` (403 `login_required` with `{ remaining }` past the cap — §18), stream the reply through the same `runChatStream` engine, and tag the SDK log with `metadata.guestSessionId` + null conversation/user ids (IN8). Writes nothing to Postgres.
**Files:**
- Create: `apps/api/src/routes/guest.ts`.
- Edit: `apps/api/src/app.ts` — mount `guestChatRouter` at the FUTURE point.
- Test: `apps/api/test/guest.int.test.ts` (supertest + real Redis; inject `FakeChatProvider`).

**Design:**
- **Signatures / types:**
  ```ts
  interface GuestRouterDeps { redis: Redis; config: AppConfig; chatProvider: LLMProvider; logger?: Logger; }
  function guestChatRouter(deps: GuestRouterDeps): Router; // POST /messages (mounted at /v1/guest), behind guestSession

  // §8.3: history the client holds locally, plus the new user message
  const guestBodySchema = z.object({
    messages: z.array(z.object({ role: z.enum(['user','assistant']), content: z.string() })).max(?), // bounded
    content: z.string().min(1),
  });
  ```
  403 wire shape reproduced verbatim (PRD §8.3):
  ```json
  { "error": "login_required", "remaining": 0 }
  ```
- **Algorithm:** route handler (after `guestSession` set `req.guest`):
  ```
  body = guestBodySchema.parse(req.body)                                  // 400 on fail
  { allowed, remaining } = await checkAndIncrementGuest(redis, req.guest.id,
                              config.guestMessageLimit, config.guestSessionTtl)
  if (!allowed) return res.status(403).json({ error: 'login_required', remaining })   // §18, NOT an AppError (custom body w/ remaining)
  requestId = randomUUID()
  ctx = buildContext([...body.messages, {role:'user',content:body.content}],
                     config.contextTokenBudget, RESERVE)                  // reuse Task 2
  chatRequest = { model: config.defaultModel, messages: ctx.messages }    // guest uses DEFAULT_MODEL (no conversation row)
  callContext = { metadata: { guestSessionId: req.guest.id,
                              contextMessages: ctx.contextMessageCount, contextTokens: ctx.contextTokens } } // null conv/user ids (IN8)
  await runChatStream({
    req, res, provider: deps.chatProvider, chatRequest, context: callContext,
    messageId: null, requestId,
    onComplete: async () => {},   // NO persistence (BE10)
    onCancel:   async () => {},
    onError:    async () => {},
  })
  ```
- **Patterns / decisions / edge cases:** the cap is enforced **server-side** (Redis counter via Plan 4's `checkAndIncrementGuest`) so it can't be bypassed by client tampering (SE10/AC18); the increment happens **before** streaming so an in-flight call still counts. The 403 is sent as a plain JSON response (not an `AppError`) because §8.3 mandates the extra `{ remaining }` field beyond the standard `{ error }` shape. `messageId: null` and empty `on*` callbacks make the guest path persistence-free while reusing the exact streaming engine (DRY). `callContext` carries `guestSessionId` and omits conversation/user ids so the SDK log lands with null `conversation_id`/`user_id` (IN8) yet still feeds provider/model/latency/token dashboards. Auto-naming is **never** called here (no conversation). Model is `config.defaultModel` since there is no conversation row to read `provider`/`model` from. `messages` array is length-bounded (`.max`) to the guest limit + a small margin to refuse oversized client payloads.

**Test cases (write first, TDD — supertest, real Redis, `FakeChatProvider` injected; `guestSession` issues a guest cookie; `afterEach` flushes the guest Redis keys):**
- under cap → `text/event-stream` with the `start`→`token`→`done` sequence (deltas concatenate to the scripted reply); **no rows** in `messages`/`conversations` (assert counts unchanged); the Redis guest counter incremented; no real Gemini call.
- at/over cap → after `GUEST_MESSAGE_LIMIT` accepted turns, the next request → `403 { error: 'login_required', remaining: 0 }`; nothing streamed; no provider call made.
- validation → empty `content` → `400 { error: 'validation_error' }`.
- guestSessionId on the log context → assert (via a spy/fake provider that records the `context` it was called with) that `context.metadata.guestSessionId === req.guest.id` and `context.conversationId`/`context.userId` are absent (IN8).
- cancel on guest → client aborts mid-stream → stream closes cleanly, still no persistence, no error event.

**Done when:** guest integration cases green against real Redis + `tsc --noEmit` clean; commit `feat(api): add guest chat endpoint with server-enforced cap and no persistence`.

---

## Task 8: Metrics query params + SQL builders (BE7/§8.5/SE8) (TDD)
**Implements:** the pure pieces of the metrics surface — Zod parsing/normalization of `from/to/provider/model/bucket` and parameterized Drizzle `sql` builders for the five aggregations (latency percentiles via `percentile_cont`, throughput per interval, error rate from `status`, token sums, time-bucketed series via `date_trunc`). All scoped by a `userId` bind so SE8 holds at the SQL layer.
**Files:**
- Create: `apps/api/src/metrics/params.ts`.
- Create: `apps/api/src/metrics/sql.ts`.
- Test: `apps/api/test/metrics-sql.test.ts` (pure: bucket→interval mapping + param coercion/validation; the SQL execution is covered by Task 9's integration test).

**Design:**
- **Signatures / types:**
  ```ts
  import { sql, type SQL } from 'drizzle-orm';

  type Bucket = '1m' | '5m' | '1h' | '1d';
  interface MetricFilters {
    from: Date; to: Date;
    provider?: string; model?: string;
    bucket?: Bucket;                 // series endpoints only
    userId: string;                  // ALWAYS set by the route from req.user.id (SE8)
  }

  function parseMetricQuery(query: unknown, userId: string): MetricFilters; // Zod; defaults from=to-24h, to=now, bucket='1m'
  function bucketToInterval(b: Bucket): string;   // '1m'→'1 minute', '5m'→'5 minutes', '1h'→'1 hour', '1d'→'1 day'

  // SQL builders — each returns a Drizzle SQL fragment/full statement, all params bound (no string interpolation, SE5)
  function whereClause(f: MetricFilters): SQL;     // created_at BETWEEN + user_id = + optional provider/model
  function overviewQuery(f: MetricFilters): SQL;   // single-row: requests,errorRate,p50/p95/p99,tokens,throughputPerMin
  function latencyseriesQuery(f: MetricFilters): SQL;    // per-bucket p50/p95/p99 + count
  function throughputSeriesQuery(f: MetricFilters): SQL; // per-bucket request count (→ requests/interval)
  function errorSeriesQuery(f: MetricFilters): SQL;      // per-bucket total/errors → errorRate
  function tokenSeriesQuery(f: MetricFilters): SQL;      // per-bucket prompt/completion/total sums
  ```
- **Algorithm:**
  - `parseMetricQuery` — Zod schema: `from`/`to` as ISO datetimes (`z.coerce.date()`), defaulting `to=now()` and `from=to-24h` when absent; `provider`/`model` optional non-empty strings; `bucket` enum defaulting `'1m'`. Reject `from > to`. Always inject `userId` (caller-supplied from `req.user.id`) — never read from the query (SE8).
  - `bucketToInterval` — map the four buckets to Postgres interval literals used in `date_trunc`/`date_bin`. (Use `date_bin('<interval>', created_at, $epoch)` for arbitrary buckets, or `date_trunc` for the `'1m'/'1h'/'1d'` natural units; `'5m'` requires `date_bin`. Implementer picks one consistent approach — `date_bin` works for all four.)
  - `whereClause` — `sql\`created_at >= ${f.from} and created_at < ${f.to} and user_id = ${f.userId}\`` plus `and provider = ${f.provider}` / `and model = ${f.model}` appended only when present. **Every value is a bound parameter** (SE5) — no template string concatenation of user input.
  - `overviewQuery` — one row: `count(*) as requests`; `avg(case when status='error' then 1 else 0 end) as error_rate`; `percentile_cont(0.5/0.95/0.99) within group (order by latency_ms)` for p50/p95/p99 (filtered to non-null latency); `sum(prompt_tokens)/sum(completion_tokens)/sum(total_tokens)`; `throughputPerMin = requests / max(extent_minutes, 1)` where `extent_minutes` derives from `(to - from)` in minutes.
  - `*SeriesQuery` — `select date_bin(${interval}, created_at, ${epoch}) as t, <aggregates> ... where <whereClause> group by t order by t`. Latency series uses the same `percentile_cont` per bucket + `count(*)`. Error series emits `count(*) as count` + `sum(case when status='error' …) as errors` (route computes `errorRate=errors/count`). Token series sums the three token columns per bucket. Throughput series is `count(*)` per bucket (route divides by interval length for requests/interval if needed; §8.5's throughput series shows per-interval counts).
- **Patterns / decisions / edge cases:** parameterized SQL via Drizzle's `sql` tagged template — never string-built (SE5/BE7). `percentile_cont` for latency percentiles and `date_bin` for uniform time-bucketing are the §8.5/BE7-mandated approach. `user_id = $userId` is baked into `whereClause`, so **every** metric query is user-scoped at the SQL layer (SE8) — the route cannot forget it. Latency percentiles ignore rows with null `latency_ms` (error/cancelled-before-first-token logs) via a `filter (where latency_ms is not null)` or `within group` over non-null. Empty range → zero rows → the route coerces to `requests:0, errorRate:0, latencyMs all null/0, empty series` (no divide-by-zero). `from`/`to` are `Date`s bound as `timestamptz` params.

**Test cases (write first, TDD — pure unit, no DB):**
- `bucketToInterval` maps `'1m'/'5m'/'1h'/'1d'` to the four interval literals.
- `parseMetricQuery` with no `from`/`to` → `to≈now`, `from≈to-24h`, `bucket='1m'`, `userId` set from the argument (not from the query even if the query carries a `userId`).
- `parseMetricQuery` with `from>to` → throws (validation).
- `parseMetricQuery` with `bucket='5m'`, `provider='google'`, `model='gemini-2.5-flash'` → all carried into `MetricFilters`.
- `parseMetricQuery` ignores a `userId` present in the raw query (proves SE8 — the bind comes only from the trusted argument).
- the builder functions return SQL objects whose param array contains the bound `from`, `to`, and `userId` values (assert via Drizzle's `.toSQL()`/params introspection that user input is parameterized, not inlined).

**Done when:** metrics-sql unit cases green + `tsc --noEmit` clean; commit `feat(api): add metrics query parsing and parameterized SQL builders`.

---

## Task 9: Metrics router — `GET /v1/metrics/*` (BE7/§8.5/FR12/SE8) (TDD, supertest + real Postgres)
**Implements:** the five metrics endpoints, executing the Task 8 builders, shaping responses **exactly** per §8.5, all behind `requireAuth` and scoped to `req.user.id` (SE8). Mounts `metricsRouter` in `createApp`.
**Files:**
- Create: `apps/api/src/routes/metrics.ts`.
- Edit: `apps/api/src/app.ts` — mount `metricsRouter` at the FUTURE point (behind `requireAuth`).
- Test: `apps/api/test/metrics.int.test.ts` (supertest + real Postgres; seed `inference_logs` rows directly).

**Design:**
- **Signatures / types:**
  ```ts
  interface MetricsRouterDeps { db: Db; logger?: Logger; }
  function metricsRouter(deps: MetricsRouterDeps): Router;
  // GET /overview, /latency, /throughput, /errors, /tokens  (mounted at /v1/metrics, all behind requireAuth)
  ```
  Response shapes reproduced verbatim (PRD §8.5) — the route must match these exactly:
  ```json
  // GET /v1/metrics/overview
  {
    "range": { "from": "2026-05-23T00:00:00Z", "to": "2026-05-23T12:00:00Z" },
    "requests": 1840, "errorRate": 0.021,
    "latencyMs": { "p50": 740, "p95": 1820, "p99": 3110 },
    "tokens": { "prompt": 612000, "completion": 244000, "total": 856000 },
    "throughputPerMin": 2.6
  }
  ```
  ```json
  // GET /v1/metrics/latency?bucket=1m
  {
    "bucket": "1m",
    "series": [
      { "t": "2026-05-23T10:00:00Z", "p50": 690, "p95": 1700, "p99": 2900, "count": 12 },
      { "t": "2026-05-23T10:01:00Z", "p50": 720, "p95": 1810, "p99": 3050, "count": 15 }
    ]
  }
  ```
- **Algorithm:** each handler: `filters = parseMetricQuery(req.query, req.user.id)` (400 on invalid) → `db.execute(<builder>(filters))` → map DB rows to the §8.5 shape → `200`. `overview`: single row → `{ range:{from,to}, requests, errorRate, latencyMs:{p50,p95,p99}, tokens:{prompt,completion,total}, throughputPerMin }` (round percentiles to integers, errorRate to 3 dp, coerce nulls to 0). `latency`/`throughput`/`errors`/`tokens`: `{ bucket, series: [...] }` — map each bucket row to the documented per-point shape (`latency`→`{t,p50,p95,p99,count}`; `throughput`→`{t,count}` (or `requestsPerInterval`); `errors`→`{t,count,errors,errorRate}`; `tokens`→`{t,prompt,completion,total}`). Numeric columns arriving as strings (postgres.js NUMERIC/bigint) are coerced to `number`.
- **Patterns / decisions / edge cases:** thin route over pure builders (BE7). `requireAuth` + `parseMetricQuery(req.query, req.user.id)` means the user scope is taken from the verified session, never the query (SE8/AC defense). Response shapes are pinned to §8.5 — the integration test asserts the exact keys. Empty range → `requests:0`, `errorRate:0`, percentile fields `0` (or null per the test's choice — be consistent), `series:[]`. `from`/`to` echoed back in `range`. Percentiles and counts coerced from string→number. `bucket` echoed from the parsed filter.

**Test cases (write first, TDD — supertest, real Postgres, `requireAuth` stubbed to a seeded user; seed `inference_logs` rows directly via Drizzle in `beforeEach`; `afterEach` truncates `inference_logs`):**
- overview aggregation → seed N success rows + M error rows with known `latency_ms`/token values for the user, within range → `requests===N+M`, `errorRate≈M/(N+M)`, `latencyMs.p50/p95/p99` match the seeded distribution (within rounding), `tokens.{prompt,completion,total}` equal the seeded sums, `throughputPerMin` matches count/extent.
- user scoping (SE8) → seed rows for the authed user AND a second user; the response counts/sums include ONLY the authed user's rows (the other user's rows are excluded).
- provider/model filters → `?provider=google&model=gemini-2.5-flash` excludes rows of other providers/models.
- time-range filter → rows outside `[from,to)` are excluded; `range.from`/`range.to` echo the parsed values.
- latency series buckets → `?bucket=1m` → `series` has one point per minute that has rows, each with `p50/p95/p99/count`, ordered by `t` ascending.
- throughput / errors / tokens series → each returns `{ bucket, series }` with the documented per-point keys; error series `errorRate` per bucket matches `errors/count`; token series sums per bucket match seeded values.
- empty range → `requests:0`, `errorRate:0`, empty `series` (no throw, no divide-by-zero).
- invalid query (`from>to`) → `400 { error: 'validation_error' }`.
- unauthenticated (no `req.user`) → `401 { error: 'unauthorized' }` (via `requireAuth`).

**Done when:** metrics integration cases green against real Postgres + `tsc --noEmit` clean; commit `feat(api): add user-scoped metrics endpoints over inference_logs`.

---

## Task 10: Wire the provider DI seam in `server.ts` + `.env.example` + full-suite green
**Implements:** the production half of the DI seam — build the instrumented chat provider and inject it into `createApp` — plus closing the SDK transport on graceful shutdown and documenting the new env vars (DE5 partial).
**Files:**
- Edit: `apps/api/src/server.ts` — build `chatProvider` and pass it to `createApp`; close the transport on shutdown.
- Edit: `.env.example` — append the chat vars.
- Edit: `apps/api/test/*` as needed so the full `--project api` suite passes alongside Plans 3 & 4.

**Design:**
- **Algorithm:** in `server.ts`'s `main()`, after `loadConfig()`:
  ```ts
  // pseudocode
  const ingestionUrl = `http://localhost:${config.port}/v1/logs`; // SDK ships to the local receiver (Plan 3)
  const { provider: chatProvider, transport } = withLoggingTransport(
    googleProviderFactory(),
    { ingestionUrl, apiKey: config.ingestionApiKey, redaction: config.piiRedaction },
  );
  const app = createApp({ db, redis, config, logger, chatProvider });
  // ...in shutdown(signal): await transport.close() BEFORE closing db/redis (flush buffered logs)
  ```
  `googleProviderFactory()` constructs the real Gemini adapter (reads `GEMINI_API_KEY` from env per Plan 2); `withLoggingTransport` wraps it so every chat/title/guest call self-instruments to the local `/v1/logs` receiver. The transport's `close()` flushes the buffer on shutdown so in-flight logs are not lost.
- **`.env.example` append:**
  ```dotenv
  # --- Chat (Plan 5) ---
  GEMINI_API_KEY=                       # required; the SDK provider reads this (never sent to the browser)
  DEFAULT_MODEL=gemini-2.5-flash        # A10 default model
  CONTEXT_TOKEN_BUDGET=4000             # A3/BE5 prompt token budget (response headroom reserved internally)
  PII_REDACTION=pattern                 # off | pattern | llm (SDK9; default pattern)
  ```
- **Patterns / decisions / edge cases:** the DI seam is the linchpin testability decision — prod injects the instrumented real provider; tests inject `FakeChatProvider`, so no test path can reach Gemini while runtime still demands a real key. The SDK ships to the **local** `/v1/logs` (same process, Plan 3 receiver) using the existing `INGESTION_API_KEY` — the chat path never blocks on it (SDK4/NFR1/NFR5). Transport `close()` runs in `shutdown` before draining db/redis so buffered logs flush first.

**Test cases (write first, TDD):** none new (process wiring). Verified by the full suite gates:
- `pnpm --filter @ollive/api exec tsc --noEmit` clean (validates `AppDeps.chatProvider`, `withLoggingTransport`/`googleProviderFactory` imports, all route wiring).
- `pnpm exec vitest run --project api` passes the full API suite (Plan 3 + Plan 4 + Plan 5 tests: config, redaction, logs, health, auth/conversations, tokens, sse, metrics-sql, chat, guest, metrics).

**Done when:** full `--project api` suite green (infra up) + `tsc --noEmit` clean + `.env.example` documents the chat vars; commit `feat(api): wire instrumented chat provider DI seam and document chat env vars`.

---

## Definition of Done

- [ ] `pnpm --filter @ollive/api exec tsc --noEmit` passes (incl. the `AppDeps.chatProvider` seam and all new routers).
- [ ] `pnpm exec vitest run --project api` passes: `tokens`, `sse`, `metrics-sql` (unit) + `chat`, `guest`, `metrics` (integration, real Postgres + Redis) + the carried-over Plan 3/4 suites.
- [ ] `pnpm test` passes all projects (Postgres + Redis up).
- [ ] **No test path calls real Gemini** — every chat/guest/auto-name test injects `FakeChatProvider` via `createApp({ …, chatProvider })`.
- [ ] Chat streams the `start`→`token*`→`done` SSE sequence; the assistant message is persisted (`partial`→`complete`); `updated_at` advances.
- [ ] Client-abort → assistant row saved `status='partial'`, no SSE `error` event (ST4); mid-stream provider error → SSE `error` event + `status='error'` row, clean close (ST6).
- [ ] Context windowing trims to the budget while always keeping the latest user turn (BE5/A3); `metadata.contextMessages/contextTokens` carried into the SDK log context.
- [ ] Guest chat enforces the cap server-side (403 `login_required` + `{ remaining }`), streams without persisting, and tags the log context with `guestSessionId` + null conv/user ids (IN8).
- [ ] Auto-naming sets `title`/`title_source='auto'` after the first response only when `title_source='default'`; failures leave the default (FR17/FR18); never blocks the stream.
- [ ] Metrics endpoints return the §8.5 shapes, computed via `percentile_cont` + `date_bin`, parameterized via Drizzle, scoped to `req.user.id` (SE8).
- [ ] `server.ts` builds the instrumented provider via `withLoggingTransport(googleProviderFactory(), …)` and closes the transport on shutdown; `.env.example` documents `GEMINI_API_KEY`/`DEFAULT_MODEL`/`CONTEXT_TOKEN_BUDGET`/`PII_REDACTION`.

### Requirement → task map (coverage check)

| Requirement | Where |
|---|---|
| A3 / BE5 / FR3 — token-budget context window | Task 2; consumed in 6, 7 |
| A4 / FR4 / ST4 — cancel = abort, save partial | Tasks 4, 6 |
| A10 — default model | Tasks 1 (config), 7 (guest uses it) |
| A12 / FR17 / FR18 / BE12 — auto-naming via `title_source` | Tasks 5, 6 |
| FR2 / ST1 / ST2 — SSE streamed reply, event types | Tasks 3, 4, 6 |
| ST5 — heartbeat `: ping` | Task 3 |
| ST6 — mid-stream error → `error` event, persist `error`, clean close | Tasks 4, 6 |
| ST7 — no resumable streams (dropped connection ends generation) | Task 4 (close→abort, no replay) |
| FR8 / FR9 — every LLM call instrumented, off the hot path | Tasks 4, 10 (SDK via injected provider) |
| §18 — provider error mapping to SSE codes | Task 4 (`mapProviderError`) |
| BE4 / §7.2 / §8.3 — chat handler persist→stream→finalize | Task 6 |
| FR15 / FR16 / BE10 / §8.3 / IN8 — guest chat, cap, no persistence, guestSessionId | Task 7 |
| FR12 / BE7 / §8.5 — metrics aggregations + shapes | Tasks 8, 9 |
| SE8 — metrics scoped to user_id | Tasks 8 (whereClause), 9 (route uses req.user.id) |
| OB5 — TTFT captured | Task 4 (SDK measures via the injected instrumented provider) |
| DE5 — chat env vars documented | Tasks 1, 10 |
| Provider DI seam (testability) | Tasks 6 (`AppDeps.chatProvider`), 10 (prod wiring) |

This plan consumes Plan 2 (`withLoggingTransport`/`googleProviderFactory`/`LLMProvider`), Plan 3 (`createApp`/`loadConfig`/`AppError`/`/v1/logs` receiver the SDK ships to), and Plan 4 (`requireAuth`/`guestSession`/`checkAndIncrementGuest` + `conversations`/`messages` tables). Plan 6 (frontend) consumes the SSE + metrics contracts defined here; Plan 7 (deployment) wires `GEMINI_API_KEY` and the new env vars into compose.

> **Cross-plan risk note (Plan 4 drafted in parallel):** this plan pins Plan 4's middleware shapes as `requireAuth(deps)→req.user:{id,email,name?,avatarUrl?}`, `guestSession(deps)→req.guest:{id}`, and `checkAndIncrementGuest(redis,guestId,limit,ttl)→{allowed,remaining}`. If Plan 4 lands with different names/signatures (e.g. `authMiddleware`, `req.auth`, or a different guest-counter return shape), Tasks 6/7 need a thin rename only — the streaming engine, persistence, and SQL are unaffected. The other touch-point is `AppDeps`: this plan **adds** `chatProvider` to the interface Plan 3 defined and Plan 4 also extends; whoever lands second must union the fields rather than overwrite. The guest config keys (`guestMessageLimit`/`guestSessionTtl`) are owned by Plan 4's config extension — Task 1 here adds only the four chat keys and must not duplicate them.
