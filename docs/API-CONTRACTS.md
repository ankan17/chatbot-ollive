# Ollive — API Contracts (Single Source of Truth)

| | |
|---|---|
| **Status** | **Authoritative.** This document is the single source of truth for all HTTP + SSE contracts between `apps/api` (producer) and `apps/web` (consumer), plus the internal SDK → ingestion contract. |
| **Version** | 1.0 |
| **Date** | 2026-05-23 |
| **Supersedes** | PRD §8 (which this fills in completely), and any conflicting assumption in Plans 4 / 5 / 6. **Where this document and a plan disagree, this document wins** and the plan must be updated to match. |

## How to read this document

- **Base path** for the product API is `/v1`. Auth/OAuth routes live at `/auth/*` (no `/v1` prefix). Health probes live at root (`/healthz`, `/readyz`).
- **Auth model:**
  - **User routes** authenticate with an **httpOnly `session` cookie** (signed JWT, HS256). The browser sends it automatically; clients MUST use `fetch(..., { credentials: 'include' })`. The client never reads or stores the token.
  - **Guest routes** carry an **httpOnly `guest_session` cookie** (signed random id) — also rides along via `credentials: 'include'`.
  - **Ingestion** (`POST /v1/logs`) uses **`Authorization: Bearer <INGESTION_API_KEY>`** — service-to-service auth, fully separate from user auth. No cookie.
