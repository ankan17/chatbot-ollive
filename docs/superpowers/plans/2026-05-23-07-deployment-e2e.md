# Deployment & End-to-End Smoke Implementation Plan (Plan 7 of 7)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Format note (design-level):** This plan specifies *what* to build and *what to test* — contracts, config shapes, algorithms, and behavioral test cases — not finished application code and not literal `it(...)`/`expect(...)` test bodies. **Exception:** Dockerfiles, `docker-compose.yml`, `nginx.conf`, and `.env.example` are **configuration artifacts that ARE the deliverable**; for these the plan shows their essential structure / key directives as fenced snippets (they are specifications, not "implementation code"). The implementing subagent authors the real E2E test code and any glue scripts, driving them from the test cases listed here. Where a few key lines + prose convey the design, prose is preferred over dumping a whole file.
>
> **Commit convention:** every commit message in this plan must end with the trailer:
> `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`

**Goal:** Deliver one-command `docker compose -f infra/docker-compose.yml up` that brings up the entire Ollive system from a clean checkout — `postgres`, `redis`, `api`, `ingestion-worker`, and `web` (nginx) — with migrations applied automatically, a seeded dev user, dependency-ordered healthchecks, a documented `.env.example`, and an automated cross-process end-to-end smoke test that proves the event-driven ingestion pipeline + core API **without any external API key** (live Gemini chat is a documented manual smoke).

**Architecture:** This plan **extends** Plan 1's `infra/docker-compose.yml` (which already defines `postgres:16` + `redis:7` with native healthchecks) by adding three built services. The two Node deployables (`api`, `ingestion-worker`, PRD §4.4) run their TypeScript source directly via `tsx` inside Node 20 containers (no per-package build step — consistent with the monorepo's source-consumed-via-`exports` convention from Plans 1–3); `web` is the exception, a multi-stage build that compiles the Vite SPA to static assets and serves them from `nginx:alpine`. nginx **reverse-proxies** `/v1`, `/auth`, and `/healthz` to the `api` service so the browser talks to a **single origin** — eliminating CORS for the one-command path. Migrations run on `api`/`worker` startup (DE3, already implemented in Plans 3/4); the compose's job is correct `depends_on` + healthcheck ordering so both Node services start only after Postgres and Redis are healthy. `AUTH_MODE=dev` is the default so the stack is fully usable without Google credentials (DE6); a real `GEMINI_API_KEY` is required only for live chat (everything else — auth in dev mode, conversations CRUD, the full log→stream→worker→Postgres→metrics pipeline — works without it).

**Tech Stack:** Docker + Docker Compose v2, `node:20-bookworm-slim` (api + worker build/run), `nginx:1.27-alpine` (web runtime), pnpm via corepack, `tsx` (runtime for the Node deployables), Vite (web static build), Vitest 3 (the automated E2E harness, run from the repo root workspace), Node 20 built-ins + `ioredis`/`postgres.js` (already in `@ollive/db`/`@ollive/api`) for the E2E assertions, `wait-on`/`pg_isready`/`redis-cli`/`curl` (healthchecks + readiness gating). No new application runtime dependency is introduced.

**Context:** The repo root is the existing git repository at `chatbot-ollive/`. All paths below are relative to that root. The system is a pnpm-workspace monorepo (Plan 1): `packages/shared`, `packages/db`, `packages/llm-sdk` (Plan 2), and the deployables `apps/api` (Plan 3 — Express app factory, `/v1/logs` receiver, `/healthz`+`/readyz`, plus Plans 4/5 routers: auth, conversations, chat, metrics) and `apps/ingestion-worker` (Plan 3 — Redis Streams consumer, heartbeat log) and `apps/web` (Plan 6 — Vite + React SPA built to static `dist`). **Known launch contracts from prior plans (do not invent variants):**

- **api** — start `tsx src/server.ts`; `server.ts` calls `runMigrations(databaseUrl)` on boot (DE3) then `app.listen(config.port)` (default `PORT=4000`); exposes `GET /healthz` → `200 {status:'ok'}` and `GET /readyz` → `{db,redis}` (Plan 3 §8.6); graceful shutdown on SIGTERM/SIGINT. Routers mounted: `/healthz`, `/readyz`, `/v1/logs` (Plan 3), `/auth/*`, `/v1/session`, `/v1/conversations*`, `/v1/guest/messages`, `/v1/metrics/*` (Plans 4/5). Depends on Postgres + Redis.
- **ingestion-worker** — start `tsx src/main.ts`; `main.ts` runs migrations (DE3), `ensureGroup`, logs the readiness heartbeat `'ingestion worker ready'` (DE4), then the consume loop; graceful shutdown. Depends only on `@ollive/shared` + `@ollive/db` (NOT `@ollive/api`). Depends on Postgres + Redis.
- **web** — built with `pnpm --filter @ollive/web build` → static assets in `apps/web/dist`; the SPA calls the API at a configurable base URL (Plan 6). Served by nginx.
- **db** — `runMigrations(databaseUrl)` from `@ollive/db` (Plan 1, re-exported from the package root in Plan 3 Task 0). Idempotent.

> **Pinned facts (carry through every task):**
> - **Service URLs are container-internal** inside the compose network: `DATABASE_URL=postgres://ollive:ollive@postgres:5432/ollive`, `REDIS_URL=redis://redis:6379`. These differ from the host-facing URLs in Plan 1's `.env.example` (`localhost`), which is why the compose injects them as **per-service environment overrides on top of `env_file: .env`** rather than relying on the file's host values.
> - **Default `AUTH_MODE=dev`** so `docker compose up` works with zero external credentials (DE6/A5). The seeded demo user (DE7) is what dev-mode auto-auth resolves to.
> - **A real `GEMINI_API_KEY` is required to actually chat** — there is no runtime mock provider (explicit product decision). `.env.example` documents it; the stack comes up and everything except *live LLM generation* works without it. This is stated in the README and the `.env.example` comments.
> - The automated E2E **must not require any external key** — it exercises the event pipeline (`POST /v1/logs` → Redis Streams → worker → Postgres → `/v1/metrics/*`) plus dev-mode auth and conversations CRUD over HTTP. Live chat is a **manual** documented smoke.
> - Dependency-version note (carry forward from Plans 1–3): pin images with the tags written here; if a tag is unavailable, substitute the nearest patch of the same minor and keep going. Express stays on v4 (already pinned in Plan 3).

