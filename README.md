# Ollive — AI Chat + Inference Analytics

Ollive is a full-stack, multi-turn LLM chat application plus the observability infrastructure around it. Users sign in, hold streaming conversations, cancel in-flight responses, and resume past chats; meanwhile every model call is instrumented and its telemetry flows through an event-driven pipeline into latency / throughput / error / token dashboards.

The whole system — Postgres, Redis, API, ingestion worker, and the SPA behind nginx — comes up with a single `docker compose up`, and **without any external API key** for everything except live chat generation.

> **Deeper docs:** [`docs/PRD.md`](docs/PRD.md) is the full product/architecture spec; [`docs/API-CONTRACTS.md`](docs/API-CONTRACTS.md) is the authoritative HTTP + SSE contract. This README is the entry point and summarizes both.

---

## 1. Setup

### One command (no API key required)

```sh
cp .env.example .env
docker compose -f infra/docker-compose.yml up --build
```

Wait for all services to report healthy (`docker compose -f infra/docker-compose.yml ps`):

| Service           | Port | Purpose                                              |
|-------------------|------|------------------------------------------------------|
| postgres          | 5432 | Primary store (users, conversations, messages, logs) |
| redis             | 6379 | `inference-logs` event stream + guest counters       |
| api               | 4000 | Chat (SSE), auth, ingestion receiver, metrics        |
| ingestion-worker  | —    | Redis Streams consumer → Postgres writer             |
| web               | 8080 | nginx serving the SPA, reverse-proxying the API      |

Then open **http://localhost:8080**. Because `AUTH_MODE=dev` is the default, you're auto-signed-in as the seeded demo user (`demo@ollive.local`) with no Google credentials needed.

Everything works out of the box **except live generation**: dev auth, conversation CRUD, list/resume, the full ingestion pipeline (`POST /v1/logs` → Redis Streams → worker → Postgres), and the dashboards that read from it.

### What needs a key

**Live chat generation requires a real `GEMINI_API_KEY`.** No mock provider ships, so sending a message is the one action that fails without a key.

1. Get a key at https://aistudio.google.com/apikey
2. In `.env`, replace `GEMINI_API_KEY=set-a-real-key-for-live-chat` with the real value
3. `docker compose -f infra/docker-compose.yml up -d` (recreates `api` with the new env)

