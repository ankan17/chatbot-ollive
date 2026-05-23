#!/usr/bin/env bash
# Bring up the compose stack, run E2E, always tear down.
set -euo pipefail

COMPOSE="docker compose -f infra/docker-compose.yml"

cleanup() {
  echo "==> Tearing down compose stack..."
  $COMPOSE down -v
}
trap cleanup EXIT

echo "==> Starting compose stack..."
$COMPOSE up -d --build

echo "==> Waiting for api /healthz..."
until curl -fsS http://localhost:4000/healthz >/dev/null 2>&1; do
  sleep 2
done
echo "    api is healthy"

echo "==> Waiting for worker readiness..."
# Poll via docker exec since the file is inside the container
WORKER_CONTAINER=$($COMPOSE ps -q ingestion-worker)
until docker exec "$WORKER_CONTAINER" test -f /tmp/worker-ready 2>/dev/null; do
  sleep 2
done
echo "    worker is ready"

echo "==> Running E2E tests..."
# Match the api's ingestion key from .env so the e2e auth succeeds even if the
# operator changed INGESTION_API_KEY from the default (strips any inline comment).
if [ -f .env ] && grep -q '^INGESTION_API_KEY=' .env; then
  INGESTION_API_KEY="$(grep '^INGESTION_API_KEY=' .env | head -1 | cut -d= -f2- | sed 's/[[:space:]]*#.*//; s/[[:space:]]*$//')"
  export INGESTION_API_KEY
fi
OLLIVE_E2E=1 pnpm vitest run --project e2e