---

## File Structure

```
infra/
  docker-compose.yml        # EDIT: extend Plan 1's file — add api, ingestion-worker, web services + their healthchecks/depends_on
apps/
  api/
    Dockerfile              # NEW: Node 20 + pnpm(corepack); install workspace deps; run `tsx src/server.ts`
    .dockerignore           # NEW: exclude node_modules, dist, .env, test artifacts
  ingestion-worker/
    Dockerfile              # NEW: same base recipe as api; run `tsx src/main.ts`
    .dockerignore           # NEW
  web/
    Dockerfile              # NEW: multi-stage — node build (vite) → nginx:alpine serving dist
    nginx.conf              # NEW: SPA history fallback + reverse-proxy /v1, /auth, /healthz → api
    .dockerignore           # NEW
.env.example                # EDIT: add the full DE5 var set with non-secret defaults + comments
README.md                   # EDIT (or CREATE if absent): one-command run instructions + manual chat smoke + what needs real keys
test/
  e2e/
    smoke.e2e.test.ts       # NEW: automated cross-process E2E (pipeline + dev auth + conversations CRUD), no external key
    helpers.ts              # NEW: base-URL config, HTTP helpers, Postgres poll-until helper, dev-auth cookie helper
vitest.workspace.ts         # EDIT: add an 'e2e' project (sequential, long timeout, opt-in via OLLIVE_E2E_BASE_URL)
package.json                # EDIT: add `e2e` + `e2e:compose` scripts; (optional) a `seed` passthrough
```

**Module responsibilities (single-responsibility, NFR8):** each Dockerfile owns exactly one deployable's image recipe; the api and worker Dockerfiles share an identical base recipe (differing only in the final `CMD`), so a reviewer can diff them trivially. `nginx.conf` owns SPA serving + the single-origin proxy decision. `docker-compose.yml` owns orchestration (build contexts, env wiring, dependency ordering, healthchecks, ports). `.env.example` is the env-as-config doc surface (DE5). The E2E lives **outside** any package (`test/e2e/`) because it is a black-box client of the running system, not a unit of any one package; it talks only over HTTP + reads Postgres to assert.

---

## Task 1: api + ingestion-worker Dockerfiles (+ .dockerignore)
**Implements:** DE2 (the `api` and `ingestion-worker` built services), PRD §4.4 (two Node deployables), NFR6 (portability). Establishes the pnpm-workspace install strategy reused by web's build stage.
**Files:**
- Create: `apps/api/Dockerfile` — image recipe for the API process.
- Create: `apps/ingestion-worker/Dockerfile` — image recipe for the worker process (same base recipe, different `CMD`).
- Create: `apps/api/.dockerignore`, `apps/ingestion-worker/.dockerignore` — keep build context lean.

