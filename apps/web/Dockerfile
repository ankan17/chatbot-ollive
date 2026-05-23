# ── build stage ──────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS build
ENV PNPM_HOME=/pnpm CI=true
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

WORKDIR /app

# 1) Manifests only — cache-friendly layer
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json    packages/shared/package.json
COPY packages/db/package.json        packages/db/package.json
COPY packages/llm-sdk/package.json   packages/llm-sdk/package.json
COPY apps/api/package.json           apps/api/package.json
COPY apps/ingestion-worker/package.json apps/ingestion-worker/package.json
COPY apps/web/package.json           apps/web/package.json

RUN pnpm install --frozen-lockfile

# 2) Source
COPY . .

# Build with empty API_BASE_URL so the SPA calls relative /v1/... paths
# that nginx reverse-proxies to the api service (single-origin path)
ENV VITE_API_BASE_URL=
RUN pnpm --filter @ollive/web build

# ── runtime stage ─────────────────────────────────────────────────────────────
FROM nginx:1.27-alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