- **All JSON bodies** are `Content-Type: application/json` unless the response is an SSE stream (`text/event-stream`).
- **All HTTP errors** use the body shape `{ "error": <code>, "details"?: <unknown> }` (the one exception, `429`, is documented in the Error Catalog).
- **The canonical typed representation of every shape below is the `@ollive/shared/api` module** (spec'd at the end). Request bodies/queries are **Zod schemas** (validated server-side per BE3); responses are **TypeScript types** (used to type server serializers and the frontend client). Producers (Plans 4 & 5) and the consumer (Plan 6) both import from `@ollive/shared/api` so the contract is compiler-enforced at both ends (NFR7).
- **CORS:** `apps/api` allows exactly `WEB_ORIGIN` with `credentials: true` (SE4). Cross-origin cookies require the explicit origin (never `*`).
- **`DEFAULT_MODEL`** is owned by the API config (`DEFAULT_MODEL`, default `gemini-2.5-flash`, A10). New conversations are created with `provider = 'google'` and `model = DEFAULT_MODEL`; the conversation row records the provider/model used (PA4). Guest chat uses `DEFAULT_MODEL` directly (no conversation row).

### Conventions used in the schemas

- All timestamps are **ISO-8601 UTC strings** (e.g. `"2026-05-23T10:01:12.001Z"`), serialized from `timestamptz` columns. Written `ISOString` below.
- All `id` values are **UUID v4 strings** unless noted.
- `?` on a field means **optional / may be omitted** from the JSON. A field typed `T | null` is **always present but may be `null`**. These are distinct and load-bearing (e.g. `nextCursor: string | null` is always present; `tokenCount?` is omitted entirely for user messages).
- A "cursor" is an **opaque** string the client must treat as a black box (it is the last item's id; clients must not parse it).

---

## 1. Auth & Session

### `GET /auth/google`
- **Auth:** none.
- **Request:** no params.
- **Behavior:** sets a short-lived signed `oauth_state` cookie (CSRF) and `302` redirects to the Google consent screen (or, in `AUTH_MODE=dev`, to the API's own callback with a canned `code`).
- **Success:** `302` with `Location` header. No JSON body.
- **Errors:** none under normal operation.

### `GET /auth/google/callback?code=&state=`
- **Auth:** none (this is the OAuth landing).
- **Request — query params:**

  | param | type | required | notes |
  |---|---|---|---|
  | `code` | string | yes | OAuth authorization code (`dev` in dev mode). |
  | `state` | string | yes | Must match the signed `oauth_state` cookie (CSRF). |

- **Behavior (RESOLUTION 6):** verifies `state` (signature + cookie match), exchanges the code for the identity, upserts the user by `google_sub`, **sets the httpOnly `session` cookie**, clears `oauth_state`, then **`302` redirects to `WEB_ORIGIN` root (`/`)**. The SPA, on landing, re-checks `GET /v1/session` and runs guest import (`POST /v1/conversations/import`) if it holds a buffered guest conversation.
- **Success:** `302` to `${WEB_ORIGIN}/`, `Set-Cookie: session=…`.
- **Errors:** on a missing/invalid `code`/`state` or provider failure, the server `302` redirects to `${WEB_ORIGIN}/?auth_error=1` (it does **not** leak provider detail and does **not** return a JSON error body).

### `POST /auth/logout`
- **Auth:** none required (idempotent).
- **Request:** no body.
- **Behavior:** clears the `session` cookie (`Max-Age=0`).
- **Success:** `204 No Content`, no body.

### `GET /auth/me`
- **Auth:** **required** (`session` cookie). This route DOES 401.
- **Request:** none.
- **Success — `200`:**
  ```json
  {
    "user": {
      "id": "f3c…",
      "email": "ankan@hyperverge.co",
      "name": "Ankan",
      "avatarUrl": "https://…"
    }
  }
  ```
  `name` and `avatarUrl` are optional (may be omitted).
- **Errors:** `401 { "error": "unauthorized" }` when the session cookie is absent/invalid/expired.

### `GET /v1/session`  (RESOLUTION 5 — **never 401**)
- **Auth:** none; reads the `session` cookie if present, otherwise falls back to the guest branch. **This route never returns 401** — it drives the UI's guest indicator, so any auth failure degrades to the guest branch.
- **Request:** none. Side effect: if no valid guest cookie exists, it issues a `guest_session` cookie.
- **Success — `200`, one of two discriminated shapes:**
  ```json
  // signed in
  { "authenticated": true, "user": { "id": "f3c…", "email": "ankan@hyperverge.co", "name": "Ankan" } }
  ```
  ```json
  // not signed in
  { "authenticated": false, "guest": { "remaining": 1, "limit": 2 } }
  ```
  - In the authenticated branch, `user` is `{ id, email, name? }` (no `avatarUrl` here; use `/auth/me` for the full profile).
  - In the guest branch, `remaining = max(0, limit - used)` read from the Redis guest counter **without** consuming the trial (polling `/v1/session` never burns a message), and `limit = GUEST_MESSAGE_LIMIT`.

---

## 2. Conversations (incl. import)

All conversation routes require the `session` cookie (`401 unauthorized` otherwise) and are scoped to `req.user.id` (SE8). A conversation owned by another user is reported as `404 not_found` — never another user's data, no existence leak.

### `GET /v1/conversations?status=&limit=&cursor=`  (RESOLUTION 1 — list)
- **Auth:** required.
- **Request — query params:**

  | param | type | required | default | notes |
  |---|---|---|---|---|
  | `status` | `'active' | 'archived'` | no | `active` | filter. |
  | `limit` | integer | no | `20` | 1–100; values above 100 are rejected as `validation_error`. |
  | `cursor` | string (opaque) | no | — | the `nextCursor` from a prior page; the last returned item's id. |

- **Success — `200`:**
  ```json
  {
    "items": [
      {
        "id": "c1a…", "title": "Trip planning", "status": "active",
        "provider": "google", "model": "gemini-2.5-flash",
        "createdAt": "2026-05-23T10:00:00.000Z", "updatedAt": "2026-05-23T10:05:00.000Z"
      }
    ],
    "nextCursor": null
  }
  ```
  - `items` is an array of **`ConversationSummary`** = `{ id, title, status, provider, model, createdAt, updatedAt }`. It contains **NO `messages`** and **NO `title_source`** (provenance is server-internal and never exposed).
  - Ordering: most-recently-updated first (`updatedAt DESC, id DESC`).
  - **`nextCursor: string | null`** — always present. The opaque cursor (last item's id) when more pages exist; **`null`** when there are no more pages.
- **Errors:** `400 validation_error` (bad `status`/`limit`/`cursor`), `401 unauthorized`.

> **Consumer note (Plan 6):** the page wrapper type is `ConversationListPage = { items: ConversationSummary[]; nextCursor: string | null }`. The frontend's draft used `nextCursor?: string`; **this document overrides it** to `nextCursor: string | null` (always present, null-terminated).

### `POST /v1/conversations`
- **Auth:** required.
- **Request body:**

  | field | type | required | notes |
  |---|---|---|---|
  | `title` | string | no | initial title; defaults to `"New conversation"` server-side. |

  ```json
  { "title": "Trip planning" }
  ```
- **Success — `201`** (full `Conversation`, no messages — a new conversation has none):
  ```json
  {
    "id": "c1a…", "title": "New conversation", "status": "active",
    "provider": "google", "model": "gemini-2.5-flash",
    "createdAt": "2026-05-23T10:00:00.000Z", "updatedAt": "2026-05-23T10:00:00.000Z"
  }
  ```
  `provider`/`model` come from API config (`provider='google'`, `model=DEFAULT_MODEL`). `title_source` is set to `'default'` server-side but never serialized.
- **Errors:** `400 validation_error`, `401 unauthorized`.

### `GET /v1/conversations/:id`  (RESOLUTION 2 — detail)
- **Auth:** required.
- **Request — path param:** `id` (conversation UUID).
- **Success — `200`** (`ConversationDetail` = `Conversation` + `messages: Message[]`, per PRD §8.2):
  ```json
  {
    "id": "c1a…", "title": "Trip planning", "status": "active",
    "provider": "google", "model": "gemini-2.5-flash",
    "createdAt": "2026-05-23T10:00:00.000Z", "updatedAt": "2026-05-23T10:05:00.000Z",
    "messages": [
      { "id": "m1", "role": "user", "content": "Plan a 3-day trip to Kyoto",
        "status": "complete", "sequence": 1, "createdAt": "2026-05-23T10:00:01.000Z" },
      { "id": "m2", "role": "assistant", "content": "Day 1 …", "tokenCount": 312,
        "status": "complete", "sequence": 2, "createdAt": "2026-05-23T10:00:05.000Z" }
    ]
  }
  ```
  - **`Message`** = `{ id, role, content, tokenCount?, status, sequence, createdAt }`.
    - `role` ∈ `'user' | 'assistant' | 'system'`.
    - `status` ∈ `'complete' | 'partial' | 'error'`.
    - `tokenCount?` — present on assistant messages once known; **omitted entirely for user messages** (and for assistant messages with no count yet). Distinguish "omitted" from a numeric `0`.
    - Messages are ordered by `sequence ASC`.
- **Errors:** `404 not_found` (unknown id **or** not owned by the caller), `401 unauthorized`.

### `PATCH /v1/conversations/:id`
- **Auth:** required.
- **Request — path param:** `id`. **Body** (at least one field required):

  | field | type | required | notes |
  |---|---|---|---|
  | `title` | string | no | rename; **server also sets `title_source='user'`** so auto-naming never overwrites it (FR18). |
  | `status` | `'active' | 'archived'` | no | archive / unarchive. |

  ```json
  { "title": "Kyoto itinerary", "status": "archived" }
  ```
- **Success — `200`:** the updated `Conversation` (same shape as `POST`). `updatedAt` is bumped.
- **Errors:** `400 validation_error` (empty body / bad enum), `404 not_found` (unknown or not owned), `401 unauthorized`.

### `POST /v1/conversations/import`  (RESOLUTION 7 — import buffered guest conversation)
- **Auth:** required.
- **Request body:**

  | field | type | required | notes |
  |---|---|---|---|
  | `clientConversationId` | string (1–200) | no | **opaque idempotency key** generated by the client (e.g. `crypto.randomUUID()`). |
  | `messages` | `{ role, content }[]` (min 1) | yes | the buffered guest exchange; `role` ∈ `'user' | 'assistant'` only (`system` is rejected). `content` non-empty. |

  ```json
  {
    "clientConversationId": "c-local-7f…",
    "messages": [
      { "role": "user", "content": "Plan a 3-day trip to Kyoto" },
      { "role": "assistant", "content": "Day 1 …" }
    ]
  }
  ```
- **Behavior & idempotency (authoritative):**
  - The server persists the messages as a **new conversation** owned by the caller, assigning sequences `1..N` in array order, each `status='complete'`, `tokenCount` null (omitted in serialization). `title='New conversation'`, **`title_source='default'`** (so Plan 5's auto-naming runs against the imported exchange), `provider='google'`, `model=DEFAULT_MODEL`.
  - **Idempotency is keyed on the optional `clientConversationId`** scoped per user. It is persisted to a **new nullable `conversations.client_conversation_id` column** with a **partial-unique index on `(user_id, client_conversation_id)` where `client_conversation_id is not null`**. The conversation's primary key remains a **random UUID** (not a hashed/derived PK).
  - **Re-importing the same `(user_id, clientConversationId)` returns the existing conversation** (with its messages) instead of duplicating it.
  - When `clientConversationId` is omitted, every import creates a fresh conversation (no dedup).
  - The same `clientConversationId` reused by a **different user** creates a separate conversation (dedup is per-user; the partial-unique index is on the pair).

  > **Schema note:** the `client_conversation_id` column + partial-unique index is a **Plan-4 migration on `@ollive/db`** (the `conversations` table as currently defined in `packages/db/src/schema.ts` does not have it). This **supersedes** Plan 4's drafted "UUIDv5-derived primary key" idempotency approach — use the dedicated column instead.
- **Success — `201`:** the full `ConversationDetail` (`Conversation` + `messages: Message[]`), same shape as `GET /v1/conversations/:id`.
- **Errors:** `400 validation_error` (empty `messages`, `system` role, bad shape), `401 unauthorized`.

---

## 3. Chat (SSE) & Guest Chat

Both endpoints stream **Server-Sent Events** over the POST response. The frontend consumes them via `fetch` + `ReadableStream` (NOT `EventSource`, which cannot POST — ST3/FE9).

### SSE transport (shared by both endpoints)
- **Response headers:** `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive` (ST1). HTTP status is `200` for any stream that opens (errors that occur after the stream opens are delivered as `error` **events**, not HTTP status codes).
- **Frame format (ST2):** one event per frame — an `event:` line and a single `data:` line of **compact single-line JSON**, terminated by a blank line. Embedded newlines in a delta are safe (JSON-escaped). Example:
  ```
  event: start
  data: {"messageId":"m4","requestId":"r-9a…"}

  event: token
  data: {"delta":"Day "}

  event: token
  data: {"delta":"2 we "}

  event: done
  data: {"messageId":"m4","finishReason":"stop","usage":{"promptTokens":420,"completionTokens":188,"totalTokens":608}}
  ```
- **Heartbeat (ST5):** periodic SSE **comment** lines keep idle proxies from timing out. A comment is a line beginning with `:` and carries no event:
  ```
  : ping
  ```
  Clients MUST ignore comment lines.

### Event sequence & schemas (RESOLUTION 4 — authoritative)

The event sequence is always: **`start`** → **`token`** (zero or more) → **(`done` | `error`)**, interleaved with `: ping` heartbeats.

| event | data schema | when |
|---|---|---|
| `start` | `{ "messageId": string \| null, "requestId": string }` | exactly once, first. `messageId` is the pre-created assistant message id for authed chat; **`null` for guest chat** (no persistence). `requestId` is a correlation id surfaced to the client (the SDK uses its own separate id for the inference log). |
| `token` | `{ "delta": string }` | zero or more, in order. Concatenating all `delta`s yields the assistant reply. |
| `done` | `{ "messageId": string \| null, "finishReason": string, "usage": { "promptTokens": number, "completionTokens": number, "totalTokens": number } }` | terminal, on success. **`usage` is ALWAYS present on `done`** (never null). `finishReason` ∈ `'stop' \| 'length' \| 'content_filter' \| 'error' \| 'cancelled'` (normally `'stop'`). `messageId` mirrors `start`. |
| `error` | `{ "code": string, "message": string }` | terminal, on a mid-stream failure. `code` is one of the SSE error codes (see Error Catalog): `rate_limited`, `provider_timeout`, `provider_error`, `internal_error`. `message` is a friendly, mapped string — raw provider detail is never forwarded (it lives only in the inference log). |

**Cancellation (RESOLUTION 4, ST4):** cancellation is performed by the **client aborting the connection** (`AbortController` / closing the fetch). There is **no cancel endpoint** and **no cancel event**. On client abort:
- The server detects the connection `close`, fires its `AbortController`, which propagates to the provider's `signal` and stops generation.
- The **stream simply closes** — there is **NO `done` event and NO `error` event** (the socket is already gone).
- The server saves the **partial** assistant content (`status='partial'`) and the SDK records the inference log with `status='cancelled'`.
- Clients detect cancel as their own `AbortError` from the fetch read loop (not as an SSE frame).

### `POST /v1/conversations/:id/messages`  (authed chat)
- **Auth:** required (`session` cookie). Scoped to `req.user.id`.
- **Request headers:** `Content-Type: application/json`, `Accept: text/event-stream`.
- **Request — path param:** `id`. **Body:**

  | field | type | required |
  |---|---|---|
  | `content` | string (non-empty) | yes |

  ```json
  { "content": "What about day 2?" }
  ```
- **Behavior:** persists the user message at the next `sequence`, pre-creates an empty assistant message (`status='partial'`, its id becomes `start.messageId`), trims context to the token budget, streams provider deltas as `token` events, and on completion updates the assistant message (`content`, `tokenCount`, `status='complete'`). After the **first** assistant response, if `title_source='default'`, async auto-naming runs (the client should refetch conversation metadata on `done` to pick up the new title — FE11).
- **Success:** `200 text/event-stream` with the event sequence above.
- **Errors (before the stream opens — JSON body):** `400 validation_error` (empty `content`), `404 not_found` (unknown or not-owned conversation), `401 unauthorized`.
- **Errors (after the stream opens — SSE `error` event):** `rate_limited`, `provider_timeout`, `provider_error`, `internal_error`. On these, the partial content is saved with `status='error'` and the stream closes cleanly (ST6).

### `POST /v1/guest/messages`  (guest chat — RESOLUTION 4, no persistence)
- **Auth:** guest (`guest_session` cookie; issued automatically if absent). No user session required.
- **Request headers:** `Content-Type: application/json`, `Accept: text/event-stream`.
- **Request — body** (the client holds the full guest conversation locally and sends it each turn):

  | field | type | required | notes |
  |---|---|---|---|
  | `messages` | `{ role, content }[]` | yes | prior turns; `role` ∈ `'user' \| 'assistant'`. Length-bounded (≈ `GUEST_MESSAGE_LIMIT` + margin). |
  | `content` | string (non-empty) | yes | the new user message. |

  ```json
  {
    "messages": [
      { "role": "user", "content": "Hello" },
      { "role": "assistant", "content": "Hi! How can I help?" }
    ],
    "content": "What about day 2?"
  }
  ```
- **Behavior:** enforces the guest cap server-side (Redis counter, incremented **before** streaming). Streams the reply using the **identical SSE event format** as authed chat, with `start.messageId = null` and `done.messageId = null`. The SDK log carries `metadata.guestSessionId` and null `conversation_id`/`user_id` (IN8). **Writes nothing to Postgres.** Auto-naming never runs here.
- **Success:** `200 text/event-stream` with the same event sequence.
- **Errors:**
  - **`403` past the cap — special body shape (RESOLUTION 4):**
    ```json
    { "error": "login_required", "remaining": 0 }
    ```
    This is the **one** HTTP error that carries an extra field (`remaining`) beyond `{ error, details? }`. Nothing is streamed. The UI blocks the composer and prompts sign-in.
  - `400 validation_error` (empty `content` / bad shape).
  - After-stream-open failures use the same SSE `error` events as authed chat.

---

## 4. Ingestion (internal, service auth)

### `POST /v1/logs`
- **Auth:** **`Authorization: Bearer <INGESTION_API_KEY>`** (service auth, NOT a cookie). Constant-time compared; mismatch → `401`.
- **Request body:** the `InferenceLog` payload defined in `@ollive/shared` (`inferenceLogSchema`, PRD §9). Summary of the wire shape (the schema is the contract; see `packages/shared/src/log.ts`):
  ```jsonc
  {
    "requestId": "r-9a3f…",               // uuid, required, idempotency key
    "timestamp": "2026-05-23T10:01:12.001Z",
    "provider": "google",
    "model": "gemini-2.5-flash",
    "status": "success",                   // 'success' | 'error' | 'cancelled'
    "context": { "conversationId": "c1a…", "messageId": "m4", "userId": "f3c…" }, // all optional
    "timing": { "startedAt": "…", "completedAt": "…", "latencyMs": 1208, "timeToFirstTokenMs": 210 },
    "usage": { "promptTokens": 420, "completionTokens": 188, "totalTokens": 608 }, // nullable
    "preview": { "input": "…", "output": "…" },   // ≤ 500 chars each; re-truncated server-side
    "error": null,                          // or { code, message, providerCode? }
    "metadata": { /* free-form jsonb */ }
  }
  ```
- **Behavior:** API-key auth → Zod validation → `XADD inference-logs` → return immediately (no DB write; the worker persists). NFR3: responds in < 50 ms.
- **Success — `202`:**
  ```json
  { "accepted": true, "requestId": "r-9a…" }
  ```
- **Errors:**
  - `400 { "error": "validation_error", "details": [ … ] }` — malformed payload (Zod field details).
  - `401 { "error": "unauthorized" }` — missing/invalid bearer key.

---

## 5. Metrics  (RESOLUTION 3)

All metrics routes require the `session` cookie (`401 unauthorized` otherwise) and are **scoped to the authenticated user** at the SQL layer (`WHERE user_id = req.user.id`, SE8). The `userId` is taken only from the verified session — never from the query.

### Shared query params

| param | type | required | default | applies to |
|---|---|---|---|---|
| `from` | ISO datetime | no | `to - 24h` | all |
| `to` | ISO datetime | no | now | all |
| `provider` | string | no | — | all (filter) |
| `model` | string | no | — | all (filter) |
| `bucket` | `'1m' \| '5m' \| '1h' \| '1d'` | no | `1m` | **series endpoints only** (`/latency`, `/throughput`, `/errors`, `/tokens`) |

`from > to` → `400 validation_error`. An empty range yields zeroed scalars and empty series (no divide-by-zero). Numeric DB values are coerced to JSON numbers.

### `GET /v1/metrics/overview?from=&to=&provider=&model=`
- **Success — `200`** (exactly per PRD §8.5):
  ```json
  {
    "range": { "from": "2026-05-23T00:00:00.000Z", "to": "2026-05-23T12:00:00.000Z" },
    "requests": 1840,
    "errorRate": 0.021,
    "latencyMs": { "p50": 740, "p95": 1820, "p99": 3110 },
    "tokens": { "prompt": 612000, "completion": 244000, "total": 856000 },
    "throughputPerMin": 2.6
  }
  ```
  - `errorRate` = errored requests / total (0 when `requests=0`), rounded to 3 dp.
  - `latencyMs` percentiles via `percentile_cont` over non-null `latency_ms`, rounded to integers (0 when no data).
  - `range` echoes the parsed `from`/`to`.

### Series endpoints — common envelope

Every series response is:
```json
{ "bucket": "1m", "series": [ /* Point[] */ ] }
```
- `bucket` echoes the parsed `bucket` (default `"1m"`).
- `series` is ordered by `t` ascending; one point per bucket that has data; `t` is the bucket-start ISO timestamp.

### `GET /v1/metrics/latency` — series point: **`{ t, p50, p95, p99, count }`**
```json
{
  "bucket": "1m",
  "series": [
    { "t": "2026-05-23T10:00:00.000Z", "p50": 690, "p95": 1700, "p99": 2900, "count": 12 },
    { "t": "2026-05-23T10:01:00.000Z", "p50": 720, "p95": 1810, "p99": 3050, "count": 15 }
  ]
}
```
- `p50/p95/p99`: `percentile_cont` over non-null `latency_ms` in the bucket (integers). `count`: rows in the bucket.

### `GET /v1/metrics/throughput` — series point: **`{ t, count }`**
```json
{
  "bucket": "1m",
  "series": [
    { "t": "2026-05-23T10:00:00.000Z", "count": 12 },
    { "t": "2026-05-23T10:01:00.000Z", "count": 15 }
  ]
}
```
- `count`: number of requests (rows) in the bucket.

### `GET /v1/metrics/errors` — series point: **`{ t, count, errorCount, errorRate }`**
```json
{
  "bucket": "1m",
  "series": [
    { "t": "2026-05-23T10:00:00.000Z", "count": 12, "errorCount": 1, "errorRate": 0.0833 },
    { "t": "2026-05-23T10:01:00.000Z", "count": 15, "errorCount": 0, "errorRate": 0 }
  ]
}
```
- `count`: total requests in the bucket. `errorCount`: rows with `status='error'`. **`errorRate = errorCount / count`, and `0` when `count = 0`.**

### `GET /v1/metrics/tokens` — series point: **`{ t, promptTokens, completionTokens, totalTokens }`**
```json
{
  "bucket": "1m",
  "series": [
    { "t": "2026-05-23T10:00:00.000Z", "promptTokens": 4200, "completionTokens": 1880, "totalTokens": 6080 },
    { "t": "2026-05-23T10:01:00.000Z", "promptTokens": 5100, "completionTokens": 2100, "totalTokens": 7200 }
  ]
}
```
- Per-bucket sums of `prompt_tokens` / `completion_tokens` / `total_tokens`.

- **Errors (all metrics routes):** `400 validation_error` (bad params, `from > to`), `401 unauthorized`.

> **Consumer note (Plan 6):** the frontend draft had `ThroughputPoint = { t, perMin, count }` and `ErrorPoint = { t, errorRate, count }`. **This document overrides them** to the shapes above: throughput is `{ t, count }`; errors is `{ t, count, errorCount, errorRate }`. The token series uses `promptTokens/completionTokens/totalTokens` (matching the SSE/log `usage` naming), not `prompt/completion/total` — the latter naming is used only in the `overview` `tokens` object.

---

## 6. Health

### `GET /healthz`  (liveness)
- **Auth:** none.
- **Success — `200`:** `{ "status": "ok" }`.

### `GET /readyz`  (readiness)
- **Auth:** none.
- **Success — `200`:** `{ "db": "ok", "redis": "ok" }`.
- **Errors:** `503` with the same shape reporting the failing dependency (e.g. `{ "db": "ok", "redis": "down" }`) when a dependency is unreachable.

---

## 7. Error Catalog  (RESOLUTION 8 — canonical)

All HTTP errors use the body `{ "error": <code>, "details"?: <unknown> }`, except `login_required` on guest chat which additionally carries `remaining`, and `rate_limited` which is emitted by the in-memory IP limiter as `{ "error": "rate_limited" }` (429) outside the typed `AppError` path.

### HTTP errors

| code | HTTP status | transport | when it occurs |
|---|---|---|---|
| `validation_error` | 400 | HTTP body (with `details`) | Zod rejects a request body/query (any endpoint, BE3). |
| `unauthorized` | 401 | HTTP body | Missing/invalid `session` cookie on a protected route, or missing/invalid `INGESTION_API_KEY` on `/v1/logs`. (`GET /v1/session` never emits this.) |
| `login_required` | 403 | HTTP body (`{ error, remaining }`) | Guest message cap exceeded on `POST /v1/guest/messages`. UI blocks composer, prompts sign-in. |
| `not_found` | 404 | HTTP body | Unknown conversation/message id, **or** a resource not owned by the caller (no existence leak, SE8). |
| `rate_limited` | 429 | HTTP body (`{ error }`) | The in-memory IP rate limiter on auth/chat endpoints (SE9/S4). (Distinct from the SSE `rate_limited` event below — same code, different transport.) |
| `internal_error` | 500 | HTTP body | Unexpected server failure. Logged with the correlation id; generic message to the client. |

### SSE `error`-event codes (delivered as a `data:` payload on an `error` frame, never as an HTTP status — the stream is already `200`)

| code | when it occurs |
|---|---|
| `rate_limited` | Provider returned 429 / resource-exhausted mid-stream. Friendly retry message; inference log `status=error`. |
| `provider_timeout` | Provider slow/unreachable past the bounded timeout. Abort + log. |
| `provider_error` | Any other provider failure. Generic message; full detail only in the inference log's `error_message`. |
| `internal_error` | Unexpected failure after the stream opened. Logged with correlation id. |

### Non-error stream-close status

| code | transport | meaning |
|---|---|---|
| `cancelled` | stream close (client abort) + inference-log status | **Not an HTTP error and not an SSE event.** The client aborted; the stream closes with no `done`/`error`; partial content saved (`status='partial'`); inference log recorded with `status='cancelled'`. |

---

## 8. `@ollive/shared/api` module spec

The canonical typed representation of every contract above lives in a new sub-module of the existing `@ollive/shared` package. It follows the package's existing conventions: **Zod 3**, TypeScript source consumed directly (no build step). It is exposed under the dedicated **`@ollive/shared/api` subpath** — the single canonical import path for API DTOs — which all producers/consumers import from.

- **Request bodies/queries → Zod schemas** (validated server-side, BE3). Naming: `<thing>Schema`. TS types inferred from them are exported as `<Thing>` via `z.infer`.
- **Responses → TypeScript types** (used to type server serializers AND the frontend client). Naming: `<Thing>` (interface or type alias). Responses are intentionally **not** runtime-validated server-side (the server produces them) — they are compile-time contracts; the frontend may treat them as the response type of its typed client.

### File layout

```
packages/shared/src/
  enums.ts          # EXISTING — reuse: messageRole, conversationStatus, messageStatus, inferenceStatus, titleSource, errorCategory
  log.ts            # EXISTING — InferenceLog contract (POST /v1/logs)
  api/
    index.ts        # NEW — export * from './common'; './auth'; './conversations'; './chat'; './metrics'; './errors'
    common.ts       # NEW — shared primitives (ISOString brand, usage type re-export, pagination)
    auth.ts         # NEW — session/auth response types + request schemas
    conversations.ts# NEW — Conversation/Message DTOs + list/create/patch/import schemas
    chat.ts         # NEW — chat + guest request schemas + SSE event payload types
    metrics.ts      # NEW — metric query schema + overview/series response types
    errors.ts       # NEW — AppErrorCode / SseErrorCode unions + HTTP error body type
```

The package's `package.json` `exports` map gains the subpath: `"exports": { ".": "./src/index.ts", "./api": "./src/api/index.ts" }`. This is required — an `exports` map blocks undeclared subpaths, so without it `@ollive/shared/api` will not resolve. The root index is NOT changed to re-export `./api`; API DTOs are imported only from `@ollive/shared/api`, keeping the root namespace = enums/log/streams.

### `api/common.ts`

```ts
import { z } from 'zod';
import { usageSchema, type Usage } from '../log';

/** ISO-8601 UTC timestamp string (serialized from timestamptz). */
export type ISOString = string;

// Re-export the canonical token-usage shape (already defined in log.ts) so chat/metrics share it.
export { usageSchema };
export type { Usage };

/** Opaque keyset cursor (the last item's id). Clients treat it as a black box. */
export const cursorSchema = z.string().min(1);

/** Generic page wrapper used by list endpoints. */
export interface Page<T> {
  items: T[];
  nextCursor: string | null; // always present; null on the last page
}
```

### `api/errors.ts`

```ts
import { z } from 'zod';

/** Codes that appear as the `error` field of an HTTP error body. */
export const appErrorCode = z.enum([
  'validation_error', // 400
  'unauthorized',     // 401
  'login_required',   // 403 (guest cap; body also carries `remaining`)
  'not_found',        // 404
  'rate_limited',     // 429 (IP limiter)
  'internal_error',   // 500
]);
export type AppErrorCode = z.infer<typeof appErrorCode>;

/** Codes that appear in an SSE `error` event payload (transport = text/event-stream). */
export const sseErrorCode = z.enum([
  'rate_limited',
  'provider_timeout',
  'provider_error',
  'internal_error',
]);
export type SseErrorCode = z.infer<typeof sseErrorCode>;

/** Standard HTTP error body shape: { error, details? }. */
export interface ApiErrorBody {
  error: AppErrorCode;
  details?: unknown;
}

/** Guest-cap 403 body (the one HTTP error with an extra field). */
export interface LoginRequiredBody {
  error: 'login_required';
  remaining: number;
}
```

### `api/auth.ts`

```ts
import { z } from 'zod';
import type { ISOString } from './common';

/** Full profile (GET /auth/me). */
export interface AuthUser {
  id: string;
  email: string;
  name?: string;
  avatarUrl?: string;
}

/** Slim user echoed inside GET /v1/session (no avatarUrl). */
export interface SessionUser {
  id: string;
  email: string;
  name?: string;
}

/** GET /auth/me → 200 */
export interface MeResponse {
  user: AuthUser;
}

/** GET /v1/session → 200 (discriminated union; never 401). */
export type SessionResponse =
  | { authenticated: false; guest: { remaining: number; limit: number } }
  | { authenticated: true; user: SessionUser };

/** GET /auth/google/callback query (CSRF state round-trip). */
export const oauthCallbackQuerySchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});
export type OauthCallbackQuery = z.infer<typeof oauthCallbackQuerySchema>;
```

### `api/conversations.ts`

```ts
import { z } from 'zod';
import { conversationStatus, messageRole, messageStatus } from '../enums';
import type { ISOString, Page } from './common';

// ---- Response DTOs (TS types) ----

/** List item — NO messages, NO title_source (RESOLUTION 1). */
export interface ConversationSummary {
  id: string;
  title: string;
  status: 'active' | 'archived';
  provider: string;
  model: string;
  createdAt: ISOString;
  updatedAt: ISOString;
}

/** Full conversation header (POST/PATCH responses) — same fields as the summary. */
export type Conversation = ConversationSummary;

/** A persisted message (RESOLUTION 2). tokenCount omitted for user messages. */
export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  tokenCount?: number;                       // omitted when unknown / for user messages
  status: 'complete' | 'partial' | 'error';
  sequence: number;
  createdAt: ISOString;
}

/** GET /v1/conversations/:id and POST /v1/conversations/import → full detail. */
export interface ConversationDetail extends Conversation {
  messages: Message[];
}

/** GET /v1/conversations → page of summaries. */
export type ConversationListPage = Page<ConversationSummary>; // { items, nextCursor: string | null }

// ---- Request schemas (Zod) ----

/** GET /v1/conversations query. */
export const listConversationsQuerySchema = z.object({
  status: conversationStatus.default('active'),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).optional(),
});
export type ListConversationsQuery = z.infer<typeof listConversationsQuerySchema>;

/** POST /v1/conversations body. */
export const createConversationSchema = z.object({
  title: z.string().min(1).optional(),
});
export type CreateConversationBody = z.infer<typeof createConversationSchema>;

/** PATCH /v1/conversations/:id body (at least one field). */
export const patchConversationSchema = z
  .object({
    title: z.string().min(1).optional(),
    status: conversationStatus.optional(),
  })
  .refine((b) => b.title !== undefined || b.status !== undefined, {
    message: 'at least one of title or status is required',
  });
export type PatchConversationBody = z.infer<typeof patchConversationSchema>;

/** A single buffered guest message for import (role limited to user/assistant). */
export const importMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1),
});

/** POST /v1/conversations/import body (RESOLUTION 7). */
export const importConversationSchema = z.object({
  clientConversationId: z.string().min(1).max(200).optional(),
  messages: z.array(importMessageSchema).min(1),
});
export type ImportConversationBody = z.infer<typeof importConversationSchema>;
```

### `api/chat.ts`

```ts
import { z } from 'zod';
import { usageSchema, type Usage } from './common';

// ---- Request schemas (Zod) ----

/** POST /v1/conversations/:id/messages body. */
export const chatMessageSchema = z.object({
  content: z.string().min(1),
});
export type ChatMessageBody = z.infer<typeof chatMessageSchema>;

/** A turn the guest client holds locally and replays each request. */
export const guestTurnSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
});

/** POST /v1/guest/messages body (length-bounded history + new message). */
export const guestMessageSchema = z.object({
  messages: z.array(guestTurnSchema).max(50), // bounded; effective cap is GUEST_MESSAGE_LIMIT
  content: z.string().min(1),
});
export type GuestMessageBody = z.infer<typeof guestMessageSchema>;

// ---- SSE event payload types (TS types — RESOLUTION 4) ----

/** `start` — once, first. messageId is null for guest chat. */
export interface SseStartData {
  messageId: string | null;
  requestId: string;
}

/** `token` — zero or more. */
export interface SseTokenData {
  delta: string;
}

/** `done` — terminal on success. usage is ALWAYS present. */
export interface SseDoneData {
  messageId: string | null;
  finishReason: string; // 'stop' | 'length' | 'content_filter' | 'error' | 'cancelled'
  usage: Usage;
}

/** `error` — terminal on a mid-stream failure. */
export interface SseErrorData {
  code: 'rate_limited' | 'provider_timeout' | 'provider_error' | 'internal_error';
  message: string;
}

export type SseEvent =
  | { event: 'start'; data: SseStartData }
  | { event: 'token'; data: SseTokenData }
  | { event: 'done'; data: SseDoneData }
  | { event: 'error'; data: SseErrorData };
```

> **Note on `SseDoneData.usage`:** the contract guarantees `usage` is present on `done`, so the type is `Usage` (not `Usage | null`). The frontend's draft had `usage: … | null`; on cancel/error there is **no `done` event at all** (the stream closes or emits `error`), so `done` always carries a usage object. The plan-6 type should tighten to `usage: Usage`.

### `api/metrics.ts`

```ts
import { z } from 'zod';
import type { ISOString } from './common';

// ---- Request schema (Zod) ----

export const metricsBucket = z.enum(['1m', '5m', '1h', '1d']);
export type MetricsBucket = z.infer<typeof metricsBucket>;

/** Shared query for all metrics endpoints (bucket honored only by series endpoints). */
export const metricsQuerySchema = z
  .object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    provider: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
    bucket: metricsBucket.default('1m'),
  })
  .refine((q) => !(q.from && q.to) || q.from <= q.to, { message: 'from must be <= to' });
export type MetricsQuery = z.infer<typeof metricsQuerySchema>;

// ---- Response types (TS types — RESOLUTION 3) ----

export interface MetricsRange {
  from: ISOString;
  to: ISOString;
}

/** GET /v1/metrics/overview */
export interface OverviewMetrics {
  range: MetricsRange;
  requests: number;
  errorRate: number;
  latencyMs: { p50: number; p95: number; p99: number };
  tokens: { prompt: number; completion: number; total: number };
  throughputPerMin: number;
}

// Series point shapes (authoritative):
export interface LatencyPoint {
  t: ISOString;
  p50: number;
  p95: number;
  p99: number;
  count: number;
}
export interface ThroughputPoint {
  t: ISOString;
  count: number;
}
export interface ErrorPoint {
  t: ISOString;
  count: number;
  errorCount: number;
  errorRate: number; // errorCount / count; 0 when count === 0
}
export interface TokenPoint {
  t: ISOString;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/** Common series envelope. */
export interface MetricsSeries<P> {
  bucket: MetricsBucket;
  series: P[];
}
export type LatencySeries = MetricsSeries<LatencyPoint>;
export type ThroughputSeries = MetricsSeries<ThroughputPoint>;
export type ErrorSeries = MetricsSeries<ErrorPoint>;
export type TokenSeries = MetricsSeries<TokenPoint>;
```

### Who imports what

- **Producers** (Plan 4 — auth/conversations, Plan 5 — chat/metrics) import the **request `*Schema`** values to validate inbound bodies/queries (BE3) and the **response types** to type their serializers (the `serialize.ts` functions return `Conversation`/`Message`/`ConversationDetail`/`OverviewMetrics`/series types).
- **The consumer** (Plan 6 — frontend `api/` client) imports the **response types** as the return types of its typed `request<T>()` wrappers and the **request `*Schema`-inferred types** for request bodies, plus the `SseEvent`/`Sse*Data` types for the stream parser, and `AppErrorCode`/`SseErrorCode`/`ApiErrorBody` for error normalization.

---

## 9. Endpoint → plan ownership map

| Endpoint | Method | Producer (implements) | Consumer (calls) |
|---|---|---|---|
| `/auth/google` | GET | **Plan 4** | Plan 6 (full-page redirect via `googleSignInUrl()`) |
| `/auth/google/callback` | GET | **Plan 4** | (browser landing; Plan 6 re-checks `/v1/session`) |
| `/auth/logout` | POST | **Plan 4** | Plan 6 |
| `/auth/me` | GET | **Plan 4** | Plan 6 |
| `/v1/session` | GET | **Plan 4** | Plan 6 |
| `/v1/conversations` | GET | **Plan 4** | Plan 6 |
| `/v1/conversations` | POST | **Plan 4** | Plan 6 |
| `/v1/conversations/:id` | GET | **Plan 4** | Plan 6 |
| `/v1/conversations/:id` | PATCH | **Plan 4** | Plan 6 |
| `/v1/conversations/import` | POST | **Plan 4** | Plan 6 |
| `/v1/conversations/:id/messages` | POST (SSE) | **Plan 5** | Plan 6 |
| `/v1/guest/messages` | POST (SSE) | **Plan 5** | Plan 6 |
| `/v1/metrics/overview` | GET | **Plan 5** | Plan 6 |
| `/v1/metrics/latency` | GET | **Plan 5** | Plan 6 |
| `/v1/metrics/throughput` | GET | **Plan 5** | Plan 6 |
| `/v1/metrics/errors` | GET | **Plan 5** | Plan 6 |
| `/v1/metrics/tokens` | GET | **Plan 5** | Plan 6 |
| `/v1/logs` | POST | **Plan 3** (receiver) | `@ollive/llm-sdk` (Plan 2), driven by Plan 5's instrumented provider |
| `/healthz`, `/readyz` | GET | **Plan 3** | Plan 7 (compose healthchecks) |

The shared DTO module `@ollive/shared/api` is added under **Plan 4** (first producer to need it) and consumed by Plans 5 and 6. The `conversations.client_conversation_id` migration (RESOLUTION 7) is a **Plan 4** change to `@ollive/db`.
