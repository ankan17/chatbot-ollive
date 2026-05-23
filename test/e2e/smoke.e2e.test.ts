/**
 * Automated cross-process E2E smoke test.
 *
 * Talks over HTTP to the running compose stack (published ports).
 * Does NOT import any app code directly at module eval time.
 *
 * SKIP GUARD: the suite is skipped when OLLIVE_E2E !== '1' so `pnpm test`
 * (unit suites) stays green without a running stack.
 *
 * Run with a stack: OLLIVE_E2E=1 pnpm e2e
 * Run with compose: pnpm e2e:compose (builds stack, runs, tears down)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  API_URL,
  WEB_URL,
  DB_URL,
  INGESTION_API_KEY,
  ApiClient,
  pollUntil,
} from './helpers.js';

const E2E = process.env.OLLIVE_E2E === '1';

// These are only populated inside the guarded suite — never at module eval time
// (which would fail when no stack is present, breaking the skip guard).
let db: { select: Function; $client: { end: Function } };
let inferenceLogs: unknown;
let eq: Function;
let inferenceLogSchema: { parse: Function };

describe.runIf(E2E)('Ollive E2E smoke', () => {
  beforeAll(async () => {
    // Dynamically import workspace packages only when the suite actually runs.
    // This prevents module-resolution failures when pnpm test runs without a stack.
    const dbMod = await import('@ollive/db');
    const sharedMod = await import('@ollive/shared');
    const drizzleMod = await import('drizzle-orm');

    db = dbMod.createDb(DB_URL);
    inferenceLogs = dbMod.inferenceLogs;
    eq = drizzleMod.eq;
    inferenceLogSchema = sharedMod.inferenceLogSchema;
  });

  afterAll(async () => {
    if (db) await (db as any).$client.end({ timeout: 5 });
  });

  // ── 1. Pipeline happy path (AC7/AC16) ─────────────────────────────────────
  describe('pipeline happy path', () => {
    let requestId: string;
    let log: Record<string, unknown>;

    beforeAll(() => {
      requestId = crypto.randomUUID();
      const now = new Date().toISOString();

      log = inferenceLogSchema.parse({
        requestId,
        timestamp: now,
        provider: 'google',
        model: 'gemini-2.5-flash',
        status: 'success',
        context: {},
        timing: {
          startedAt: now,
          completedAt: now,
          latencyMs: 420,
          timeToFirstTokenMs: 120,
        },
        usage: {
          promptTokens: 50,
          completionTokens: 80,
          totalTokens: 130,
        },
        preview: { input: 'E2E smoke test input', output: 'E2E smoke test output' },
        error: null,
        metadata: {},
      });
    });

    it('POST /v1/logs → 202 accepted', async () => {
      const res = await fetch(`${API_URL}/v1/logs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${INGESTION_API_KEY}`,
        },
        body: JSON.stringify(log),
      });

      expect(res.status).toBe(202);
      const body = await res.json() as { accepted: boolean; requestId: string };
      expect(body.accepted).toBe(true);
      expect(body.requestId).toBe(requestId);
    });

    it('worker processes log → row appears in inference_logs', async () => {
      const row = await pollUntil(async () => {
        const rows = await (db as any)
          .select()
          .from(inferenceLogs)
          .where(eq(
            (inferenceLogs as any).requestId,
            requestId,
          ))
          .limit(1);
        return rows[0] ?? null;
      }, { timeoutMs: 15_000, intervalMs: 500 });

      expect(row.provider).toBe('google');
      expect(row.model).toBe('gemini-2.5-flash');
      expect(row.totalTokens).toBe(130);
      // Worker extraction ran: estimated_cost_usd should be populated
      expect(row.estimatedCostUsd).not.toBeNull();
      expect(row.errorCategory).toBeNull();
    });

    it('GET /v1/metrics/overview reflects the new log', async () => {
      const client = new ApiClient();
      await client.devLogin();

      // Use a wide time window to capture the just-inserted log
      const from = new Date(Date.now() - 60_000).toISOString();
      const to = new Date(Date.now() + 60_000).toISOString();

      const res = await client.fetch(
        `/v1/metrics/overview?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      );
      expect(res.status).toBe(200);
      const body = await res.json() as { requests: number; totalTokens: number };
      expect(body.requests).toBeGreaterThanOrEqual(1);
      expect(body.totalTokens).toBeGreaterThanOrEqual(130);
    });
  });

  // ── 2. Ingestion auth (AC9) ────────────────────────────────────────────────
  describe('ingestion auth', () => {
    let validLog: Record<string, unknown>;

    beforeAll(() => {
      const ts = new Date().toISOString();
      validLog = inferenceLogSchema.parse({
        requestId: crypto.randomUUID(),
        timestamp: ts,
        provider: 'google',
        model: 'gemini-2.5-flash',
        status: 'success',
        context: {},
        timing: { startedAt: ts, completedAt: ts, latencyMs: 100 },
        usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
        preview: {},
        error: null,
        metadata: {},
      });
    });

    it('no Bearer → 401', async () => {
      const res = await fetch(`${API_URL}/v1/logs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validLog),
      });
      expect(res.status).toBe(401);
      const body = await res.json() as { error: string };
      expect(body.error).toBe('unauthorized');
    });

    it('wrong Bearer → 401', async () => {
      const res = await fetch(`${API_URL}/v1/logs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer wrong-key',
        },
        body: JSON.stringify(validLog),
      });
      expect(res.status).toBe(401);
      const body = await res.json() as { error: string };
      expect(body.error).toBe('unauthorized');
    });

    it('valid key + malformed body → 400 validation_error', async () => {
      const res = await fetch(`${API_URL}/v1/logs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${INGESTION_API_KEY}`,
        },
        body: JSON.stringify({ broken: true }),
      });
      expect(res.status).toBe(400);
      const body = await res.json() as { error: string; details?: unknown };
      expect(body.error).toBe('validation_error');
      expect(body.details).toBeDefined();
    });
  });

  // ── 3. Idempotency (AC8) ───────────────────────────────────────────────────
  describe('idempotency', () => {
    let idempotentId: string;
    let idempotentLog: Record<string, unknown>;

    beforeAll(() => {
      idempotentId = crypto.randomUUID();
      const ts = new Date().toISOString();
      idempotentLog = inferenceLogSchema.parse({
        requestId: idempotentId,
        timestamp: ts,
        provider: 'google',
        model: 'gemini-2.5-flash',
        status: 'success',
        context: {},
        timing: { startedAt: ts, completedAt: ts, latencyMs: 50 },
        usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
        preview: {},
        error: null,
        metadata: {},
      });
    });

    it('same requestId posted twice → both 202, exactly one row', async () => {
      const post = () =>
        fetch(`${API_URL}/v1/logs`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${INGESTION_API_KEY}`,
          },
          body: JSON.stringify(idempotentLog),
        });

      const [r1, r2] = await Promise.all([post(), post()]);
      expect(r1.status).toBe(202);
      expect(r2.status).toBe(202);

      // Wait for worker to process
      await pollUntil(async () => {
        const rows = await (db as any)
          .select()
          .from(inferenceLogs)
          .where(eq((inferenceLogs as any).requestId, idempotentId));
        return rows.length === 1 ? rows : null;
      }, { timeoutMs: 15_000 });

      const rows = await (db as any)
        .select()
        .from(inferenceLogs)
        .where(eq((inferenceLogs as any).requestId, idempotentId));
      expect(rows).toHaveLength(1);
    });
  });

  // ── 4. Dev-mode auth (AC1 dev path) ───────────────────────────────────────
  describe('dev-mode auth', () => {
    it('GET /v1/session → guest initially (no cookie)', async () => {
      const res = await fetch(`${API_URL}/v1/session`);
      expect(res.status).toBe(200);
      const body = await res.json() as { authenticated: boolean };
      expect(typeof body.authenticated).toBe('boolean');
    });

    it('dev login flow → authenticated as demo@ollive.local', async () => {
      const client = new ApiClient();
      await client.devLogin();

      const res = await client.fetch('/v1/session');
      expect(res.status).toBe(200);
      const body = await res.json() as { authenticated: boolean; user?: { email: string } };
      expect(body.authenticated).toBe(true);
      expect(body.user?.email).toBe('demo@ollive.local');
    });
  });

  // ── 5. Conversations CRUD (AC5) ───────────────────────────────────────────
  describe('conversations CRUD', () => {
    let conversationId: string;
    let client: ApiClient;

    beforeAll(async () => {
      client = new ApiClient();
      await client.devLogin();
    });

    it('POST /v1/conversations → 201 with expected shape', async () => {
      const res = await client.fetch('/v1/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(201);
      const body = await res.json() as {
        id: string;
        title: string;
        status: string;
        provider: string;
        model: string;
        createdAt: string;
        updatedAt: string;
      };
      expect(body.id).toBeTruthy();
      expect(body.title).toBe('New conversation');
      expect(body.status).toBe('active');
      expect(body.provider).toBeTruthy();
      expect(body.model).toBeTruthy();
      expect(body.createdAt).toBeTruthy();
      expect(body.updatedAt).toBeTruthy();
      conversationId = body.id;
    });

    it('GET /v1/conversations?status=active → created conversation appears', async () => {
      const res = await client.fetch('/v1/conversations?status=active');
      expect(res.status).toBe(200);
      const body = await res.json() as { conversations: Array<{ id: string }> };
      const ids = (body.conversations ?? []).map((c) => c.id);
      expect(ids).toContain(conversationId);
    });

    it('GET /v1/conversations/:id → conversation detail with empty messages', async () => {
      const res = await client.fetch(`/v1/conversations/${conversationId}`);
      expect(res.status).toBe(200);
      const body = await res.json() as { id: string; messages: unknown[] };
      expect(body.id).toBe(conversationId);
      expect(Array.isArray(body.messages)).toBe(true);
      expect(body.messages).toHaveLength(0);
    });
  });

  // ── 6. Single-origin proxy (optional) ─────────────────────────────────────
  describe('single-origin proxy via nginx', () => {
    it('GET {WEB_URL}/healthz → api health response', async () => {
      const res = await fetch(`${WEB_URL}/healthz`);
      expect(res.status).toBe(200);
      const body = await res.json() as { status: string };
      expect(body.status).toBe('ok');
    });

    it('GET {WEB_URL}/ → SPA HTML', async () => {
      const res = await fetch(`${WEB_URL}/`);
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain('<html');
    });
  });
});