**Design:**
- **Build context decision (justify):** the build context is the **repo root** (`context: ..` from `infra/`, or `.` if compose is invoked from root), NOT the app subdirectory — because a pnpm workspace install needs the **root `package.json` + `pnpm-workspace.yaml` + `pnpm-lock.yaml`** and **every workspace member's `package.json`** to resolve `workspace:*` links and produce a frozen install. A per-app context cannot see sibling packages. The Dockerfile therefore lives in the app dir but is built against the root.
- **pnpm workspace install strategy (justify — the load-bearing decision):** copy manifests first, install, then copy source — to maximize Docker layer caching:
  1. Enable pnpm via corepack (`corepack enable && corepack prepare pnpm@<pinned> --activate`) on `node:20-bookworm-slim`.
  2. Copy **only** the manifests that affect dependency resolution: root `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, and each workspace member's `package.json` (`packages/shared/package.json`, `packages/db/package.json`, `packages/llm-sdk/package.json`, `apps/api/package.json`, `apps/ingestion-worker/package.json`, `apps/web/package.json`).
  3. `pnpm install --frozen-lockfile` — deterministic, fails if the lockfile is stale. This layer is cached until a manifest or the lockfile changes.
  4. Copy the rest of the source tree (`packages/`, `apps/`). Source-only changes reuse the cached install layer.
  5. **No build step** — internal packages are consumed as TS source via `tsx` (Plans 1–3 convention). The runtime command is `tsx`.
- **Dockerfile outline (api) — key directives as prose:**
  ```dockerfile
  FROM node:20-bookworm-slim
  ENV PNPM_HOME=/pnpm CI=true
  RUN corepack enable && corepack prepare pnpm@9 --activate
  WORKDIR /app
  # 1) manifests only (cache-friendly)
  COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
  COPY packages/shared/package.json   packages/shared/package.json
  COPY packages/db/package.json       packages/db/package.json
  COPY packages/llm-sdk/package.json  packages/llm-sdk/package.json
  COPY apps/api/package.json          apps/api/package.json
  COPY apps/ingestion-worker/package.json apps/ingestion-worker/package.json
  COPY apps/web/package.json          apps/web/package.json
  RUN pnpm install --frozen-lockfile
  # 2) source
  COPY . .
  EXPOSE 4000
  CMD ["pnpm", "--filter", "@ollive/api", "start"]   # = tsx src/server.ts
  ```
  The `ingestion-worker` Dockerfile is byte-for-byte the same recipe except: no `EXPOSE`, and `CMD ["pnpm","--filter","@ollive/ingestion-worker","start"]` (= `tsx src/main.ts`).
- **`.dockerignore`:** `node_modules`, `**/node_modules`, `**/dist`, `.env`, `.env.*` (but the example is irrelevant inside the image), `**/*.log`, `.git`, `docs`, `test/e2e` (the E2E runs on the host against the running stack, not inside the image). Excluding `node_modules` is essential so the local host install never shadows the in-image install.
- **Patterns / decisions / edge cases:**
  - **Single shared base recipe** for api + worker (rather than a separate `base` image target) keeps each Dockerfile self-contained and independently buildable; the duplication is two files differing only in `CMD`, which is easier to review than an indirection. (If the implementer prefers a shared base stage, that is acceptable — but it must not change the install strategy.)
  - **Why root context, not app context:** documented above — `workspace:*` resolution.
  - **Edge case — stale lockfile:** `--frozen-lockfile` fails the build loudly if `pnpm-lock.yaml` doesn't match the manifests; this is intended (forces a deterministic, committed lockfile). The fix is `pnpm install` locally + commit the lockfile, never `--no-frozen-lockfile` in the image.
  - **Risk acknowledged (not fixed here):** running `tsx` in the container is a development-grade runtime (TS transpiled on the fly, no precompiled JS). This is a deliberate simplification consistent with PRD §25 / NG4 (the compose file IS the deployment artifact; not production-hardened). Recorded in the README "Production notes" section (Task 6).

**Verification (how to prove it works):**
- `docker build -f apps/api/Dockerfile -t ollive-api .` (from repo root) completes; `docker run --rm ollive-api node -e "process.exit(0)"` exits 0 (image runs Node). The install layer is present (`docker history ollive-api` shows the `pnpm install` layer).
- `docker build -f apps/ingestion-worker/Dockerfile -t ollive-worker .` completes.
- A second `docker build` of the api with only an app **source** change (touch `apps/api/src/server.ts`) reuses the cached `pnpm install` layer (build log shows `CACHED` on the install step) — proves the manifest-first ordering works.

**Done when:** both images build from the repo-root context with `--frozen-lockfile`; the install layer caches across source-only rebuilds; commit `feat(deploy): add api and ingestion-worker Dockerfiles with pnpm workspace install`.

---

## Task 2: web Dockerfile (multi-stage) + nginx config (single-origin reverse proxy)
**Implements:** DE2 (the `web` service: build SPA → nginx), the **web→api connectivity decision**, NFR6.
**Files:**
- Create: `apps/web/Dockerfile` — stage 1 builds the SPA, stage 2 serves it from nginx.
- Create: `apps/web/nginx.conf` — SPA history fallback + reverse-proxy `/v1`, `/auth`, `/healthz` to `api`.
- Create: `apps/web/.dockerignore`.

**Design:**
- **web→api connectivity — DECISION: same-origin reverse proxy (justify):** nginx serves the SPA **and** proxies the API paths to the `api` service on the compose network, so the browser only ever talks to `http://localhost:8080` (the web origin). Justification:
  - **Eliminates CORS entirely** for the one-command path — the cookie-based auth (httpOnly JWT, SameSite=Lax, BE8/SE3/SE4) and credentialed fetches just work, because everything is same-origin. No `WEB_ORIGIN`/CORS dance is required for the happy path.
  - **Simplest for `docker compose up`** (AC11): one published port, no per-environment API base URL baked into the SPA build.
  - The SPA is built to call **relative** paths (`/v1/...`, `/auth/...`) so no build-time API URL is needed; nginx routes them. `WEB_ORIGIN` remains documented in `.env.example` and is still honored by the API's CORS config (BE8) for the alternative separate-origin deployment, but is not exercised by the default proxied path.
- **nginx.conf — key directives:**
  ```nginx
  server {
    listen 80;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;

    # SPA history fallback — unknown paths serve index.html (client-side routing)
    location / {
      try_files $uri $uri/ /index.html;
    }

    # Reverse-proxy API paths to the api service (single origin → no CORS)
    location /v1/   { proxy_pass http://api:4000; }
    location /auth/ { proxy_pass http://api:4000; }
    location /healthz { proxy_pass http://api:4000; }

    # SSE support for the chat stream (POST /v1/conversations/:id/messages):
    # disable buffering + proxy timeouts long enough for streamed responses
    # (applied within the /v1/ location): proxy_buffering off; proxy_read_timeout 1h;
    # proxy_set_header Connection ''; proxy_http_version 1.1;
  }
  ```
  - **SSE correctness (load-bearing):** the chat path streams Server-Sent Events (PRD §17). nginx **must** set `proxy_buffering off`, `proxy_http_version 1.1`, clear the `Connection` header, and use a long `proxy_read_timeout` for the `/v1/` location, or tokens will be buffered and the stream will appear frozen. This is the one non-obvious nginx requirement.
  - Forward `Host` + `X-Forwarded-*` headers so the API's correlation/logging and cookie domain behave correctly.
- **web Dockerfile outline — two stages:**
  ```dockerfile
  # --- build stage ---
  FROM node:20-bookworm-slim AS build
  RUN corepack enable && corepack prepare pnpm@9 --activate
  WORKDIR /app
  COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
  COPY packages/*/package.json …  apps/*/package.json …   # same manifest-first copy as Task 1
  RUN pnpm install --frozen-lockfile
  COPY . .
  RUN pnpm --filter @ollive/web build                      # → apps/web/dist
  # --- runtime stage ---
  FROM nginx:1.27-alpine
  COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
  COPY --from=build /app/apps/web/dist /usr/share/nginx/html
  EXPOSE 80
  ```
- **Patterns / decisions / edge cases:**
  - Multi-stage keeps the runtime image to nginx + static assets (no Node, no `node_modules`) — small and production-shaped for the static tier.
  - The build stage reuses Task 1's manifest-first install strategy (workspace consistency).
  - **Edge case — relative API base in the SPA:** Plan 6's SPA must use relative URLs (or a base that defaults to same-origin) so the proxied path works without a build-time env. If Plan 6 baked an absolute `VITE_API_URL`, set it to empty/relative for the compose build (documented note for the implementer to reconcile with Plan 6).
  - **Edge case — `try_files` vs proxied paths:** the API `location` blocks are matched before the SPA fallback, so `/v1/...` never falls through to `index.html`.

**Verification (how to prove it works):**
- `docker build -f apps/web/Dockerfile -t ollive-web .` completes; the runtime image contains `/usr/share/nginx/html/index.html` (`docker run --rm ollive-web ls /usr/share/nginx/html` shows the built assets) and `/etc/nginx/conf.d/default.conf`.
- `nginx -t` passes inside the image (`docker run --rm ollive-web nginx -t` → `syntax is ok` / `test is successful`).
- (Full proxy behavior is proven once the stack is up in Task 5 — `curl http://localhost:8080/healthz` returns the API's `{status:'ok'}`, and `curl http://localhost:8080/` returns the SPA HTML.)

**Done when:** the web image builds, contains the static SPA + nginx config, and `nginx -t` passes; commit `feat(deploy): add web multi-stage Dockerfile and single-origin nginx reverse proxy`.

---

## Task 3: Extend `infra/docker-compose.yml` with api, ingestion-worker, web services
**Implements:** DE1 (full stack from a clean checkout), DE2 (services table), DE3 (migrations on startup — via correct ordering), DE4 (healthchecks), DE6 (`AUTH_MODE=dev` default). Builds on Plan 1's existing `postgres` + `redis` services — **does not recreate them**.
**Files:**
- Edit: `infra/docker-compose.yml` — keep the existing `postgres`, `redis`, and `pgdata` volume verbatim; add `api`, `ingestion-worker`, `web`.

**Design:**
- **Service graph (depends_on + healthcheck summary):**
  ```
  postgres (image postgres:16)   healthcheck: pg_isready -U ollive            [Plan 1, unchanged]
  redis    (image redis:7)       healthcheck: redis-cli ping                  [Plan 1, unchanged]
  api      (build apps/api)      depends_on: postgres(service_healthy),
                                             redis(service_healthy)
                                 healthcheck: curl -fsS http://localhost:4000/healthz
                                 ports: 4000:4000
  worker   (build apps/ingestion-worker)
                                 depends_on: postgres(service_healthy),
                                             redis(service_healthy)
                                 healthcheck: heartbeat-based (see below)
  web      (build apps/web→nginx)
                                 depends_on: api(service_healthy)
                                 ports: 8080:80
  ```
- **Compose service shapes — key directives (prose + snippet):**
  - **`api`:**
    ```yaml
    api:
      build:
        context: ..                 # repo root (workspace install needs root + all manifests)
        dockerfile: apps/api/Dockerfile
      env_file: .env                # DE5 vars (secrets + tunables) from the operator's .env
      environment:                  # container-internal overrides (Pinned facts)
        DATABASE_URL: postgres://ollive:ollive@postgres:5432/ollive
        REDIS_URL: redis://redis:6379
        PORT: "4000"
        # AUTH_MODE inherited from .env (default dev); GEMINI_API_KEY inherited (optional)
      depends_on:
        postgres: { condition: service_healthy }
        redis:    { condition: service_healthy }
      ports: ["4000:4000"]
      healthcheck:
        test: ["CMD-SHELL", "curl -fsS http://localhost:4000/healthz || exit 1"]
        interval: 5s
        timeout: 3s
        retries: 20
        start_period: 30s           # allow time for migrations on first boot
    ```
    > `curl` must exist in the api image — the `node:20-bookworm-slim` base **does not** include it by default, so the api Dockerfile (Task 1) must `apt-get install -y --no-install-recommends curl` (small, documented). Alternatively use a Node-based healthcheck (`node -e "fetch('http://localhost:4000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"`) to avoid installing curl — **prefer the Node one-liner** since it needs no extra package and Node 20 has global `fetch`. Pick the Node form; record the choice in the Dockerfile.
  - **`ingestion-worker`:** same `build`/`env_file`/`environment` (DATABASE_URL + REDIS_URL overrides) + same `depends_on` on postgres/redis healthy. **No published ports.** Healthcheck options for a process with no HTTP port:
    - **Chosen approach:** the worker writes a readiness file when its heartbeat fires (`main.ts` already logs `'ingestion worker ready'`; have it also `touch /tmp/worker-ready` once `ensureGroup` succeeds — a one-line addition coordinated with Plan 3 Task 14), and the healthcheck is `test: ["CMD-SHELL", "test -f /tmp/worker-ready"]`. This is robust and needs no extra tooling.
    - If touching the worker source is undesired, fall back to a process-liveness check (`pgrep -f "tsx src/main.ts"`), which proves the process is alive but not that it joined the group. Document whichever is used. Prefer the readiness-file approach because `web` does **not** depend on the worker, so a coarse worker healthcheck is acceptable but the readiness file gives a truer signal.
  - **`web`:**
    ```yaml
    web:
      build:
        context: ..
        dockerfile: apps/web/Dockerfile
      depends_on:
        api: { condition: service_healthy }
      ports: ["8080:80"]
      healthcheck:
        test: ["CMD-SHELL", "wget -qO- http://localhost/ >/dev/null 2>&1 || exit 1"]
        interval: 10s
        timeout: 3s
        retries: 5
    ```
    (`wget` is present in `nginx:alpine`; use it rather than curl for the web healthcheck.)
- **Migrations & the race (DE3 — the key ordering decision):** both `api` and `worker` call `runMigrations` on startup. With `depends_on: condition: service_healthy` on Postgres, both wait for Postgres before running — but they may run `runMigrations` **concurrently**. Drizzle's `postgres-js` migrator takes a Postgres advisory/transaction lock around migration application and records applied migrations in `__drizzle_migrations`, so concurrent runners are safe: one applies, the other sees the migrations already recorded and no-ops. **Decision:** rely on this idempotency (it is the documented Drizzle behavior and matches DE3 "created idempotently") rather than adding a separate one-shot migrate service — keeping the compose to the five PRD services. **This migration-race property is explicitly called out as a deployment risk to verify** (Task 5 verification asserts the stack converges to healthy with no duplicate-migration error in either service's logs).
- **Patterns / decisions / edge cases:**
  - `condition: service_healthy` (not bare `depends_on`) is what makes startup ordering real — without it, `api` could start before Postgres accepts connections. This directly satisfies DE3 (migrations run only after Postgres is ready) and DE4.
  - `start_period: 30s` on the api healthcheck prevents the first-boot migration window from being counted as failing health.
  - The `environment:` block **overrides** any `DATABASE_URL`/`REDIS_URL` in `.env` (which point at `localhost` for host-side dev) with the container-network hostnames (`postgres`, `redis`). Everything else (secrets, `AUTH_MODE`, `GEMINI_API_KEY`, tunables) flows from `env_file: .env`.
  - `web` depends on `api` healthy (DE2 "web depends on api"); it does **not** depend on the worker (the SPA never talks to the worker directly).
  - Compose project is invoked as `docker compose -f infra/docker-compose.yml up`; `env_file: .env` and build `context: ..` are resolved relative to the compose file's directory (`infra/`), so `.env` is read from `infra/.env`. **Decision:** to keep one `.env` at repo root (matching Plans 1–3), set `env_file: ../.env` and `context: ..`. Document this path explicitly so the operator's `cp .env.example .env` at repo root is the file compose reads.

**Verification (how to prove it works):**
- `docker compose -f infra/docker-compose.yml config` validates and prints the merged config showing all five services with the expected `depends_on` conditions and healthchecks (no schema errors).
- After `docker compose -f infra/docker-compose.yml up -d` (with a `.env` present), `docker compose -f infra/docker-compose.yml ps` eventually shows `postgres`, `redis`, `api`, `web` as `healthy` and `ingestion-worker` as `healthy` (readiness file) / `running`.
- `docker compose logs api` shows `migrations applied` then `api listening`; `docker compose logs ingestion-worker` shows `ingestion worker ready`; **neither** logs a migration conflict/duplicate-key error (proves the race is benign).

**Done when:** `docker compose config` validates the five-service graph and `up -d` brings all services to healthy from a clean state with no migration errors; commit `feat(deploy): add api, worker, and web services to docker-compose with healthchecks and ordering`.

---

## Task 4: `.env.example` — full DE5 variable set with safe defaults
**Implements:** DE5 (documented env var coverage), DE6 (`AUTH_MODE=dev` default), SE1 (secrets via env; example documents without real values). Extends Plan 1's two-var file and Plan 3's API/worker additions into the complete deployment surface.
**Files:**
- Edit: `.env.example` — replace with the complete, commented DE5 set (superset of Plans 1 & 3 vars).

**Design:**
- **Contract — every DE5 variable present, with non-secret defaults + a comment per var:**
  ```dotenv
  # ── Datastores (host-facing defaults; compose overrides these to postgres:// @postgres and redis:// @redis) ──
  DATABASE_URL=postgres://ollive:ollive@localhost:5432/ollive
  REDIS_URL=redis://localhost:6379

  # ── Auth ──
  AUTH_MODE=dev                       # 'dev' = auto-auth a seeded demo user (no Google creds needed). 'google' = real OAuth.
  GOOGLE_CLIENT_ID=                   # required only when AUTH_MODE=google
  GOOGLE_CLIENT_SECRET=               # required only when AUTH_MODE=google (secret — never commit a real value)
  JWT_SECRET=dev-jwt-secret-change-me # signs the session cookie (SE3). Change for any non-local use.

  # ── Ingestion (service-to-service) ──
  INGESTION_API_KEY=dev-ingestion-key # SDK sends `Authorization: Bearer <key>` to /v1/logs (AU5/SE2)

  # ── LLM provider ──
  GEMINI_API_KEY=                     # REQUIRED for live chat. Stack runs without it, but chat generation will fail.
  DEFAULT_MODEL=gemini-2.5-flash      # default model (A10)
  CONTEXT_TOKEN_BUDGET=4000           # token-budget sliding window for context (A3/BE5)

  # ── Web / CORS ──
  WEB_ORIGIN=http://localhost:8080    # the SPA origin; used by API CORS (BE8/SE4). With the nginx reverse proxy the happy path is same-origin.

  # ── Guest trial ──
  GUEST_MESSAGE_LIMIT=2               # anonymous messages allowed before sign-in (A11/FR15)
  GUEST_SESSION_TTL=86400             # guest session / Redis counter TTL in seconds (AU7)

  # ── Privacy ──
  PII_REDACTION=pattern               # 'pattern' (default) | 'off' | 'llm' — telemetry PII scrubbing (SDK9/SE6)

  # ── (Plan 3 tunables — optional; defaults applied if omitted) ──
  PORT=4000
  INGESTION_STREAM_MAXLEN=100000
  WORKER_CONSUMER_NAME=worker-1
  WORKER_BATCH_SIZE=50
  WORKER_BLOCK_MS=5000
  WORKER_MAX_DELIVERIES=3
  WORKER_CLAIM_IDLE_MS=30000
  ```
- **Patterns / decisions / edge cases:**
  - **Every one of the 15 DE5-named vars is present:** `DATABASE_URL`, `REDIS_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `JWT_SECRET`, `INGESTION_API_KEY`, `AUTH_MODE`, `GEMINI_API_KEY`, `DEFAULT_MODEL`, `CONTEXT_TOKEN_BUDGET`, `WEB_ORIGIN`, `GUEST_MESSAGE_LIMIT`, `GUEST_SESSION_TTL`, `PII_REDACTION` — plus the Plan 3 tunables already in the file.
  - **Secrets are blank or clearly-fake-with-warning** (`GOOGLE_CLIENT_SECRET=`, `GEMINI_API_KEY=`, `JWT_SECRET=dev-...-change-me`) — SE1: the example documents required vars without shipping real secrets.
  - **`AUTH_MODE=dev` is the default value in the example** so `cp .env.example .env && docker compose up` is genuinely one-command (DE6/AC11).
  - **`GEMINI_API_KEY` is documented as REQUIRED-for-chat but blank** — the comment states plainly that the stack comes up without it and only live chat fails. This is the explicit no-mock-provider decision surfaced where the operator will see it.
  - The two datastore URLs keep their **host-facing** `localhost` values (so host-side `pnpm db:migrate` / the E2E run against host ports still work); the comment notes the compose overrides them to the container hostnames. This dual-purpose is intentional and documented.

**Verification (how to prove it works):**
- `grep -E '^(DATABASE_URL|REDIS_URL|GOOGLE_CLIENT_ID|GOOGLE_CLIENT_SECRET|JWT_SECRET|INGESTION_API_KEY|AUTH_MODE|GEMINI_API_KEY|DEFAULT_MODEL|CONTEXT_TOKEN_BUDGET|WEB_ORIGIN|GUEST_MESSAGE_LIMIT|GUEST_SESSION_TTL|PII_REDACTION)=' .env.example` returns **14 lines** (all DE5 vars present).
- `cp .env.example .env` produces a `.env` that, with `AUTH_MODE=dev`, requires **no edits** to bring the stack up (only live chat needs `GEMINI_API_KEY` filled in).

**Done when:** all 14 DE5 vars are present with comments and safe defaults, `AUTH_MODE=dev` is the default, and a fresh copy needs no edits for the one-command path; commit `docs(deploy): document full .env.example with DE5 variables and safe defaults`.

---

## Task 5: Idempotent dev-user seed (DE7)
**Implements:** DE7 (a seed step creates the demo user in dev mode, safe to re-run), AU4/A5 (dev-mode auto-auth resolves to this seeded user), DE3 (runs after migrations).
**Files:**
- (Primary, design-level) `apps/api/src/seed.ts` — `seedDevUser(db, env)`: idempotent upsert of the demo user. *(Coordinated with Plan 4's auth; if Plan 4 already provides dev-user resolution, this task wires/confirms the seed rather than duplicating it.)*
- Edit: `apps/api/src/server.ts` — call `seedDevUser` after `runMigrations` when `AUTH_MODE=dev`.
- (Optional) Edit: `package.json` — a `seed` script (`pnpm --filter @ollive/api exec tsx src/seed.ts`) for manual re-runs.

**Design:**
- **Contract:**
  ```ts
  // demo identity is deterministic so dev-mode auto-auth always resolves the same row
  const DEV_USER = {
    googleSub: 'dev|seed-user',           // stable synthetic OIDC subject (users.google_sub is UNIQUE NOT NULL)
    email: 'demo@ollive.local',
    name: 'Demo User',
  };
  function seedDevUser(db: Db): Promise<{ id: string }>;  // returns the (existing or created) user id
  ```
- **Algorithm (idempotent upsert):** `INSERT INTO users (...) VALUES (...) ON CONFLICT (google_sub) DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name RETURNING id` — via Drizzle `db.insert(users).values(DEV_USER).onConflictDoUpdate({ target: users.googleSub, set: {...} }).returning()`. Conflict on the UNIQUE `google_sub` (PRD §10) makes re-runs safe — second and later runs update-in-place and return the same `id`, never creating a duplicate.
- **Where it runs (decision):** inside `api` startup (`server.ts`), guarded by `AUTH_MODE === 'dev'`, immediately after `await runMigrations(...)` and before `app.listen`. Rationale:
  - It must run **after** migrations (the `users` table must exist) and **before** the first dev-auth request resolves the user — startup is the natural place (no extra one-shot service, keeping the five-service compose).
  - Worker does **not** seed (it has no auth concern); only the api seeds, so there is no double-seed race. (Even if both seeded, the `ON CONFLICT` upsert is safe.)
  - In `AUTH_MODE=google` the seed is skipped (real users come from OAuth).
- **Patterns / decisions / edge cases:**
  - Idempotent-upsert pattern over a UNIQUE natural key (mirrors the worker's `request_id` upsert from Plan 3 — consistent house style).
  - Deterministic `googleSub`/`email` so the seeded identity is stable across restarts and the dev auth provider (Plan 4) can resolve it without configuration.
  - Edge case — running the optional `seed` script while the api is already up: still safe (upsert), returns the same id.

**Verification (how to prove it works):**
- After `docker compose up`, `docker compose exec postgres psql -U ollive -d ollive -c "select count(*) from users where google_sub='dev|seed-user';"` returns `1`.
- Restart the api (`docker compose restart api`) and re-query → still `1` (no duplicate; idempotent).
- Running the optional `seed` script twice in a row succeeds both times and the count stays `1`.

**Done when:** the demo user exists exactly once after one-command up, re-running the seed (or restarting api) never duplicates it, and dev-mode auth resolves to it; commit `feat(deploy): add idempotent dev-user seed on api startup`.

---

## Task 6: One-command verification + README run instructions
**Implements:** DE1/AC11 (`docker compose up` brings up the whole system from a clean checkout with a documented `.env`), NFR6 (portability), and the explicit "what needs real keys" documentation.
**Files:**
- Edit (or Create if absent): `README.md` — a "Run it" section + the manual live-chat smoke + production/limitations notes.

**Design:**
- **README "Run it" section (contract — the documented one-command flow):**
  1. `cp .env.example .env` (no edits required for the dev path).
  2. `docker compose -f infra/docker-compose.yml up --build` (or `up -d`).
  3. Wait until `docker compose ps` shows `postgres`, `redis`, `api`, `web` healthy and `ingestion-worker` healthy/running.
  4. Open `http://localhost:8080` — the SPA loads; in `AUTH_MODE=dev` you are auto-authenticated as the seeded demo user.
  5. Conversations, lists, resume, and the **dashboards** (which read from `inference_logs` populated by the pipeline) all work without any external key.
- **"What needs a real key" (explicit, load-bearing):** a short, prominent subsection stating: *live chat generation requires a real `GEMINI_API_KEY` in `.env` (no mock provider ships).* Without it, the app comes up, dev auth works, conversations CRUD works, and the ingestion pipeline + dashboards work (the automated E2E in Task 7 proves this) — but sending a chat message that calls Gemini will fail. To enable chat: set `GEMINI_API_KEY=...` in `.env` and `docker compose up -d` (recreates `api` with the new env).
- **Manual live-chat smoke (documented, NOT automated — needs the real key):** describe the steps so a reviewer can reproduce: with `GEMINI_API_KEY` set, open `http://localhost:8080`, start a new chat, send "Plan a 3-day trip to Kyoto", observe tokens streaming in (SSE), click **Stop** mid-stream and confirm the partial reply is preserved, then open Dashboards and confirm a new `inference_logs`-derived data point appears (latency/tokens), and confirm a `cancelled` log for the stopped turn. State that this is manual because it costs a real model call.
- **Real-OAuth note:** to use real Google sign-in set `AUTH_MODE=google` + `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` and configure the redirect URI to `http://localhost:8080/auth/google/callback` (proxied to the api).
- **Production/limitations notes (honesty, ties to PRD §25/NG4):** the compose file is the deployment artifact (no k8s/IaC); the Node services run via `tsx` (dev-grade runtime, TS transpiled at runtime — fine for the assignment, not production-hardened); TLS is assumed terminated upstream (A9); migrations run on startup and rely on Drizzle's idempotent migrator for the api/worker concurrent-run case.
- **Patterns / decisions / edge cases:** keep the run section copy-pasteable; lead with the zero-key path (AC11), then the key-required path. Note the `--build` flag is needed on first run (or after Dockerfile/source changes) since the images are built locally.

**Verification (how to prove it works):**
- Following the README literally from a clean checkout (`git clean -fdx` of build artifacts, then `cp .env.example .env`, then `docker compose -f infra/docker-compose.yml up --build -d`) brings all services healthy and serves the SPA at `http://localhost:8080` — **with no edits to `.env`** (proves AC11/DE1).
- `curl -fsS http://localhost:8080/healthz` returns the API's `{"status":"ok"}` through the nginx proxy (proves single-origin proxy + api reachability).
- The README's "what needs a real key" subsection is present and unambiguous.

**Done when:** a clean-checkout `docker compose up` per the README brings the whole system healthy and serves the SPA with zero `.env` edits, and the key-required behavior is documented; commit `docs(deploy): add one-command run instructions and manual chat smoke to README`.

---

## Task 7: Automated end-to-end smoke test (no external key) (TDD)
**Implements:** AC7/AC16 (logs reach Postgres via `/v1/logs` → Redis Streams → worker; event-driven architecture proven end-to-end), AC11-adjacent (the running stack is exercised), plus dev-mode auth (AC1 dev path) and conversations CRUD (AC5 create/list/get over HTTP). Live chat (Gemini) is **excluded** — it is the manual smoke (Task 6).
**Files:**
- Create: `test/e2e/helpers.ts` — base-URL config, HTTP client wrapper (carries the dev-auth cookie), and a `pollUntil(fn, {timeoutMs, intervalMs})` helper for the asynchronous pipeline assertion.
- Create: `test/e2e/smoke.e2e.test.ts` — the cross-process E2E scenarios (behavioral cases below).
- Edit: `vitest.workspace.ts` — add an `e2e` project (`root: '.'`, `include: ['test/e2e/**/*.e2e.test.ts']`, `testTimeout: 30000`, `fileParallelism: false`).
- Edit: `package.json` — `e2e` (assumes a stack is already up) and `e2e:compose` (brings the stack up, runs, tears down) scripts.

