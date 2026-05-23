# Product Requirements Document — Ollive

**Lightweight Inference Logging & Ingestion System for an LLM Chat Application**

| | |
|---|---|
| **Status** | Approved for implementation |
| **Version** | 1.2 |
| **Date** | 2026-05-23 |
| **Author** | Ankan Poddar |
| **Context** | Take-home assignment — AI infrastructure / platform engineering |

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Goals and Non-Goals](#2-goals-and-non-goals)
3. [Assumptions](#3-assumptions)
4. [System Architecture](#4-system-architecture)
5. [Functional Requirements](#5-functional-requirements)
6. [Non-Functional Requirements](#6-non-functional-requirements)
7. [User Flows](#7-user-flows)
8. [API Contracts](#8-api-contracts)
9. [Logging Schema](#9-logging-schema)
10. [Database Schema](#10-database-schema)
11. [Frontend Requirements](#11-frontend-requirements)
12. [Backend Requirements](#12-backend-requirements)
13. [SDK Requirements](#13-sdk-requirements)
14. [Provider Abstraction & Multi-Provider Support](#14-provider-abstraction--multi-provider-support)
15. [Authentication](#15-authentication)
16. [Ingestion Pipeline Requirements](#16-ingestion-pipeline-requirements)
17. [Streaming Requirements](#17-streaming-requirements)
18. [Error Handling Expectations](#18-error-handling-expectations)
19. [Scalability Assumptions](#19-scalability-assumptions)
20. [Security Assumptions](#20-security-assumptions)
21. [Deployment Requirements](#21-deployment-requirements)
22. [Observability Requirements](#22-observability-requirements)
23. [Tradeoffs and Design Decisions](#23-tradeoffs-and-design-decisions)
24. [Acceptance Criteria](#24-acceptance-criteria)
25. [Intentional Simplifications](#25-intentional-simplifications)

---

## 1. Executive Summary

Ollive is a multi-turn LLM chatbot plus the observability infrastructure around it. The system has two halves that are deliberately decoupled:

1. **The product**: a streaming chat application backed by Google Gemini (with a provider abstraction so other models can be added), where users sign in, hold multi-turn conversations, cancel in-flight responses, and resume past conversations.
2. **The platform**: a lightweight SDK that wraps every LLM call to capture inference metadata (latency, token usage, status, previews, timing) and ships it — without blocking the chat path — into an **event-driven ingestion pipeline** (Redis Streams → worker → PostgreSQL) that powers latency / throughput / error / token dashboards.

The central design idea is the separation of **transactional state** from **telemetry**. Conversation content (the messages a user must see immediately) is persisted synchronously by the API. Inference logs (observability data that can tolerate sub-second eventual consistency) flow asynchronously through the event pipeline. This keeps the chat experience fast while making the logging path independently scalable.

The stack is TypeScript end-to-end, pragmatic by design, and runs with a single `docker compose up`.

### Tech Stack at a Glance

| Layer | Choice | Rationale |
|---|---|---|
| Language | TypeScript everywhere | Shared types across SDK, API, worker, frontend |
| Frontend | Vite + React + CSS Modules + Recharts | Pure SPA against a dedicated API; no Tailwind |
| Backend API | Express + Drizzle ORM + Zod | Familiar, explicit SQL-first schema, runtime validation |
| Worker | Node + Redis Streams consumer + Drizzle | Async log processing |
| Database | PostgreSQL | Relational integrity for chats + analytical queries for dashboards |
| Event bus | Redis Streams | Pragmatic durable-enough queue with consumer groups |
| LLM provider | Google Gemini (default) | Behind our own `LLMProvider` interface |
| Provider backing | Vercel AI SDK (`ai` + `@ai-sdk/*`) | Normalized token usage, native `AbortSignal`, multi-provider |
| Auth | Google OAuth (OIDC) | Behind an `AuthProvider` abstraction |
| Monorepo | pnpm workspaces | Lightweight; no Turborepo needed |
| Orchestration | Docker Compose | One-command local setup |

---

## 2. Goals and Non-Goals

### Goals

- **G1** — A working multi-turn chat UI with streaming (SSE) responses from Gemini.
- **G2** — Maintain short conversational context using a token-budget sliding window.
- **G3** — A lightweight, reusable SDK that captures inference metadata and ships it to an ingestion endpoint without adding latency to the chat path.
- **G4** — An event-driven ingestion pipeline that validates, parses, and stores logs.
- **G5** — A sensible PostgreSQL schema for conversations, messages, and inference logs with practical indexing.
- **G6** — Latency, throughput, error, and token-usage dashboards.
- **G7** — Provider abstraction enabling multi-provider support with minimal change.
- **G8** — Conversation lifecycle in the UI: list, resume, and cancel (abort an in-flight stream).
- **G9** — `docker compose up` brings up the entire system.
- **G10** — Google OAuth authentication, behind a provider abstraction.
- **G11** — Frictionless onboarding: anonymous users can exchange a limited number of messages before being asked to sign in, and that conversation survives the sign-in.
- **G12** — Conversations are auto-named from their first exchange.

### Non-Goals

- **NG1** — No production-grade multi-tenant org/team/RBAC model. A user sees only their own conversations; that is the extent of isolation.
- **NG2** — No fine-tuning, RAG, tool-calling, or agentic workflows.
- **NG3** — No resumable/replayable SSE streams across reconnects (a dropped connection ends that stream).
- **NG4** — No horizontal autoscaling, Kubernetes manifests, or cloud-specific IaC. The compose file is the deployment artifact.
- **NG5** — No billing, quotas, or cost-accounting beyond token counts.
- **NG6** — No analytics warehouse / TSDB. Dashboard metrics are computed with SQL aggregations over PostgreSQL.
- **NG7** — No message edit/regenerate/branching. Conversations are linear.

---

## 3. Assumptions

These are explicit and may be revisited; each is chosen to remove ambiguity.

- **A1** — Single deployment, demo-scale traffic: tens of concurrent users, low hundreds of inference calls per minute at peak. The architecture documents a scale-out path but is not load-tested for it.
- **A2** — "Session ID" from the brief maps to **`conversation_id`**. Each conversation is a session.
- **A3** — "Short conversational context" = a **token-budget sliding window** (dynamic number of recent turns that fit within a configured prompt-token budget, reserving headroom for the response). Default budget configurable via env.
- **A4** — "Cancel a conversation" = **abort the in-flight streaming response** (stop generation). It is *not* delete. Archiving exists separately as a lifecycle action but is secondary.
- **A5** — Google OAuth requires `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`. To keep `docker compose up` truly one-command without external credentials, an `AUTH_MODE=dev` bypass auto-authenticates a seeded demo user. `AUTH_MODE=google` enables real OAuth. (See [§15](#15-authentication).)
- **A6** — Input/output **previews are truncated to 500 characters** in logs. Full message content lives only in the `messages` table.
- **A7** — The SDK runs **server-side** inside the API process (the Gemini API key must never reach the browser). It is nonetheless written as a standalone package that ships to a *configurable* ingestion URL, so it could be embedded in any other service.
- **A8** — Redis Streams provides **at-least-once** delivery; the worker is **idempotent** via a unique `request_id`.
- **A9** — TLS is terminated at an upstream proxy/load balancer in production; services speak plain HTTP internally. Local dev is HTTP.
- **A10** — Default model is `gemini-2.5-flash`, configurable via env.
- **A11** — **Guest trial**: an unauthenticated visitor may send up to `GUEST_MESSAGE_LIMIT` messages (default **2**) before sign-in is required. The guest conversation is held in **client local state** (not persisted server-side); the cap is enforced **server-side** via a short-lived guest session (signed httpOnly cookie + Redis counter), with IP rate limiting as backup. On sign-in the buffered conversation is **imported**, persisted, and resumes seamlessly.
- **A12** — **Auto-naming**: a conversation's title starts as `"New conversation"`. After the first assistant response completes, if the user has not set a custom title, an LLM call generates a concise title. Whether the user set a title is tracked by a `title_source` field (`default` | `auto` | `user`), never by string comparison — so a user who manually renames *to* "New conversation" is still respected.

---

## 4. System Architecture

### 4.1 Component Overview

```
┌──────────────┐        REST + SSE         ┌───────────────────────────────┐
│   apps/web    │ ───────────────────────▶ │           apps/api            │
│ Vite + React  │ ◀─────────────────────── │          (Express)            │
│ Chat + Dash   │     stream / JSON         │                               │
└──────────────┘                            │  • Auth (Google OIDC)         │
                                            │  • Conversations / Messages   │
                                            │  • Chat → LLMProvider (SSE)   │
                                            │  • Ingestion receiver /v1/logs│
                                            │  • Metrics (SQL aggregations) │
                                            └───────┬───────────────┬───────┘
                                                    │               │
                              uses packages/llm-sdk │               │ XADD
                                  (wraps provider,  │               ▼
                                   captures meta,    │        ┌──────────────┐
                                   ships logs) ──────┘        │    Redis     │
                                                              │  Streams     │
                                                              │ inference-   │
                                                              │   logs       │
                                                              └──────┬───────┘
                                                                     │ XREADGROUP
                                                                     ▼
                                                          ┌────────────────────┐
                                                          │ apps/ingestion-    │
                                                          │      worker        │
                                                          │ validate→parse→    │
                                                          │ store inference_   │
                                                          │ logs (idempotent)  │
                                                          └─────────┬──────────┘
                                                                    │
                ┌───────────────────────────────────────────────────┘
                ▼
        ┌───────────────┐
        │  PostgreSQL    │  users · conversations · messages · inference_logs
        └───────────────┘
```

### 4.2 Monorepo Layout (pnpm workspaces)

```
ollive/
├── apps/
│   ├── web/                 # Vite + React SPA (chat UI + dashboards)
│   ├── api/                 # Express: auth, conversations, chat (SSE), /v1/logs, metrics
│   └── ingestion-worker/    # Redis Streams consumer → Postgres writer
├── packages/
│   ├── llm-sdk/             # LLMProvider interface + Vercel AI SDK adapters
│   │                        #   + InferenceLogger (metadata capture) + HTTP transport
│   ├── db/                  # Drizzle schema, migrations, typed client (shared: api + worker)
│   └── shared/              # Zod schemas + shared TS types (log payload contract, DTOs)
├── infra/
│   └── docker-compose.yml   # postgres, redis, api, ingestion-worker, web
├── package.json
└── pnpm-workspace.yaml
```

### 4.3 Two Persistence Paths (key decision)

| Data | Path | Why |
|---|---|---|
| **Chat messages** (user + assistant) | Written **synchronously** by the API | The UI must show them immediately (resume/list); they are transactional source-of-truth. |
| **Inference logs** (telemetry) | Written **asynchronously** via SDK → `/v1/logs` → Redis Streams → worker → Postgres | Observability data tolerates sub-second eventual consistency; decoupling keeps the chat path fast and the logging path independently scalable. |

This split is the architectural backbone and is referenced throughout.

### 4.4 Deployables

Two Node processes plus infra: **`api`** and **`ingestion-worker`**. This honors "avoid unnecessary microservices" — we add exactly one extra process, justified by the event-driven decoupling. The ingestion HTTP receiver lives as an isolated router module inside `api` and can be extracted into its own service later without touching the worker or SDK.

---

## 5. Functional Requirements

### Chat & Conversations
- **FR1** — Users can create a new conversation.
- **FR2** — Users can send a message and receive a streamed assistant response token-by-token over SSE.
- **FR3** — The system maintains multi-turn context using a token-budget sliding window (A3).
- **FR4** — Users can **cancel** an in-flight response; generation stops, partial output is preserved, and a `cancelled` inference log is recorded.
- **FR5** — Users can **list** their conversations (active and archived), most-recently-updated first.
- **FR6** — Users can **resume** a conversation: open it, see full history, continue sending messages.
- **FR7** — Users can rename and archive a conversation.

### SDK & Logging
- **FR8** — Every LLM call is wrapped by the SDK, which captures: provider, model, latency, time-to-first-token, token usage (prompt/completion/total), timestamps, status, request/conversation/message IDs, and truncated input/output previews.
- **FR9** — The SDK ships each log to the ingestion endpoint asynchronously, never blocking or failing the user-facing response.
- **FR19** — The SDK redacts PII (default on) from previews/metadata before shipping, replacing detections with typed placeholders; raw PII never enters the telemetry stream.

### Ingestion & Storage
- **FR10** — The ingestion endpoint authenticates the caller (service API key), validates the payload (Zod), and enqueues it to Redis Streams, returning `202 Accepted`.
- **FR11** — The worker consumes the stream, parses/normalizes the payload, and writes to `inference_logs` idempotently (dedup on `request_id`).
- **FR20** — During ingestion the worker extracts derived metadata (cost, error category, throughput, content sizes, redaction counts) and stores it alongside the raw log (§16.1).

### Dashboards
- **FR12** — A dashboard shows **latency** (p50/p95/p99 over time), **throughput** (requests/interval), **error rate**, and **token usage** (prompt/completion/total over time), filterable by time range, provider, and model.

### Auth
- **FR13** — Users authenticate via Google OAuth. Anonymous users may use chat up to the guest limit (FR15); persisted history, conversation lists, and dashboards require sign-in.

### Guest Trial & Onboarding
- **FR15** — An anonymous visitor can exchange up to `GUEST_MESSAGE_LIMIT` (default 2) messages without signing in; the conversation is kept in client local state, and the limit is enforced server-side.
- **FR16** — After the limit, the composer is blocked and the user is prompted to sign in. On sign-in, the buffered conversation is imported, persisted, and resumed without losing context.

### Conversation Naming
- **FR17** — New conversations are titled "New conversation". After the first assistant response, the system auto-generates a concise title via the LLM, unless the user has set a custom title (`title_source`).
- **FR18** — A user-set title is never overwritten by auto-naming, even if the user typed "New conversation".

### Multi-Provider
- **FR14** — Adding a new provider requires implementing one adapter against `LLMProvider`; no changes to chat, logging, ingestion, or storage.

---

## 6. Non-Functional Requirements

- **NFR1 — SDK overhead**: metadata capture adds < 5 ms to a call; log shipping is fully off the request path (buffered, fire-and-forget).
- **NFR2 — Streaming latency**: first token forwarded to the client within ~50 ms of receipt from the provider.
- **NFR3 — Ingestion latency**: `/v1/logs` responds in < 50 ms (enqueue only); end-to-end log visibility (shipped → queryable) under ~2 s at demo scale.
- **NFR4 — Dashboard queries**: return in < 1 s over demo-scale data (hundreds of thousands of rows) with the specified indexes.
- **NFR5 — Reliability**: a logging/ingestion outage never degrades the chat experience; logs buffer and retry, dropping only after a bounded retry budget.
- **NFR6 — Portability**: entire system runs locally via `docker compose up` with a documented `.env`.
- **NFR7 — Type safety**: shared Zod schemas validate the log contract at both SDK and ingestion boundaries; DB types derive from the Drizzle schema.
- **NFR8 — Code quality**: clear module boundaries, each package independently understandable and testable.

---

## 7. User Flows

### 7.1 Anonymous Trial → Sign In → Import
1. A visitor lands with no session. The app starts a guest conversation in local state (mirrored to `localStorage`); the API issues a signed httpOnly `guest_session` cookie.
2. The visitor sends up to `GUEST_MESSAGE_LIMIT` (default 2) messages via the guest chat endpoint and receives streamed replies; messages live in client local state. The server increments a per-guest counter in Redis.
3. On exceeding the limit, the guest chat endpoint returns `403 login_required`; the UI blocks the composer and prompts "Sign in to continue".
4. The user clicks "Sign in with Google" → `GET /auth/google` → Google consent → callback upserts the user and sets an httpOnly JWT cookie. (In `AUTH_MODE=dev`, a seeded user is authenticated directly.)
5. The client calls `POST /v1/conversations/import` with the buffered messages; the server persists them as a new conversation owned by the user and returns it.
6. The conversation resumes seamlessly. Because `title_source='default'`, auto-naming (§7.2) runs against the imported exchange.

### 7.2 New Conversation & Streamed Reply
1. User clicks "New chat" → `POST /v1/conversations` → empty conversation.
2. User types a message → `POST /v1/conversations/:id/messages`.
3. API persists the user message, pre-creates an empty assistant message (gets `messageId`), trims context to the token budget, and opens an SSE stream.
4. API calls the instrumented `LLMProvider.streamChat(..., signal)`; deltas are forwarded as `token` events.
5. On completion: API updates the assistant message content + token count; the SDK ships the inference log.
6. If this was the **first** assistant response and `title_source='default'`, the API asynchronously generates a title via the LLM, sets it, and marks `title_source='auto'`; the client refreshes the sidebar title on stream `done`.

### 7.3 Cancel an In-Flight Response
1. While streaming, user clicks "Stop".
2. The client aborts the request (closes the SSE/fetch). The server detects connection close and fires the `AbortController`.
3. The provider stream aborts; the assistant message is saved as `partial`; the SDK ships a `cancelled` log with partial output and measured latency.

### 7.4 List & Resume
1. `GET /v1/conversations?status=active` populates the sidebar (title, last-updated).
2. Clicking one → `GET /v1/conversations/:id` returns the conversation with its full message history; the user continues from where they left off.

### 7.5 View Dashboards
1. User opens "Dashboards" → frontend calls `GET /v1/metrics/*` with a time range + optional provider/model filters.
2. Recharts renders latency percentiles, throughput, error rate, and token-usage time series.

### 7.6 Behind the Scenes — Log Ingestion
SDK ships log → `POST /v1/logs` (API key) → Zod validate → `XADD inference-logs` → `202` → worker `XREADGROUP` → normalize → upsert `inference_logs` → `XACK`.

---

## 8. API Contracts

Base path `/v1` unless noted. All user-facing endpoints require the session cookie. All bodies are JSON unless streaming.

### 8.1 Auth

```
GET  /auth/google                 → 302 redirect to Google consent
GET  /auth/google/callback?code=  → sets httpOnly cookie, 302 to app
POST /auth/logout                 → clears cookie, 204
GET  /auth/me                     → 200 { user } | 401
GET  /v1/session                  → guest/auth status (never 401)
```

`GET /auth/me` response:
```json
{ "user": { "id": "f3c…", "email": "ankan@hyperverge.co", "name": "Ankan", "avatarUrl": "https://…" } }
```

`GET /v1/session` response (drives the UI's guest indicator):
```json
{ "authenticated": false, "guest": { "remaining": 1, "limit": 2 } }
// or, when signed in:
{ "authenticated": true, "user": { "id": "f3c…", "email": "ankan@hyperverge.co", "name": "Ankan" } }
```

### 8.2 Conversations

```
GET    /v1/conversations?status=active|archived&limit=20&cursor=<id>
POST   /v1/conversations            { "title"?: string }
GET    /v1/conversations/:id        → conversation + messages
PATCH  /v1/conversations/:id        { "title"?: string, "status"?: "active"|"archived" }
```

`POST /v1/conversations` → `201`:
```json
{
  "id": "c1a…", "title": "New conversation", "status": "active",
  "provider": "google", "model": "gemini-2.5-flash",
  "createdAt": "2026-05-23T10:00:00.000Z", "updatedAt": "2026-05-23T10:00:00.000Z"
}
```

`GET /v1/conversations/:id` → `200`:
```json
{
  "id": "c1a…", "title": "Trip planning", "status": "active",
  "provider": "google", "model": "gemini-2.5-flash",
  "messages": [
    { "id": "m1", "role": "user", "content": "Plan a 3-day trip to Kyoto", "sequence": 1, "createdAt": "…" },
    { "id": "m2", "role": "assistant", "content": "Day 1 …", "tokenCount": 312, "status": "complete", "sequence": 2, "createdAt": "…" }
  ]
}
```

`POST /v1/conversations/import` (auth required) — persists a buffered guest conversation:
```jsonc
// request
{
  "clientConversationId": "c-local-7f…",   // optional idempotency key from the client
  "messages": [
    { "role": "user", "content": "Plan a 3-day trip to Kyoto" },
    { "role": "assistant", "content": "Day 1 …" }
  ]
}
// → 201: full conversation object (server-assigned id; title_source = "default")
```
Idempotency: re-importing the same `clientConversationId` for the same user returns the existing conversation instead of duplicating it.

### 8.3 Chat (SSE)

```
POST /v1/conversations/:id/messages
Content-Type: application/json
Accept: text/event-stream
Body: { "content": "What about day 2?" }
→ 200 text/event-stream
```

Event stream (see [§17](#17-streaming-requirements) for full semantics):
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

**Cancellation** is performed by the client aborting the connection (no separate endpoint); the server reacts to connection close.

**Guest variant (no persistence):**
```
POST /v1/guest/messages
Body: { "messages": [ { "role": "user"|"assistant", "content": "…" } ], "content": "new user message" }
→ 200 text/event-stream  (same event format as above)
→ 403 { "error": "login_required", "remaining": 0 }   // guest limit reached
```
The client holds the full guest conversation locally and sends it on each turn (≤ `GUEST_MESSAGE_LIMIT` messages). The server enforces the cap, calls the LLM via the SDK (logged with `metadata.guestSessionId`), and streams the reply — but writes nothing to Postgres.

### 8.4 Ingestion (internal)

```
POST /v1/logs
Authorization: Bearer <INGESTION_API_KEY>
Body: <InferenceLog payload — see §9>
→ 202 { "accepted": true, "requestId": "r-9a…" }
→ 400 { "error": "validation_error", "details": [...] }
→ 401 { "error": "unauthorized" }
```

### 8.5 Metrics

```
GET /v1/metrics/overview?from=&to=&provider=&model=
GET /v1/metrics/latency?from=&to=&bucket=1m&provider=&model=
GET /v1/metrics/throughput?from=&to=&bucket=1m&…
GET /v1/metrics/errors?from=&to=&bucket=1m&…
GET /v1/metrics/tokens?from=&to=&bucket=1m&…
```

`GET /v1/metrics/overview` → `200`:
```json
{
  "range": { "from": "2026-05-23T00:00:00Z", "to": "2026-05-23T12:00:00Z" },
  "requests": 1840, "errorRate": 0.021,
  "latencyMs": { "p50": 740, "p95": 1820, "p99": 3110 },
  "tokens": { "prompt": 612000, "completion": 244000, "total": 856000 },
  "throughputPerMin": 2.6
}
```

`GET /v1/metrics/latency?bucket=1m` → `200`:
```json
{
  "bucket": "1m",
  "series": [
    { "t": "2026-05-23T10:00:00Z", "p50": 690, "p95": 1700, "p99": 2900, "count": 12 },
    { "t": "2026-05-23T10:01:00Z", "p50": 720, "p95": 1810, "p99": 3050, "count": 15 }
  ]
}
```

### 8.6 Health

```
GET /healthz   → 200 { "status": "ok" }            (liveness)
GET /readyz     → 200 { "db": "ok", "redis": "ok" }  (readiness)
```

---

## 9. Logging Schema

The contract the SDK ships to `/v1/logs`, defined once as a Zod schema in `packages/shared` and reused at both ends.

```jsonc
{
  "requestId": "r-9a3f…",            // uuid, client-generated, idempotency key
  "timestamp": "2026-05-23T10:01:12.001Z",
  "provider": "google",              // "google" | "openai" | "anthropic" | …
  "model": "gemini-2.5-flash",
  "status": "success",               // "success" | "error" | "cancelled"
  "context": {
    "conversationId": "c1a…",
    "messageId": "m4",
    "userId": "f3c…"
  },
  "timing": {
    "startedAt": "2026-05-23T10:01:11.793Z",
    "completedAt": "2026-05-23T10:01:12.001Z",
    "latencyMs": 1208,
    "timeToFirstTokenMs": 210
  },
  "usage": { "promptTokens": 420, "completionTokens": 188, "totalTokens": 608 },
  "preview": {
    "input": "What about day 2?",        // ≤ 500 chars
    "output": "Day 2 we head to Arashiyama…"  // ≤ 500 chars
  },
  "error": null,                      // or { code, message, providerCode }
  "metadata": {                       // free-form jsonb, provider-agnostic extras
    "temperature": 0.7, "maxOutputTokens": 1024, "stream": true,
    "contextMessages": 8, "contextTokens": 412
  }
}
```

Error example:
```jsonc
"status": "error",
"error": { "code": "rate_limited", "message": "Resource exhausted", "providerCode": "429" }
```

Validation rules: `requestId` required + uuid; `status` enum; `usage` integers ≥ 0 (may be null for `error`/`cancelled` before first token); previews truncated server-side as a safety net even if the SDK already truncated.

---

## 10. Database Schema

PostgreSQL, expressed via Drizzle. DDL shown for clarity (`gen_random_uuid()` via `pgcrypto`).

```sql
-- users -------------------------------------------------------------------
CREATE TABLE users (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  google_sub   TEXT UNIQUE NOT NULL,        -- OIDC subject; null-safe for dev mode seed
  email        TEXT UNIQUE NOT NULL,
  name         TEXT,
  avatar_url   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ
);

-- conversations -----------------------------------------------------------
CREATE TABLE conversations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL DEFAULT 'New conversation',
  title_source TEXT NOT NULL DEFAULT 'default'
              CHECK (title_source IN ('default','auto','user')),
  status      TEXT NOT NULL DEFAULT 'active'
              CHECK (status IN ('active','archived')),
  provider    TEXT NOT NULL,
  model       TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_conv_user_status_updated
  ON conversations (user_id, status, updated_at DESC);

-- messages ----------------------------------------------------------------
CREATE TABLE messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
  content         TEXT NOT NULL DEFAULT '',
  token_count     INTEGER,
  sequence        INTEGER NOT NULL,          -- monotonic per conversation
  status          TEXT NOT NULL DEFAULT 'complete'
                  CHECK (status IN ('complete','partial','error')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, sequence)
);
CREATE INDEX idx_msg_conv_seq ON messages (conversation_id, sequence);

-- inference_logs (telemetry; written by the worker) -----------------------
CREATE TABLE inference_logs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id            UUID UNIQUE NOT NULL,         -- idempotency
  conversation_id       UUID REFERENCES conversations(id) ON DELETE SET NULL,
  message_id            UUID REFERENCES messages(id)      ON DELETE SET NULL,
  user_id               UUID REFERENCES users(id)         ON DELETE SET NULL,
  provider              TEXT NOT NULL,
  model                 TEXT NOT NULL,
  status                TEXT NOT NULL CHECK (status IN ('success','error','cancelled')),
  latency_ms            INTEGER,
  time_to_first_token_ms INTEGER,
  prompt_tokens         INTEGER,
  completion_tokens     INTEGER,
  total_tokens          INTEGER,
  input_preview         TEXT,
  output_preview        TEXT,
  error_code            TEXT,
  error_message         TEXT,
  started_at            TIMESTAMPTZ,
  completed_at          TIMESTAMPTZ,
  -- extracted (worker-derived) metadata; see §16.1 ----------------------
  estimated_cost_usd    NUMERIC(12,6),               -- tokens × per-model price table
  error_category        TEXT CHECK (error_category IN
                          ('rate_limit','timeout','auth','content_filter','other')),
  metadata              JSONB NOT NULL DEFAULT '{}',  -- remaining derived signals
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()  -- ingestion time
);
CREATE INDEX idx_logs_created    ON inference_logs (created_at DESC);
CREATE INDEX idx_logs_prov_model ON inference_logs (provider, model);
CREATE INDEX idx_logs_status     ON inference_logs (status);
CREATE INDEX idx_logs_conv       ON inference_logs (conversation_id);
```

**Schema rationale**
- `messages.sequence` + unique constraint guarantees deterministic ordering and prevents duplicate inserts on retry.
- `inference_logs.request_id UNIQUE` is the idempotency anchor for at-least-once Redis delivery — the worker upserts on conflict.
- FKs from `inference_logs` use `ON DELETE SET NULL` so telemetry survives conversation/user deletion (logs are an audit trail, not owned data).
- `conversations.title_source` records title provenance (`default`/`auto`/`user`) so auto-naming can distinguish an untouched default from a user who deliberately typed "New conversation" — never inferred from the title string.
- `metadata JSONB` is the forward-compatible escape hatch for provider-specific fields without migrations.
- Indexes target the exact dashboard query shapes: time-range scans (`created_at`), provider/model filters, status (error rate), and conversation drill-down.

---

## 11. Frontend Requirements

- **FE1** — Vite + React + TypeScript SPA; styling via **CSS Modules** (no Tailwind); charts via **Recharts**.
- **FE2** — **Chat view**: message list with role styling, streaming assistant bubble that appends tokens live, composer with send + **Stop** (cancel) control, auto-scroll, markdown rendering for assistant output.
- **FE3** — **Sidebar**: list conversations (active by default, toggle to archived), show title + relative last-updated, "New chat" button, rename + archive actions.
- **FE4** — **Resume**: selecting a conversation loads full history and lets the user continue.
- **FE5** — **Cancel**: the Stop button aborts the in-flight fetch (`AbortController`); UI marks the partial reply and re-enables the composer.
- **FE6** — **Dashboards view**: time-range picker + provider/model filters; cards for request count / error rate / token totals; line charts for latency p50/p95/p99, throughput, error rate, and token usage over time.
- **FE7** — **Auth**: sign-in screen; authenticated shell shows user avatar + sign-out; 401 responses redirect to sign-in.
- **FE8** — Loading, empty, and error states for every view; no unhandled promise rejections surface to the user.
- **FE9** — SSE consumed via `fetch` + `ReadableStream` parsing (not `EventSource`, which can't POST) — see [§17](#17-streaming-requirements).
- **FE10** — **Guest trial**: chat works without sign-in up to the limit; a subtle "N messages left — sign in to continue" indicator (from `GET /v1/session`). The guest conversation is held in local state and mirrored to `localStorage` so a refresh doesn't lose it. On reaching the limit, a sign-in prompt replaces the composer; after sign-in the conversation is imported and the view continues uninterrupted.
- **FE11** — Sidebar titles update to the auto-generated name once available (refetch conversation metadata on stream `done` for the first response).

---

## 12. Backend Requirements

- **BE1** — Express + TypeScript; routers split by domain: `auth`, `conversations`, `chat`, `ingestion`, `metrics`, `health`.
- **BE2** — Drizzle ORM with the schema in `packages/db`; migrations run on startup.
- **BE3** — Zod validates every request body/query; failures return `400` with structured details.
- **BE4** — The chat handler: persists user message → pre-creates assistant message → trims context → invokes the instrumented `LLMProvider` → streams SSE → updates assistant message on completion.
- **BE5** — Token-budget context trimming (A3): include most recent messages whose cumulative token estimate fits the budget, reserving response headroom; always include the latest user turn.
- **BE6** — The ingestion receiver validates + enqueues to Redis Streams (`XADD`), returning `202`; it does **not** write to Postgres directly.
- **BE7** — Metrics endpoints compute aggregations in SQL (`percentile_cont` for latency percentiles, `date_trunc`/bucketing for time series), parameterized via Drizzle.
- **BE8** — Structured logging (pino) with a per-request correlation id; CORS locked to the web origin; graceful shutdown drains in-flight SSE.
- **BE9** — Connection pooling to Postgres; a single shared Redis client.
- **BE10** — **Guest session**: issue/verify a signed httpOnly guest cookie; enforce `GUEST_MESSAGE_LIMIT` via a Redis counter keyed by guest id (with TTL); return `403 login_required` past the cap. Guest chat (`POST /v1/guest/messages`) is not persisted server-side.
- **BE11** — `POST /v1/conversations/import` persists a buffered guest conversation for the authenticated user (idempotent on optional `clientConversationId`), then triggers auto-naming.
- **BE12** — **Auto-naming**: after the first assistant response, if `title_source='default'`, asynchronously call the LLM (via the SDK, `metadata.kind='title_generation'`) to produce a ≤6-word title, set it, and mark `title_source='auto'`. Failures leave the default title intact and may be retried on the next response.

---

## 13. SDK Requirements

The deliverable "lightweight SDK" lives in `packages/llm-sdk`. It wraps an `LLMProvider` and emits inference logs. It is the system's instrumentation layer and is independent of the chat app.

- **SDK1** — `withLogging(provider, config)` returns an instrumented `LLMProvider` with an identical interface (decorator pattern) — callers don't change.
- **SDK2** — Per call it measures: `startedAt`, `timeToFirstTokenMs` (on first delta), `completedAt`, `latencyMs`; collects `usage` and `finishReason` on completion; captures truncated input/output previews; classifies `status` (`success`/`error`/`cancelled`).
- **SDK3** — Caller supplies **context** (`conversationId`, `messageId`, `userId`) and per-call `metadata`; the SDK merges these into the log.
- **SDK4** — **Transport is non-blocking**: logs go to an in-memory bounded buffer and are POSTed to the configurable ingestion URL on a background flush (size- or time-triggered). The user response never awaits log delivery.
- **SDK5** — **Resilience**: failed ships retry with exponential backoff + jitter up to a bounded budget; on overflow or exhausted retries, logs are dropped with a local warning (chat is never affected — NFR5).
- **SDK6** — **Idempotency**: each call gets a `requestId` (uuid) included in the payload.
- **SDK7** — Configurable: `ingestionUrl`, `apiKey`, `previewMaxChars` (default 500), `flushIntervalMs`, `maxBufferSize`, `maxRetries`.
- **SDK8** — Zero behavioral coupling to Express or the chat schema; depends only on `packages/shared` types.

### PII Redaction (telemetry only)

- **SDK9** — A pluggable `Redactor` scrubs PII from the data the SDK emits — `input`/`output` previews and string metadata values — **before** it is buffered or shipped. It is **on by default** (`PII_REDACTION`), privacy-by-default. It applies only to the telemetry stream; the user's conversation in the `messages` table (written by the API, not the SDK) is untouched.
- **SDK10** — Redaction runs at **log-assembly (completion) time on the fully-assembled text, then truncation is applied** — never per-delta and never on the streaming hot path, so it adds **zero latency to the user's response**. Order matters: redact first so truncation can't slice a PII token and leak a fragment.
- **SDK11** — **Default detector is pattern-based** (deterministic, in-process, no external deps): email, phone, credit card (Luhn-validated), SSN, IP/IBAN, and secrets/keys (known prefixes + high-entropy tokens). An **optional cheap-LLM extension** (`PII_REDACTION=llm`) can be enabled to catch unstructured PII (names/addresses) via a small/fast model; because it costs latency + a model call, it is opt-in and best run at the ingestion backstop (IN9) rather than inline.
- **SDK12** — Detected PII is replaced with **typed placeholders** (`[EMAIL]`, `[CREDIT_CARD]`, …), preserving type for debugging without revealing values. The per-log redaction **counts** (e.g., `{ "email": 2 }`) are written to `metadata.redactions` — a useful signal containing no PII.
- **SDK13** — **Fail-closed**: if the redactor throws, the SDK drops the preview entirely rather than ship raw text. A privacy failure must never default to leaking.

### SDK Interfaces (illustrative)

```ts
interface InferenceLoggerConfig {
  ingestionUrl: string;
  apiKey: string;
  previewMaxChars?: number;   // default 500
  flushIntervalMs?: number;   // default 1000
  maxBufferSize?: number;     // default 500
  maxRetries?: number;        // default 3
  redaction?: 'off' | 'pattern' | 'llm';  // default 'pattern'
  redactor?: Redactor;        // override the default implementation
}

interface Redactor {
  // returns redacted text + counts of each PII type found (no values)
  redact(text: string): { text: string; counts: Record<string, number> };
}

interface CallContext {
  conversationId?: string;
  messageId?: string;
  userId?: string;
  metadata?: Record<string, unknown>;
}

function withLogging(provider: LLMProvider, config: InferenceLoggerConfig): LLMProvider;
// usage: loggedProvider.streamChat(req, { signal, context })
```

---

## 14. Provider Abstraction & Multi-Provider Support

- **PA1** — Application code depends only on the `LLMProvider` interface — never on a vendor SDK directly. This is the multi-provider boundary.
- **PA2** — Adapters are backed by the **Vercel AI SDK** (`ai` + `@ai-sdk/google` as default, `@ai-sdk/openai` / `@ai-sdk/anthropic` pluggable), chosen for normalized token usage, native `AbortSignal`, and streaming ergonomics.
- **PA3** — Adding a provider = one new adapter + a registry entry; no changes to chat, SDK, ingestion, or storage (FR14).
- **PA4** — A provider registry maps `provider` → adapter, configured via env; conversation rows record the `provider`/`model` used.

```ts
interface ChatRequest {
  model: string;
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[];
  temperature?: number;
  maxOutputTokens?: number;
}

interface StreamChunk {
  delta?: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  finishReason?: 'stop' | 'length' | 'content_filter' | 'error' | 'cancelled';
}

interface LLMProvider {
  readonly name: string; // "google" | "openai" | "anthropic"
  streamChat(
    req: ChatRequest,
    opts?: { signal?: AbortSignal; context?: CallContext }
  ): AsyncIterable<StreamChunk>;
}
```

---

## 15. Authentication

- **AU1** — User auth via **Google OAuth (OIDC)**, abstracted behind an `AuthProvider` interface so other IdPs (e.g., Firebase, GitHub) can be added without touching route logic.
- **AU2** — On successful OAuth, the user is upserted by `google_sub`; a signed **JWT is set as an httpOnly, SameSite=Lax, Secure (prod) cookie**. No server-side session store (stateless).
- **AU3** — Auth middleware verifies the session cookie on protected routes (conversations, import, dashboards) → `401` on failure. The chat path is **semi-public**: the guest endpoint accepts an anonymous guest session up to `GUEST_MESSAGE_LIMIT`, then returns `403 login_required`.
- **AU4** — **`AUTH_MODE` env**: `google` (real OAuth) or `dev` (auto-authenticate a seeded demo user so `docker compose up` works without Google credentials — A5). The mode is logged at startup and surfaced in the UI banner in dev.
- **AU5** — **Service-to-service**: the ingestion endpoint is protected by a static `INGESTION_API_KEY` (Bearer), separate from user auth. The SDK sends it on every ship.
- **AU6** — Secrets (`GOOGLE_CLIENT_SECRET`, `JWT_SECRET`, `INGESTION_API_KEY`) come from env only; never sent to the browser.
- **AU7** — **Guest sessions**: on first contact the API issues a signed httpOnly `guest_session` cookie (random `guestSessionId`, short TTL). A Redis counter `guest:{id}:count` enforces the message cap server-side; IP rate limiting backs it up. Guest conversations are not stored server-side (client local state only).
- **AU8** — **Import on login**: after authentication the client imports its buffered guest conversation via `POST /v1/conversations/import`; authenticated users are uncapped.

```ts
interface AuthProvider {
  name: string;
  getAuthorizationUrl(state: string): string;
  handleCallback(code: string): Promise<{ sub: string; email: string; name?: string; avatarUrl?: string }>;
}
```

---

## 16. Ingestion Pipeline Requirements

- **IN1** — **Receiver** (`POST /v1/logs`, in `api`): API-key auth → Zod validation → `XADD inference-logs * payload <json>` → `202`. No DB writes.
- **IN2** — **Stream**: Redis Streams key `inference-logs`, capped with approximate `MAXLEN ~ N` to bound memory.
- **IN3** — **Consumer group** `ingestion-workers`; each worker instance is a named consumer reading via `XREADGROUP`.
- **IN4** — **Processing**: parse → normalize → **extract derived metadata** (IN10) → **upsert** into `inference_logs` on `request_id` conflict (idempotent) → `XACK`.
- **IN5** — **Failure handling**: unacked entries are recovered via `XAUTOCLAIM` after an idle threshold (handles crashed consumers); malformed entries that repeatedly fail are routed to a `inference-logs-dlq` stream and acked, so the pipeline never wedges.
- **IN6** — **Backpressure**: the receiver enqueues quickly; the worker controls its own read batch size, decoupling spikes from DB write throughput.
- **IN7** — Worker emits structured logs + a processed/failed counter for observability.
- **IN8** — Guest-phase inference logs carry `metadata.guestSessionId` with null `conversation_id`/`user_id` (the conversation isn't persisted until import); they still contribute to provider/model/latency/token dashboards.
- **IN9** — **Redaction backstop**: the receiver re-applies PII redaction to previews/metadata before enqueue (defense in depth — the SDK is the primary scrubber, but it is standalone and could be embedded in another app or misconfigured). The optional cheap-LLM redaction extension, if enabled, runs here where the latency budget is looser.
- **IN10** — **Metadata extraction**: the worker derives structured metadata from each raw log and stores it — see [§16.1](#161-extracted-metadata).

### 16.1 Extracted Metadata

The brief calls for storing **"extracted metadata"** distinct from raw inference logs. The distinction is the difference between what the SDK *captures* and what the ingestion worker *derives*:

| | **Raw (captured) metadata** | **Extracted (derived) metadata** |
|---|---|---|
| Produced by | SDK, at the call site | Ingestion worker, during processing |
| Examples | provider, model, latency, TTFT, token usage, status, timestamps, redacted previews | estimated cost, throughput (tokens/sec), normalized error category, content lengths, context size, PII redaction counts, parsed SDK/client info, language guess |
| Why separate | the literal facts of the call | computed signals the platform adds to make raw logs analyzable |

The worker's extraction stage computes, per log:
- **`estimated_cost_usd`** — token usage × a per-model price table (a high-value dashboard metric → **dedicated column**).
- **`error_category`** — raw provider error normalized to `rate_limit | timeout | auth | content_filter | other` (→ **dedicated column**, powers the error dashboard).
- **`tokens_per_second`**, `prompt_chars`, `output_chars`, `context_message_count` — throughput/size signals.
- **`redactions`** — PII counts from the redaction layer (SDK12).
- **`sdk_version`, `app_name`** — parsed from the log envelope.

**Where it's stored**: the two most-queried derived fields (`estimated_cost_usd`, `error_category`) are **typed columns** on `inference_logs`; the rest live under a documented shape in the `metadata` JSONB. We deliberately **do not** create a separate `extracted_metadata` table — the relationship to a log is strictly 1:1, so a side table would add joins and write amplification for no benefit ([§23](#23-tradeoffs-and-design-decisions)). The conceptual separation is preserved in documentation and field naming, not in physical tables.

```jsonc
// inference_logs.metadata (worker-extracted shape, on top of SDK-sent extras)
{
  "tokensPerSecond": 156.0,
  "promptChars": 1840, "outputChars": 712,
  "contextMessageCount": 8,
  "redactions": { "email": 1, "phone": 0 },
  "sdkVersion": "0.1.0", "appName": "ollive-web",
  "guestSessionId": null
}
```

---

## 17. Streaming Requirements

- **ST1** — Chat responses stream via **Server-Sent Events** over the `POST /v1/conversations/:id/messages` response (`Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`).
- **ST2** — Event types: `start` (messageId, requestId), `token` (delta), `done` (finishReason, usage), `error` (code, message). One JSON object per `data:` line.
- **ST3** — The frontend consumes via `fetch` + `ReadableStream` (POST is required, so `EventSource` is unsuitable); a small client parser splits SSE frames.
- **ST4** — **Cancellation**: client aborts the fetch (`AbortController`). The server detects request `close`, fires its `AbortController`, which propagates to `LLMProvider.streamChat`'s `signal`, stopping provider generation. Partial assistant content is saved (`status='partial'`); the SDK logs `status='cancelled'`.
- **ST5** — **Keep-alive**: periodic SSE comment heartbeats (`: ping`) prevent idle-proxy timeouts.
- **ST6** — **Mid-stream provider error**: emit an `error` event, persist partial content as `status='error'`, log `status='error'`, and close the stream cleanly.
- **ST7** — **No resumable streams** (NG3): a dropped connection ends generation; the user resends to retry.

---

## 18. Error Handling Expectations

Errors are normalized to a stable `code` set across providers.

| Code | Source | HTTP / SSE | Behavior |
|---|---|---|---|
| `validation_error` | Zod (any endpoint) | 400 | Structured field details returned. |
| `unauthorized` | Missing/invalid session or API key | 401 | Redirect to sign-in (UI) / reject (ingestion). |
| `not_found` | Unknown conversation/message | 404 | — |
| `rate_limited` | Provider 429 | SSE `error` | Surface a friendly retry message; logged `status=error`. |
| `provider_timeout` | Provider slow/unreachable | SSE `error` | Bounded timeout; abort + log. |
| `provider_error` | Other provider failure | SSE `error` | Generic failure message; full detail in `error_message`. |
| `cancelled` | User abort | SSE close | Save partial; log `status=cancelled`. |
| `login_required` | Guest message cap exceeded | 403 | Block composer; prompt sign-in. |
| `internal_error` | Unexpected | 500 / SSE `error` | Logged with correlation id; generic message to user. |

Principles:
- **The chat path degrades gracefully**: ingestion/logging failures are invisible to the user (NFR5).
- **Provider errors are mapped, not leaked**: raw provider payloads never reach the client; they live in `error_message`/`metadata`.
- **The worker never crash-loops**: poison messages go to the DLQ after bounded retries (IN5).
- **Every error carries a correlation id** for cross-service tracing.

---

## 19. Scalability Assumptions

Designed for demo scale (A1) with a documented scale-out path:

- **API**: stateless (JWT cookie, no session store) → horizontally scalable behind a load balancer.
- **Worker**: scale by adding consumers to the `ingestion-workers` group; Redis Streams partitions delivery across them.
- **Postgres**: connection pooling now; read replicas for dashboard queries and **time-based partitioning of `inference_logs`** (e.g., monthly) as volume grows; percentile queries can move to pre-aggregated rollups.
- **Redis Streams**: capped length bounds memory; for sustained high throughput it is the documented upgrade point (see [§23](#23-tradeoffs-and-design-decisions)).
- **Dashboards**: SQL aggregation is adequate at demo scale; continuous aggregates / a TSDB are the next step if query latency degrades.

---

## 20. Security Assumptions

- **SE1** — All secrets via env; nothing sensitive shipped to the browser; `.env.example` documents required vars without values.
- **SE2** — Ingestion endpoint requires `INGESTION_API_KEY`; it is not publicly usable.
- **SE3** — Session JWT is httpOnly + SameSite=Lax + Secure (prod); short-to-medium expiry; signed with `JWT_SECRET`.
- **SE4** — CORS restricted to the configured web origin; credentials mode enabled for the cookie.
- **SE5** — All input validated by Zod; all SQL parameterized via Drizzle (no string-built queries).
- **SE6** — **PII redaction**: input/output previews may contain user content, so the SDK redacts PII **on by default** before shipping ([§13](#13-sdk-requirements), SDK9–13), the ingestion worker re-applies it as a backstop (IN9), and previews are truncated to 500 chars and confined to `inference_logs` (full content stays in `messages`). In the default configuration PII never reaches the telemetry store or dashboards.
- **SE7** — TLS terminated upstream in production (A9); internal traffic is within the compose network.
- **SE8** — Authorization: every conversation/message/metric query is scoped to the authenticated `user_id`; no cross-user access.
- **SE9** — Basic rate limiting on auth and chat endpoints (documented; simple in-memory limiter at demo scale).
- **SE10** — The semi-public guest chat endpoint is abuse-guarded by the server-side cap (Redis counter, not client-trusted), IP rate limiting, and a short guest-session TTL. The cap is per-cookie and resettable by clearing cookies — acceptable for a trial (see S9).

---

## 21. Deployment Requirements

- **DE1** — `docker compose up` starts the full system from a clean checkout.
- **DE2** — Services:

| Service | Image / Build | Purpose | Depends on |
|---|---|---|---|
| `postgres` | `postgres:16` | Primary store | — |
| `redis` | `redis:7` | Event stream | — |
| `api` | build `apps/api` | Chat, auth, ingestion receiver, metrics | postgres, redis |
| `ingestion-worker` | build `apps/ingestion-worker` | Stream consumer → Postgres | postgres, redis |
| `web` | build `apps/web` → nginx | Serves the SPA | api |

- **DE3** — Migrations run automatically on `api`/worker startup (Drizzle migrate); the schema is created idempotently.
- **DE4** — Healthchecks: `postgres`/`redis` use native checks; `api` exposes `/healthz` + `/readyz`; the worker reports readiness via a heartbeat log.
- **DE5** — A documented `.env.example` covers: `DATABASE_URL`, `REDIS_URL`, `GOOGLE_CLIENT_ID/SECRET`, `JWT_SECRET`, `INGESTION_API_KEY`, `AUTH_MODE`, `GEMINI_API_KEY`, `DEFAULT_MODEL`, `CONTEXT_TOKEN_BUDGET`, `WEB_ORIGIN`, `GUEST_MESSAGE_LIMIT`, `GUEST_SESSION_TTL`, `PII_REDACTION`.
- **DE6** — `AUTH_MODE=dev` (default for local) enables one-command startup without Google credentials (A5).
- **DE7** — A seed step creates the demo user (dev mode) and is safe to re-run.

---

## 22. Observability Requirements

- **OB1** — The product dashboards (FR12) are the primary observability surface for inference behavior.
- **OB2** — All services emit **structured JSON logs** (pino) with a correlation id; the chat path logs request → provider call → completion.
- **OB3** — The worker exposes processed/failed/DLQ counters via logs (and a simple counter endpoint).
- **OB4** — `/healthz` (liveness) and `/readyz` (DB + Redis reachability) on the API.
- **OB5** — `time_to_first_token_ms` is captured so the latency dashboard distinguishes TTFT from total latency.
- **OB6** — OpenTelemetry traces are a documented future extension, not in scope (NG6 adjacent).

---

## 23. Tradeoffs and Design Decisions

- **Redis Streams now, Kafka later (honest note).** Redis Streams gives durable-enough, consumer-group-based delivery with one infra dependency we already justify — the pragmatic choice at this scale. **Kafka would genuinely scale better in production**: a partitioned, replicated commit log with long retention enables high-throughput parallelism, consumer replay/backfill of historical logs, and a richer ecosystem (Kafka Connect, stream processing). We deliberately did not adopt it here because it adds operational weight (brokers, coordination, partition management) unwarranted for an assignment. The ingestion boundary (receiver → stream → worker) is broker-agnostic, so swapping Redis Streams for Kafka touches only the transport, not the SDK, receiver contract, or worker logic.
- **Transactional vs. telemetry persistence split** ([§4.3](#43-two-persistence-paths-key-decision)). Synchronous chat-message writes keep the UX correct and immediate; asynchronous event-driven log writes keep the chat path fast and the logging path independently scalable. This is the core architectural decision.
- **One API + one worker, not microservices.** We add exactly one extra process, justified by async decoupling. The ingestion receiver is an isolated module that can be extracted into its own service later without ripple effects.
- **Vercel AI SDK over LangChain or hand-rolled.** LangChain is overkill (no agents/RAG/tools) and historically inconsistent on token-usage reporting across providers — the exact data we depend on. Hand-rolled adapters are viable but reimplement solved plumbing. The Vercel AI SDK is purpose-built for multi-provider streaming with normalized usage and native `AbortSignal`, while our own `LLMProvider` interface keeps us un-locked-in.
- **Token-budget context over full history or fixed-N.** Bounds cost/latency while adapting to message size; the same budgeting generalizes cleanly if more context sources are added later.
- **Express + Drizzle + Zod.** Express for familiarity; Drizzle for explicit SQL-first schema that showcases sensible modeling; Zod for one runtime contract shared across SDK and ingestion.
- **JWT cookie, no session store.** Stateless and horizontally scalable; the tradeoff is no server-side revocation list (acceptable at this scale, mitigated by short expiry).
- **SQL aggregations for dashboards.** Avoids a TSDB dependency; the documented next step if it gets slow is partitioning + pre-aggregated rollups.
- **Previews truncated to 500 chars.** Balances dashboard usefulness against storage and PII exposure; full content stays in `messages`.
- **Guest trial in client local state.** Anonymous conversations live in the browser (mirrored to `localStorage`), not the DB, until sign-in — zero anonymous write load and trivial cleanup, at the cost of a client-side import step on login. The cap is enforced server-side so it can't be bypassed in-session.
- **`title_source` flag over string comparison.** Tracking title provenance (`default`/`auto`/`user`) cleanly separates "untouched default" from "user happened to type 'New conversation'", so auto-naming never clobbers an intentional title.
- **Async auto-naming as a logged LLM call.** Title generation reuses the provider + SDK path (tagged `kind=title_generation`), so it's observable in the same dashboards and never blocks the user's response.
- **Redact at source, fail-closed, with an ingestion backstop.** Scrubbing PII in the SDK before it ships keeps PII out of the network, the store, and dashboards entirely; doing it at completion time keeps it off the user's hot path; failing closed (drop preview on error) means a redactor bug can't leak. Pattern-based detection is the deterministic default; the cheap-LLM extension trades cost/latency for unstructured-PII coverage and is therefore opt-in and placed at the looser-budget ingestion stage.
- **Extracted metadata lives in `inference_logs`, not a side table.** Derived fields are strictly 1:1 with a log; hot ones (`estimated_cost_usd`, `error_category`) are typed columns for fast dashboard filtering, the rest sit in `metadata` JSONB. A separate `extracted_metadata` table would add joins and write amplification with no analytical upside at this scale.

---

## 24. Acceptance Criteria

### Core

- [ ] **AC1** — A user signs in (Google OAuth, or dev mode) and reaches the chat UI.
- [ ] **AC2** — Sending a message streams a Gemini response token-by-token over SSE.
- [ ] **AC3** — Multi-turn context is maintained within the configured token budget (verifiable: later turns reference earlier ones; trimming observed in logs).
- [ ] **AC4** — Clicking Stop aborts generation; partial output is preserved and a `cancelled` inference log is recorded.
- [ ] **AC5** — Conversations can be listed, resumed (full history reloads), renamed, and archived.
- [ ] **AC6** — Every LLM call produces an inference log with provider, model, latency, TTFT, token usage, status, timestamps, IDs, and previews.
- [ ] **AC7** — Logs reach Postgres via `/v1/logs` → Redis Streams → worker; the chat path never blocks on or fails due to logging.
- [ ] **AC8** — Re-delivering the same `request_id` does not create a duplicate `inference_logs` row.
- [ ] **AC9** — `/v1/logs` rejects requests without a valid `INGESTION_API_KEY` (401) and malformed payloads (400).
- [ ] **AC10** — Dashboards render latency p50/p95/p99, throughput, error rate, and token usage, filterable by time range / provider / model.
- [ ] **AC11** — `docker compose up` brings up the entire system from a clean checkout with a documented `.env`.

### Bonus (interview guarantee)

- [ ] **AC12** — Multi-provider: a second provider (e.g., OpenAI) works by adding only an adapter.
- [ ] **AC13** — Streaming responses work end-to-end (covered by AC2).
- [ ] **AC14** — Latency + throughput + error dashboards present (covered by AC10).
- [ ] **AC15** — One-command Docker Compose setup (covered by AC11).
- [ ] **AC16** — Event-based architecture: ingestion flows through Redis Streams with a consumer group and idempotent worker.
- [ ] **AC17** — Frontend supports cancel, list, and resume (covered by AC4, AC5).

### Onboarding & Naming

- [ ] **AC18** — An anonymous visitor can send up to the guest limit and receive streamed replies without signing in; the cap is enforced server-side (not bypassable by client tampering).
- [ ] **AC19** — After the limit, the user is prompted to sign in; after signing in, the prior conversation is imported and resumes with full context.
- [ ] **AC20** — A new conversation is auto-named from its first exchange; a conversation the user renamed (including to "New conversation") is never auto-renamed.

### Privacy & Data

- [ ] **AC21** — With redaction on (default), a message containing an email/phone/card/SSN/API key produces an `inference_logs` row whose previews show typed placeholders (`[EMAIL]`, …) and whose `metadata.redactions` counts are populated — no raw PII in the telemetry store; the user's `messages` row remains intact.
- [ ] **AC22** — Each `inference_logs` row carries extracted metadata: `estimated_cost_usd`, normalized `error_category` (for failures), and derived `metadata` signals (tokens/sec, content lengths, redaction counts).

---

## 25. Intentional Simplifications

Called out explicitly so reviewers know these were deliberate, not oversights:

- **S1** — Dev-mode auth bypass (`AUTH_MODE=dev`) trades real OAuth for one-command startup; production uses `AUTH_MODE=google`.
- **S2** — No resumable SSE streams; a dropped connection ends generation.
- **S3** — Dashboard metrics computed with on-demand SQL, not a TSDB or pre-aggregation.
- **S4** — Rate limiting is a simple in-memory limiter, not a distributed one.
- **S5** — No server-side session revocation (stateless JWT; short expiry mitigates).
- **S6** — Single Redis Stream + single logical worker group; no multi-topic routing.
- **S7** — Conversations are linear — no editing, regeneration, or branching.
- **S8** — Previews capped at 500 chars before redaction is applied.
- **S9** — The guest message cap is per guest-session cookie + IP; clearing cookies grants a fresh trial. Acceptable for a friction-reducing trial, not a hard paywall.

---

## Document History

| Version | Date | Changes |
|---|---|---|
| 1.0 | 2026-05-23 | Initial PRD: chat app, logging SDK, event-driven ingestion (Redis Streams), PostgreSQL schema, provider abstraction (Vercel AI SDK), Google OAuth, streaming/cancel, dashboards, deployment, tradeoffs, acceptance criteria. |
| 1.1 | 2026-05-23 | Anonymous guest trial (client-local conversation, server-enforced cap, import-on-login) and LLM auto-naming of conversations via a `title_source` flag. |
| 1.2 | 2026-05-23 | SDK PII redaction layer (pattern-based default + optional cheap-LLM extension, typed placeholders, telemetry-only, fail-closed, ingestion backstop) and an explicit extracted-metadata stage (raw vs derived; `estimated_cost_usd` + `error_category` columns, derived signals in `metadata`). |
```

