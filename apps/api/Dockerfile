FROM node:20-bookworm-slim
ENV PNPM_HOME=/pnpm CI=true
# Match the lockfile version (lockfileVersion: '9.0' → pnpm 10.x; pin to exact workspace version)
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

WORKDIR /app

# 1) Copy manifests only — keeps the pnpm install layer cached across source-only changes
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json    packages/shared/package.json
COPY packages/db/package.json        packages/db/package.json
COPY packages/llm-sdk/package.json   packages/llm-sdk/package.json
COPY apps/api/package.json           apps/api/package.json
COPY apps/ingestion-worker/package.json apps/ingestion-worker/package.json
COPY apps/web/package.json           apps/web/package.json

RUN pnpm install --frozen-lockfile

# 2) Copy source — reuses the cached install layer above
COPY . .

EXPOSE 4000

# Node 20 has global fetch — no curl needed in the image (healthcheck uses Node one-liner)
CMD ["pnpm", "--filter", "@ollive/api", "start"]