**Design:**
- **How the E2E runs (decision):** it is a **black-box HTTP client of the running compose stack** — it does not import app code, it talks over the published ports. Base URLs come from env so the same test runs against compose or a hand-started pair of processes:
  - `OLLIVE_E2E_API_URL` (default `http://localhost:4000`) — the api (used directly for `/v1/logs` with the ingestion key and for auth/conversations).
  - `OLLIVE_E2E_WEB_URL` (default `http://localhost:8080`) — optional, to additionally assert the nginx proxy path serves `/healthz` and the SPA.
  - `OLLIVE_E2E_DB_URL` (default the host-facing `DATABASE_URL`) — to assert the row landed in `inference_logs` (read-only) via `@ollive/db`'s `createDb`.
  - `INGESTION_API_KEY` — must match the running api's key (read from the same `.env`).
  - **Opt-in:** if `OLLIVE_E2E_API_URL` is unset AND no stack is detected, the `e2e` project is skipped (so `pnpm test` for unit suites is unaffected). `e2e:compose` sets the vars and orchestrates the stack.
- **`e2e:compose` script behavior:** `docker compose -f infra/docker-compose.yml up -d --build` → wait for api `/healthz` and the worker readiness (poll) → `vitest run --project e2e` → (always) `docker compose -f infra/docker-compose.yml down -v`. This gives a single command that proves the whole assignment's plumbing.
- **Algorithm / approach per scenario:** the test uses the real wire contracts (`@ollive/shared`'s `inferenceLogSchema` to build a valid log; the `/v1/*` JSON contracts from PRD §8). The pipeline assertion is **eventual** — after `POST /v1/logs` returns `202`, poll `inference_logs` (and `/v1/metrics/*`) until the row appears or a timeout (NFR3: end-to-end visibility under ~2 s at demo scale; the poll budget is generous, e.g. 15 s, to absorb container scheduling).

**Verification — automated E2E behavioral cases (write first, TDD; expressed in words):**
- **Pipeline happy path (AC7/AC16) — the core proof:**
  - Build a valid `InferenceLog` (unique `requestId`, provider `google`, model `gemini-2.5-flash`, `status: 'success'`, plausible usage/timing, a preview containing a recognizable token), `POST /v1/logs` with `Authorization: Bearer <INGESTION_API_KEY>` → assert `202` with `{ accepted: true, requestId }`.
  - Poll `inference_logs` by `request_id` until a row exists → assert it carries the right `provider`/`model`/`total_tokens`, a populated `estimated_cost_usd` (worker extraction ran, IN10), and `error_category` null. This proves `/v1/logs` → Redis Streams → worker → Postgres across **separate processes**.
  - Then `GET /v1/metrics/overview?from=&to=` (within the time window) → assert `requests` count increased / the new log is reflected (token totals or request count moved). Proves the metrics layer reads what the pipeline wrote.
- **Ingestion auth (AC9):** `POST /v1/logs` with **no** / a wrong Bearer key → `401 { error: 'unauthorized' }`; and a malformed body with a valid key → `400 { error: 'validation_error' }` with `details`. (Confirms the receiver gates the pipeline.)
- **Idempotency (AC8):** `POST /v1/logs` the **same** `requestId` twice → both `202`; after the poll, exactly **one** `inference_logs` row for that `request_id` (worker upsert dedup).
- **Dev-mode auth (AC1 dev path):** with `AUTH_MODE=dev`, `GET /v1/session` → `authenticated: true` with the seeded demo user, OR the documented dev sign-in route returns a session cookie; subsequent calls carry it. Assert the user resolves to the seeded `demo@ollive.local`. (Proves DE6/DE7 wired together.)
- **Conversations CRUD over HTTP (AC5 create/list/get):**
  - `POST /v1/conversations` (authed) → `201` with `id`, `title: 'New conversation'`, `status: 'active'`, `provider`/`model`, timestamps.
  - `GET /v1/conversations?status=active` → the created conversation appears in the list (most-recent-first).
  - `GET /v1/conversations/:id` → returns the conversation with a `messages` array (empty for a fresh conversation). **No chat send** (that needs Gemini) — CRUD only.
- **(Optional) Single-origin proxy:** `GET {OLLIVE_E2E_WEB_URL}/healthz` returns the api's `{status:'ok'}` and `GET {OLLIVE_E2E_WEB_URL}/` returns SPA HTML — proving nginx proxies API paths and serves the SPA (Task 2 decision).
- **Explicitly NOT automated:** sending a message that calls Gemini, token streaming, and cancel — these require a real key and are the manual smoke in Task 6.

**Done when:** with the stack up, `pnpm e2e` passes all the above cases without any `GEMINI_API_KEY`, and `pnpm e2e:compose` brings the stack up, passes, and tears it down; the `e2e` project is skipped when no stack is present so unit suites are unaffected; commit `test(deploy): add automated cross-process e2e smoke for pipeline, dev-auth, and conversations CRUD`.

---

## Definition of Done

- [ ] `apps/api/Dockerfile`, `apps/ingestion-worker/Dockerfile`, and `apps/web/Dockerfile` build from the **repo-root context** with `pnpm install --frozen-lockfile` (manifest-first layering caches across source-only rebuilds).
- [ ] `apps/web/nginx.conf` serves the SPA with history fallback and **reverse-proxies** `/v1`, `/auth`, `/healthz` to `api` (single origin, no CORS), with SSE-safe proxy settings (`proxy_buffering off`, long read timeout, HTTP/1.1).
- [ ] `infra/docker-compose.yml` defines all five services (Plan 1's `postgres`+`redis` unchanged + new `api`, `ingestion-worker`, `web`) with `depends_on: condition: service_healthy`, per-service healthchecks (api `/healthz` via Node fetch, worker readiness file, web `wget`), container-internal `DATABASE_URL`/`REDIS_URL` overrides, and published ports `4000` (api) + `8080` (web).
- [ ] `docker compose -f infra/docker-compose.yml config` validates; `up -d` from a clean checkout (after `cp .env.example .env`, **no edits**) brings every service healthy with no migration error in api/worker logs.
- [ ] `.env.example` documents all 14 DE5 vars (+ Plan 3 tunables) with comments and safe defaults; `AUTH_MODE=dev` is the default; `GEMINI_API_KEY` is documented as required-for-chat-only.
- [ ] Dev-user seed runs idempotently on api startup in dev mode; the demo user exists exactly once and survives restarts/re-seeds (DE7).
- [ ] README documents the one-command flow, the manual live-chat smoke, exactly what needs a real key, and the production/limitations notes.
- [ ] `pnpm e2e:compose` proves, with **no external key**, the full event pipeline (`/v1/logs` → Redis → worker → `inference_logs` → `/v1/metrics`), ingestion auth (401/400), idempotency (one row per `request_id`), dev-mode auth, and conversations CRUD; live chat remains manual.

### Requirement → task coverage check

| Requirement | Where |
|---|---|
| DE1 — `docker compose up` from a clean checkout | Tasks 3, 6 |
| DE2 — services table (postgres, redis, api, worker, web) | Tasks 1, 2, 3 |
| DE3 — migrations run automatically on api/worker startup (idempotent) | Task 3 (ordering + the documented Drizzle migration-race property), relies on Plans 3/4 |
| DE4 — healthchecks (pg/redis native; api `/healthz`+`/readyz`; worker heartbeat) | Task 3 |
| DE5 — documented `.env.example` (all 14 vars) | Task 4 |
| DE6 — `AUTH_MODE=dev` default → one-command up without Google creds | Tasks 3, 4 |
| DE7 — idempotent dev-user seed | Task 5 |
| §4.4 — two Node deployables (api + worker) | Tasks 1, 3 |
| §6 NFR6 — portability via `docker compose up` + documented `.env` | Tasks 3, 4, 6 |
| §8.6 / OB4 — `/healthz`+`/readyz` used as healthchecks | Task 3 (consumes Plan 3) |
| §22 OB3/OB4 — worker counters/heartbeat + api health | Task 3 (worker readiness/heartbeat), consumes Plan 3 |
| AC7 — logs reach Postgres via `/v1/logs` → Redis Streams → worker; chat never blocks on logging | Task 7 (pipeline case) |
| AC16 — event-based architecture (Redis Streams, consumer group, idempotent worker) | Task 7 (pipeline + idempotency cases) |
| AC8 — duplicate `request_id` does not duplicate the row | Task 7 (idempotency case) |
| AC9 — `/v1/logs` rejects bad key (401) + malformed (400) | Task 7 (auth case) |
| AC11 / AC15 — one-command compose from clean checkout | Tasks 3, 6 |
| AC1 (dev path) / AC5 (list/resume CRUD) | Task 7 (dev-auth + conversations cases) |
| AC2/AC4 live chat + cancel (manual, needs real key) | Task 6 (manual smoke — not automated) |
| §25 simplifications — `tsx` runtime, compose-is-the-artifact, no-mock-provider | Tasks 1, 6 (documented as risks/notes) |

This plan is the final plan (7 of 7). It consumes Plan 1 (infra base + `@ollive/db`/`@ollive/shared`), Plan 2 (`@ollive/llm-sdk`), Plan 3 (`apps/api` receiver + health + `apps/ingestion-worker`), Plans 4 & 5 (api auth/conversations/chat/metrics routers + env var set), and Plan 6 (`apps/web` static build). It adds no new application logic beyond the dev-user seed wiring (Task 5) and the small worker-readiness touch (Task 3); everything else is configuration artifacts + a black-box E2E.

### Deployment risks (called out, per the task brief)

- **`tsx` in the container runtime** — the api and worker run TypeScript via `tsx` (no precompiled JS). Dev-grade, slightly slower cold start, larger image (full `node_modules` incl. dev deps unless pruned). Deliberate simplification (PRD §25/NG4); documented in the README. Mitigation path if it ever matters: add a `tsc`/`esbuild` build stage and run compiled JS — out of scope here.
- **Migration race (api + worker both call `runMigrations` concurrently)** — both wait for Postgres-healthy, then may run migrations at the same time. Relies on Drizzle's `postgres-js` migrator taking a lock + recording applied migrations in `__drizzle_migrations`, so the second runner no-ops. **Verified** in Task 3 (no duplicate-migration error in either log). If a future Drizzle version weakens this, the fallback is a dedicated one-shot `migrate` service that both `api` and `worker` `depends_on: service_completed_successfully` (adds a sixth service — avoided for now to stay at the five PRD services).
- **No mock LLM provider** — the stack is fully verifiable end-to-end *except* live generation without a real `GEMINI_API_KEY`. The automated E2E sidesteps this by driving the ingestion pipeline directly (a real client/SDK behavior) rather than through a chat turn; chat is the documented manual smoke.
- **nginx SSE buffering** — if the `/v1/` proxy block omits `proxy_buffering off` + HTTP/1.1 + long read timeout, streamed chat tokens buffer and the UI appears frozen even with a valid key. Called out as the one non-obvious nginx requirement (Task 2).
- **Healthcheck tooling in slim images** — `node:20-bookworm-slim` lacks `curl`; the api healthcheck uses a Node `fetch` one-liner to avoid adding a package, and the worker uses a readiness file rather than an HTTP check (it has no port). Documented in Tasks 1 & 3.