Optionally, to enable Claude models in the in-UI model switcher (see [Multi-provider](#multi-provider)):

1. Get a key at https://console.anthropic.com/settings/keys
2. In `.env`, set `ANTHROPIC_API_KEY=` to the real value (leave it blank to keep Claude models hidden)
3. `docker compose -f infra/docker-compose.yml up -d` (recreates `api` with the new env)

### Real Google OAuth (instead of the dev user)

1. Create OAuth 2.0 credentials in Google Cloud Console; set the redirect URI to `http://localhost:8080/auth/google/callback`
2. In `.env`: `AUTH_MODE=google`, `GOOGLE_CLIENT_ID=…`, `GOOGLE_CLIENT_SECRET=…`
3. `docker compose -f infra/docker-compose.yml up -d`

### Local development (without Docker)

Requires Postgres 16 + Redis 7 reachable at the `.env` URLs, Node ≥ 20, and pnpm.

```sh
cp .env.example .env
pnpm install
pnpm db:migrate           # apply Drizzle migrations
pnpm start:api            # or pnpm dev:api  (watch mode)
pnpm start:worker         # or pnpm dev:worker
cd apps/web && pnpm dev   # Vite dev server on http://localhost:5173
```

### Tests

```sh
pnpm test          # unit + integration across all packages (needs Postgres + Redis)
pnpm e2e           # E2E smoke against a running stack (OLLIVE_E2E=1)
pnpm e2e:compose   # builds the stack, runs E2E, tears it down
```

The suite is split into six Vitest projects (`shared`, `db`, `llm-sdk`, `api`, `ingestion-worker`, `e2e`); `pnpm test` reports the total. The `e2e:compose` run proves the entire stack — pipeline, dev auth, conversation CRUD — **without** a real Gemini key. Live-chat streaming/cancel is a documented manual smoke (it costs real model credits): see [`docs/PRD.md` §7](docs/PRD.md).

---

## 2. Architecture overview

### Two halves, deliberately decoupled

1. **The product** — a streaming chat app backed by a provider abstraction (Google Gemini by default, Claude pluggable), with auth, multi-turn context, cancellation, and resume.
2. **The platform** — a standalone SDK (`packages/llm-sdk`) that wraps every model call, captures inference metadata, and ships it — *off the request path* — into an event-driven pipeline that powers the dashboards.

```
┌──────────────┐      REST + SSE       ┌───────────────────────────────┐
│   apps/web    │ ───────────────────▶ │           apps/api            │
│ Vite + React  │ ◀─────────────────── │  • Auth (Google OIDC / dev)   │
│ chat + dash   │   stream / JSON      │  • Conversations / Messages   │
└──────────────┘                       │  • Chat → LLMProvider (SSE)   │
                                       │  • Ingestion receiver /v1/logs│
                  uses packages/llm-sdk│  • Metrics (SQL aggregations) │
                   (wrap call, capture │                               │
                    meta, ship logs) ──┴───────┬───────────────┬───────┘
                                               │               │ XADD
                                               ▼               ▼
                                       ┌──────────────┐  ┌──────────────┐
                                       │  PostgreSQL  │  │    Redis     │
                                       │ (sync writes:│  │   Streams    │
                                       │  messages)   │  │inference-logs│
                                       └──────────────┘  └──────┬───────┘
                                               ▲                │ XREADGROUP
                                  async write  │                ▼
                                  inference_   │      ┌────────────────────┐
                                  logs ────────┴───── │ apps/ingestion-    │
                                                      │      worker        │
                                                      │ validate→derive→   │
                                                      │ upsert (idempotent)│
                                                      └────────────────────┘
```

### The core decision: transactional state vs. telemetry

This split is the architectural backbone:

| Data | Path | Why |
|---|---|---|
| **Chat messages** | Written **synchronously** by the API | The user must see them immediately; they're the transactional source of truth. |
| **Inference logs** | Written **asynchronously** via SDK → `/v1/logs` → Redis Streams → worker → Postgres | Observability data tolerates sub-second eventual consistency; decoupling keeps the chat path fast and the logging path independently scalable. A logging outage never degrades chat. |

> The ingestion flow, logging strategy, scaling, and failure handling are covered in depth in **[`ARCHITECTURE.md`](ARCHITECTURE.md)** — this section is just the orientation.

### Monorepo layout (pnpm workspaces)

```
apps/
  web/                # Vite + React SPA: chat UI + dashboards (CSS Modules, Recharts)
  api/                # Express: auth, conversations, chat (SSE), /v1/logs, metrics
  ingestion-worker/   # Redis Streams consumer → Postgres writer
packages/
  llm-sdk/            # LLMProvider interface + provider adapters (google, anthropic),
                      #   InferenceLogger (metadata capture), PII redaction, HTTP transport
  db/                 # Drizzle schema + migrations + typed client (shared by api & worker)
  shared/             # Zod schemas + TS types (log contract, API DTOs) — one contract, both ends
infra/                # docker-compose.yml (+ dev/override variants)
```

Only **two Node deployables** (`api` + `ingestion-worker`) — one extra process, justified by the async decoupling rather than reflexive microservices. The ingestion receiver is an isolated router inside `api` that can be extracted later without touching the worker or SDK.

### Chat request lifecycle (authed)

`POST /v1/conversations/:id/messages` → persist user message → pre-create empty assistant message (its id becomes `start.messageId`) → trim history to the token budget → open SSE → stream `token` deltas from the instrumented provider → on `done` update the assistant message (content, token count) and let the SDK ship the log. **Cancel** = the client aborts the fetch; the server detects the close, fires its `AbortController`, saves the partial reply (`status='partial'`), and the SDK logs `status='cancelled'`. See [`docs/API-CONTRACTS.md` §3](docs/API-CONTRACTS.md) for the exact event grammar.

### Multi-provider

Application code depends only on the `LLMProvider` interface, never a vendor SDK directly. Adapters (`packages/llm-sdk/src/providers/{google,anthropic}.ts`) are backed by the Vercel AI SDK for normalized token usage, native `AbortSignal`, and streaming. Adding a provider is one adapter + a registry entry — no change to chat, logging, ingestion, or storage. Gemini and Claude are both wired in today; set the relevant key to expose a model in the switcher.

---

## 3. Schema design decisions

Four tables (PostgreSQL via Drizzle, `packages/db/src/schema.ts`): `users`, `conversations`, `messages`, `inference_logs`.

- **`messages.sequence` + `UNIQUE (conversation_id, sequence)`** gives deterministic ordering and makes message inserts idempotent under retry — no duplicate turns.

- **`inference_logs.request_id UNIQUE`** is the idempotency anchor for Redis Streams' at-least-once delivery. The worker upserts on `request_id` conflict, so a redelivered message can never create a duplicate log row.

- **`inference_logs` FKs use `ON DELETE SET NULL`** (to conversations/messages/users), while `conversations`/`messages` use `ON DELETE CASCADE`. Telemetry is an audit trail, not owned data — it should survive deletion of the conversation it describes, whereas a conversation's messages should not outlive it.

- **`conversations.title_source` (`default | auto | user`)**, a CHECK-constrained column, records *title provenance* rather than inferring intent from the title string. Auto-naming runs only when `title_source='default'`, so a user who deliberately renames a chat *to* "New conversation" is still respected. Provenance is server-internal and never serialized to the client.

- **`conversations.client_conversation_id` (nullable) + partial unique index** on `(user_id, client_conversation_id) WHERE client_conversation_id IS NOT NULL` makes guest-conversation **import idempotent per user** without forcing a key on every row. Re-importing the same buffered conversation returns the existing one instead of duplicating it; the PK stays a random UUID.

- **Extracted metadata lives *in* `inference_logs`, not a side table.** The two hottest derived fields — `estimated_cost_usd NUMERIC(12,6)` and a CHECK-constrained `error_category` — are typed columns for fast dashboard filtering; everything else derived by the worker (tokens/sec, content sizes, PII redaction counts, context size) sits in a `metadata JSONB` column. The relationship is strictly 1:1, so a separate table would add joins and write amplification for no analytical upside. `metadata JSONB` also doubles as the forward-compatible escape hatch for provider-specific fields without a migration.

- **Indexes target the actual query shapes:** `idx_conv_user_status_updated (user_id, status, updated_at)` for the sidebar list; `idx_logs_created`, `idx_logs_prov_model`, `idx_logs_status`, `idx_logs_conv` for the dashboard's time-range scans, provider/model filters, error-rate counts, and conversation drill-down.

- **`messages.error_message`** persists the user-facing reason for a failed turn so a reload shows what the user saw live. **`conversations.updated_at` is maintained in the application layer**, not by a DB trigger — every update path sets it explicitly (noted in the schema so it isn't forgotten).

Full DDL and rationale: [`docs/PRD.md` §10](docs/PRD.md). Truncated previews (≤ 500 chars) and full message content are deliberately separated — previews live in `inference_logs`, full content only in `messages`.

---

## 4. Tradeoffs made

- **Redis Streams now, Kafka later (honest note).** A durable-enough, consumer-group queue with one infra dependency we already run — pragmatic at this scale. Kafka would scale better in production but adds operational weight unwarranted here; the broker-agnostic ingestion boundary makes that a later transport-only swap. (Mechanics: [ARCHITECTURE.md → Scaling](ARCHITECTURE.md#scaling-considerations).)

- **One API + one worker, not microservices.** Exactly one extra process, justified by async decoupling. The ingestion receiver is an isolated module, extractable later.

- **Vercel AI SDK over LangChain or hand-rolled.** LangChain is overkill (no agents/RAG/tools) and historically inconsistent on token-usage reporting — the exact data the dashboards depend on. Our own `LLMProvider` interface keeps us un-locked-in while the AI SDK handles multi-provider streaming plumbing.

- **Token-budget context window** over full history or fixed-N: bounds cost/latency while adapting to message size.

- **Stateless JWT cookie, no session store.** Horizontally scalable; the tradeoff is no server-side revocation list (mitigated by short expiry).

- **SQL aggregations for dashboards**, not a TSDB — adequate at demo scale; partitioning + pre-aggregated rollups are the documented next step. (Mechanics: [ARCHITECTURE.md → Scaling](ARCHITECTURE.md#scaling-considerations).)

- **PII redaction at source, fail-closed.** Telemetry previews/metadata are scrubbed in the SDK before they ship and dropped (never sent raw) if redaction errors; an ingestion backstop re-applies it. (Mechanics: [ARCHITECTURE.md → Logging strategy](ARCHITECTURE.md#logging-strategy).)

- **Guest trial in client local state.** Anonymous conversations live in the browser (mirrored to `localStorage`) until sign-in — zero anonymous write load, trivial cleanup — at the cost of a client-side import step on login. The cap is enforced **server-side** (Redis counter + signed cookie) so it can't be bypassed in-session.

- **`tsx` runtime, not a compiled build.** `api` and `ingestion-worker` run TypeScript via `tsx` (transpiled at runtime). A deliberate simplification for assignment scope, not production-hardened.

Full list with reasoning: [`docs/PRD.md` §23](docs/PRD.md).

---

## 5. Future Improvements

- **Code Quality.** The current code is fully AI-generated with very minimal human ontervention. On a production codebase, I'd spend more time to read what I'm shipping and there'd be obvious areas of improvement which I'd have missed in a day. This is where I'd start.
- **Resumable streams.** Today a dropped connection ends generation and the user resends. A resumable SSE design (server-buffered partial + replay token) would survive flaky networks.
- **Distributed rate limiting.** The current limiter is in-memory per-instance; move to a Redis-backed limiter so limits hold across horizontally scaled API replicas.
- **Dashboard scale-out.** Move from on-demand SQL aggregation to time-based partitioning of `inference_logs` + continuous aggregates / pre-computed rollups (or a TSDB) as log volume grows.
- **Kafka migration for the event bus** if sustained throughput demands it — the broker-agnostic ingestion boundary is already designed for this swap.
- **Harden the guest abuse story.** The per-cookie cap is resettable by clearing cookies (acceptable for a friction-reducing trial, not a paywall); device fingerprinting or stronger IP heuristics would tighten it.
- **Deployment beyond Compose.** Kubernetes manifests / IaC; today the Compose file is the deployment artifact.
- **Other features I have in mind.** Editing messages and Conversation branching; Cached conversations for viewing recent chats offline; RAG integration if it has to be made domain-specific.

---

## Production notes & limitations

- **Migrations on startup:** both `api` and `ingestion-worker` run `runMigrations` after waiting for Postgres healthy. Concurrent runs are safe — Drizzle's migrator takes an advisory lock and records applied migrations, so the second runner no-ops.
- **TLS** is assumed terminated upstream; the Compose stack serves plain HTTP on ports 4000 and 8080.
- **No mock LLM provider:** live chat always needs a real `GEMINI_API_KEY`; the automated E2E exercises everything else.
