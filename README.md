# Ollive — AI Conversation Analytics

Ollive is a full-stack application for managing AI conversations and analyzing inference telemetry. It runs as a Docker Compose stack (Postgres + Redis + API + ingestion worker + nginx/SPA) that can be started with a single command and zero external API keys.

---

## Run it

### One-command setup (no API key required)

```sh
cp .env.example .env
docker compose -f infra/docker-compose.yml up --build
```

Wait for all services to become healthy (watch `docker compose -f infra/docker-compose.yml ps`):

| Service           | Status    | Port |
|-------------------|-----------|------|
| postgres          | healthy   | 5432 |
| redis             | healthy   | 6379 |
| api               | healthy   | 4000 |
| ingestion-worker  | healthy   | —    |
| web               | healthy   | 8080 |

Then open **http://localhost:8080** — the SPA loads and you are automatically signed in as the seeded demo user (`demo@ollive.local`) because `AUTH_MODE=dev` requires no Google credentials.

Everything works without editing `.env`:
- Dev-mode authentication (auto-signed-in as `demo@ollive.local`)
- Conversations CRUD (create, list, view)
- Resume and list views
- Ingestion pipeline: `POST /v1/logs` → Redis Streams → worker → Postgres
- Dashboards (read from `inference_logs` populated by the pipeline)

### What needs a real key

**Live chat generation requires a real `GEMINI_API_KEY`.** No mock provider ships.

Without a real key the stack starts, dev auth works, conversations CRUD works, and the full ingestion pipeline + dashboards work. Only sending a message that calls Gemini will fail.

To enable chat:

1. Get a key at https://aistudio.google.com/apikey
2. Edit `.env`: replace `GEMINI_API_KEY=set-a-real-key-for-live-chat` with your real key
3. `docker compose -f infra/docker-compose.yml up -d` (recreates api with the new env)

> The automated E2E suite (`pnpm e2e:compose`) proves the entire stack — pipeline, auth, conversations CRUD — without a real key.

---

## Manual live-chat smoke (needs a real GEMINI_API_KEY)

After setting a real key and restarting the api:

1. Open **http://localhost:8080** (auto-signed-in as demo user)
2. Click **New chat**
3. Type `Plan a 3-day trip to Kyoto` and press Send
4. Observe tokens streaming in as Server-Sent Events (the reply appears token by token)
5. Click **Stop** mid-stream — confirm the partial reply is preserved in the conversation
6. Open **Dashboards** — confirm a new data point appears (latency / tokens for the turn just completed)
7. Confirm a `cancelled` inference log is recorded for the stopped turn

This smoke is manual because it requires a real model call and costs Gemini API credits.

---

## Real Google OAuth

To use real Google sign-in instead of the dev demo user:

1. Create OAuth 2.0 credentials in Google Cloud Console
2. Set the authorized redirect URI to `http://localhost:8080/auth/google/callback`
3. Edit `.env`:
   ```
   AUTH_MODE=google
   GOOGLE_CLIENT_ID=<your-client-id>
   GOOGLE_CLIENT_SECRET=<your-client-secret>
   ```
4. `docker compose -f infra/docker-compose.yml up -d`

---

## Development (without Docker)

Requires Postgres 16 + Redis 7 running locally (see `infra/docker-compose.yml` for the expected credentials).

```sh
cp .env.example .env           # review and adjust as needed
pnpm install
pnpm db:migrate                # run migrations
pnpm start:api                 # or: pnpm dev:api for watch mode
pnpm start:worker              # or: pnpm dev:worker
cd apps/web && pnpm dev        # Vite dev server at http://localhost:5173
```

---

## Running tests

```sh
pnpm test          # all unit + integration tests (406 tests, requires Postgres + Redis)
pnpm e2e           # E2E smoke (requires a running stack + OLLIVE_E2E=1)
pnpm e2e:compose   # builds the stack, runs E2E, tears down
```

---

## Production / limitations

- **`tsx` runtime:** the api and ingestion-worker run TypeScript via `tsx` (transpiled at runtime, no precompiled JS). This is a deliberate simplification consistent with the project scope — not production-hardened. Migration path: add a `tsc`/`esbuild` build stage and run compiled JS.
- **Docker Compose is the deployment artifact:** no Kubernetes or cloud IaC is provided.
- **TLS:** assumed terminated upstream. The compose stack serves plain HTTP on ports 4000 and 8080.
- **Migrations on startup:** both `api` and `ingestion-worker` call `runMigrations` on start. They wait for Postgres healthy via `depends_on: condition: service_healthy`. Concurrent runs are safe: Drizzle's migrator takes a Postgres advisory lock and records applied migrations in `__drizzle_migrations`, so the second runner no-ops.
- **No mock LLM provider:** live chat always requires a real `GEMINI_API_KEY`. The automated E2E exercises everything else.
