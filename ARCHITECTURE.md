# Architecture

A focused tour of how telemetry moves through Ollive and the assumptions behind it. For the product/API spec see [`docs/PRD.md`](docs/PRD.md) and [`docs/API-CONTRACTS.md`](docs/API-CONTRACTS.md); for setup and the high-level diagram see [`README.md`](README.md).

The defining decision: **transactional state is written synchronously, telemetry asynchronously.** Chat messages are the source of truth the user must see immediately, so the API persists them inline. Inference logs tolerate sub-second eventual consistency, so they flow through an event pipeline that is decoupled from — and can never slow or fail — the chat path.

---

## Ingestion flow

One log makes this trip:

```
SDK (in api process)
  └─ buffer ──▶ POST /v1/logs            Authorization: Bearer <INGESTION_API_KEY>
                  │  Zod-validate the InferenceLog payload (reject 400 / 401 early)
                  │  XADD inference-logs * … (MAXLEN ~ INGESTION_STREAM_MAXLEN, default 100000)
                  └─ 202 Accepted         ← no DB write; receiver only enqueues (< 50 ms target)

ingestion-worker
  └─ XREADGROUP group=ingestion-workers consumer=$WORKER_CONSUMER_NAME
        count=$WORKER_BATCH_SIZE block=$WORKER_BLOCK_MS
        │  parse → normalize → derive metadata (cost, error_category, tokens/sec, sizes, redaction counts)
        │  UPSERT into inference_logs ON CONFLICT (request_id)   ← idempotent
        └─ XACK
```

Key properties:

- **The receiver does no DB work** — it authenticates (constant-time bearer compare), validates, enqueues, and returns `202`. Spikes are absorbed by Redis, not pushed onto Postgres.
- **The stream is capped** (`MAXLEN ~`) so memory is bounded; the worker, not the producer, controls read batch size, decoupling ingestion bursts from DB write throughput (backpressure).
- **The write is an upsert on `request_id`** (a `UNIQUE` column), which is what makes at-least-once redelivery safe (see [Failure handling](#failure-handling-assumptions)).
- **Guest-phase logs** carry `metadata.guestSessionId` with null `conversation_id`/`user_id` (the conversation isn't persisted until import) yet still feed provider/model/latency/token dashboards.

---

## Logging strategy

**Instrument at the call site, decouple the delivery.** The SDK (`packages/llm-sdk`) wraps any `LLMProvider` with `withLogging(provider, config)` — a decorator with an identical interface, so callers don't change. Per call it measures `startedAt`, `timeToFirstTokenMs` (on the first delta), `completedAt`/`latencyMs`, collects `usage` + `finishReason`, captures truncated input/output previews, and classifies `status` as `success | error | cancelled`.

- **Delivery is off the request path.** Assembled logs go into an in-memory **bounded buffer** and are POSTed on a background flush (size- or time-triggered). The user's response never awaits log delivery — chat stays fast even if ingestion is slow or down.
- **Raw vs. derived metadata.** The SDK captures the *literal facts* of a call. The worker *derives* analytical signals during ingestion (estimated cost, normalized error category, tokens/sec, content sizes, PII redaction counts). The two hottest derived fields are typed columns (`estimated_cost_usd`, `error_category`); the rest live in `metadata JSONB`. Conceptual separation, one physical row.
- **PII redaction, telemetry-only, fail-closed.** Previews and string metadata are scrubbed at log-assembly time (off the streaming hot path), *before* truncation so a cut can't leak a PII fragment. Detections become typed placeholders (`[EMAIL]`, …) with counts in `metadata.redactions`. If the redactor throws, the preview is dropped, never shipped raw. The ingestion receiver re-applies redaction as defense-in-depth (the SDK is standalone and could be embedded elsewhere or misconfigured).
- **Auto-naming is just another logged call.** Title generation reuses the same provider + SDK path (tagged `kind=title_generation`), so it shows up in the same dashboards and never blocks the user.

The log contract is a single Zod schema in `packages/shared`, validated at both the SDK and the ingestion boundary — one source of truth, compiler- and runtime-enforced at both ends.

---

## Scaling considerations

Designed for demo scale (tens of concurrent users, low hundreds of calls/min) with an explicit scale-out path that requires no rewrite:

- **API — stateless.** Auth is a signed JWT cookie with no server-side session store, so the API scales horizontally behind a load balancer.
- **Worker — add consumers.** Scaling is adding members to the `ingestion-workers` consumer group; Redis Streams partitions delivery across them. Each worker is a named consumer (`WORKER_CONSUMER_NAME`), so claims and recovery are per-consumer.
- **Postgres.** Connection pooling now. As `inference_logs` grows: read replicas for dashboard queries, **time-based partitioning** (e.g. monthly) of the log table, and moving percentile queries to pre-aggregated rollups.
- **Redis Streams.** The capped length bounds memory; for sustained high throughput the documented upgrade is a partitioned broker (Kafka). Because the ingestion boundary (receiver → stream → worker) is **broker-agnostic**, that swap touches only the transport — not the SDK, the `/v1/logs` contract, or the worker's processing logic.
- **Dashboards.** On-demand SQL aggregation (`percentile_cont`, `date_trunc` bucketing) is adequate at this scale; continuous aggregates or a TSDB are the next step if query latency degrades.

---

## Failure handling assumptions

The governing rule: **a logging or ingestion failure must never degrade the chat experience.**

- **At-least-once + idempotent.** Redis Streams may redeliver. The worker upserts on the unique `request_id`, so duplicate delivery produces no duplicate row. This is the core reliability contract.
- **The chat path degrades gracefully.** If shipping fails, the SDK retries with exponential backoff + jitter up to a bounded budget; on buffer overflow or exhausted retries it **drops the log with a local warning** and moves on. The user never sees it.
- **Crashed consumers recover.** Entries left unacked past an idle threshold (`WORKER_CLAIM_IDLE_MS`) are reclaimed via `XAUTOCLAIM` by a live worker, so a worker crash mid-batch doesn't strand messages.
- **Poison messages don't wedge the pipeline.** An entry that repeatedly fails (past `WORKER_MAX_DELIVERIES`) is routed to an `inference-logs-dlq` stream and acked, so one malformed log can't block the rest.
- **Provider errors are mapped, not leaked.** Raw provider payloads never reach the client; the user gets a friendly, normalized message while full detail lives in the log's `error_message`/`metadata`. Mid-stream failures emit an SSE `error` event, persist the partial as `status='error'`, and close cleanly.
- **Cancellation is a first-class outcome, not an error.** A client abort closes the stream with no `done`/`error` event; the server saves the partial reply (`status='partial'`) and the SDK records `status='cancelled'`.
- **No resumable streams (assumed out of scope).** A dropped connection ends generation; the user resends to retry.
- **Readiness reflects dependencies.** `GET /readyz` reports DB + Redis reachability (`503` if either is down) so orchestration doesn't route traffic to an instance that can't serve it; `GET /healthz` is liveness only.
