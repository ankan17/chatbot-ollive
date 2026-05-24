# Anthropic Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Plan format:** Lean — each task gives the test cases to cover, signatures, algorithm, and the existing file to mirror. It does **not** paste full implementations or full test bodies; the implementer writes those following the referenced pattern (TDD: failing test first).

**Goal:** Add Anthropic (Claude Sonnet 4.6) as a second chat provider and route each conversation to the provider its model belongs to.

**Architecture:** The injected `chatProvider` becomes a thin model-router (`req.model → instrumented provider`), preserving the single-`LLMProvider` seam so `app.ts` / chat route / guest route are untouched. Each underlying provider is individually `withLogging`-wrapped (correct `provider.name` in logs); the router sits outside the wrappers. Anthropic lights up only when `ANTHROPIC_API_KEY` is set.

**Tech Stack:** TypeScript, pnpm workspaces, Vercel AI SDK (`ai@5`, `@ai-sdk/google@2`, new `@ai-sdk/anthropic@2`), Zod, Vitest, Drizzle, Express SSE.

**Spec:** `docs/superpowers/specs/2026-05-24-anthropic-provider-design.md`

**Branch:** `feat/anthropic-provider` (already created; spec committed).

---

## File map

| File | Action | Responsibility |
|---|---|---|
| `packages/llm-sdk/src/providers/normalize.ts` | create | Shared `normalizeUsage` / `normalizeFinishReason` + `AnyUsage` |
| `packages/llm-sdk/src/providers/google.ts` | modify | Import normalizers from `normalize.ts` (drop local copies) |
| `packages/llm-sdk/src/providers/anthropic.ts` | create | `AnthropicProvider` + `anthropicProviderFactory` |
| `packages/llm-sdk/src/providers/router.ts` | create | `createRoutingProvider(resolve)` |
| `packages/llm-sdk/src/index.ts` | modify | Export anthropic + router |
| `packages/llm-sdk/package.json` | modify | Add `@ai-sdk/anthropic` |
| `packages/shared/src/api/models.ts` | modify | `ANTHROPIC_MODELS` |
| `apps/api/src/config.ts` | modify | Optional `ANTHROPIC_API_KEY` → `anthropicApiKey` |
| `apps/api/src/models/catalog.ts` | modify | Gate Anthropic models; add `providerForModel()` |
| `apps/api/src/chat/provider.ts` | create | `buildChatProvider(config, transport)` (testable wiring; refines spec's "server.ts wiring") |
| `apps/api/src/server.ts` | modify | Build one transport + call `buildChatProvider` |
| `apps/api/src/routes/conversations.ts` | modify | Derive stored `provider` from model |
| `.env.example` | modify | `ANTHROPIC_API_KEY=` placeholder |

Test files: `packages/llm-sdk/test/{normalize,anthropic,router}.test.ts`, `apps/api/test/{catalog,chat-provider}.test.ts`, plus a case in the existing conversations integration test.

---

### Task 1: Extract shared normalizers (llm-sdk)

**Files:** Create `packages/llm-sdk/src/providers/normalize.ts`; Modify `packages/llm-sdk/src/providers/google.ts`; Test `packages/llm-sdk/test/normalize.test.ts`

**Signatures (move verbatim from `google.ts` lines 9-42):**
```ts
export interface AnyUsage { inputTokens?: number; outputTokens?: number; promptTokens?: number; completionTokens?: number; totalTokens?: number }
export function normalizeUsage(u: AnyUsage): { promptTokens: number; completionTokens: number; totalTokens: number }
export function normalizeFinishReason(r: string | undefined): StreamChunk['finishReason']  // import StreamChunk from '../types.js'
```

- [ ] **Step 1 — failing tests.** Cover: `inputTokens/outputTokens` spelling maps to prompt/completion; `promptTokens/completionTokens` fallback; missing values → 0; `totalTokens` derived when absent. Finish reasons: `stop`→`stop`, `length`→`length`, `content-filter`/`content_filter`→`content_filter`, `error`/`cancelled` pass through, unknown/undefined→`stop`.
- [ ] **Step 2 — run, expect fail** (`normalize.ts` not found). Run: `pnpm --filter @ollive/llm-sdk exec vitest run test/normalize.test.ts`
- [ ] **Step 3 — implement** by cutting the two functions + `AnyUsage` out of `google.ts` into `normalize.ts`; in `google.ts` replace them with `import { normalizeUsage, normalizeFinishReason } from './normalize.js'`.
- [ ] **Step 4 — run normalize + existing google tests, expect pass.** Run: `pnpm --filter @ollive/llm-sdk exec vitest run test/normalize.test.ts test/google.test.ts`
- [ ] **Step 5 — commit.** `git commit -m "refactor(llm-sdk): extract shared usage/finish-reason normalizers"`

---

### Task 2: Anthropic adapter (llm-sdk)

**Files:** Create `packages/llm-sdk/src/providers/anthropic.ts`; Modify `packages/llm-sdk/src/index.ts`, `packages/llm-sdk/package.json`; Test `packages/llm-sdk/test/anthropic.test.ts`

**Dependency:** add `"@ai-sdk/anthropic": "^2.0.0"` to `packages/llm-sdk/package.json` dependencies, then `pnpm install`. Verify the installed package exports `createAnthropic`; if the major differs, match whatever pairs with `ai@5` (same major line as `@ai-sdk/google@2`).

**Signatures (mirror `google.ts` exactly):**
```ts
export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic' as const;
  async *streamChat(req: ChatRequest, opts?: { signal?: AbortSignal; context?: CallContext }): AsyncIterable<StreamChunk>;
}
export function anthropicProviderFactory(): AnthropicProvider;
```

**Algorithm (identical shape to `GoogleProvider.streamChat`):** module-level `const anthropic = createAnthropic()` (reads `ANTHROPIC_API_KEY` from env); `streamText({ model: anthropic(req.model), messages: req.messages, abortSignal: opts?.signal, temperature: req.temperature, maxOutputTokens: req.maxOutputTokens })`; `for await (const delta of result.textStream) yield { delta }`; then `const [usage, finishReason] = await Promise.all([result.usage, result.finishReason]); yield { usage: normalizeUsage(usage), finishReason: normalizeFinishReason(finishReason) }`. Import normalizers from `./normalize.js`.

**Pattern to mirror for the test:** `packages/llm-sdk/test/google.test.ts` — it module-mocks `@ai-sdk/google`'s `createGoogleGenerativeAI` + `streamText`. Do the same for `@ai-sdk/anthropic` (mock `createAnthropic` + the `ai` `streamText`).

- [ ] **Step 1 — add dep + `pnpm install`.** Confirm `node_modules/@ai-sdk/anthropic` exists and exports `createAnthropic`.
- [ ] **Step 2 — failing tests.** Cover: deltas from a fake `textStream` are yielded in order as `{delta}`; final chunk carries normalized `usage` + `finishReason`; `abortSignal` is forwarded to `streamText`. Mirror google.test's mock structure.
- [ ] **Step 3 — run, expect fail** (`anthropic.ts` not found). Run: `pnpm --filter @ollive/llm-sdk exec vitest run test/anthropic.test.ts`
- [ ] **Step 4 — implement** `anthropic.ts` per algorithm; add to `index.ts`: `export { AnthropicProvider, anthropicProviderFactory } from './providers/anthropic.js'`.
- [ ] **Step 5 — run, expect pass.** Run: `pnpm --filter @ollive/llm-sdk exec vitest run test/anthropic.test.ts`
- [ ] **Step 6 — commit.** `git commit -m "feat(llm-sdk): add Anthropic provider adapter"`

---

### Task 3: Model router (llm-sdk)

**Files:** Create `packages/llm-sdk/src/providers/router.ts`; Modify `packages/llm-sdk/src/index.ts`; Test `packages/llm-sdk/test/router.test.ts`

**Signature:**
```ts
export function createRoutingProvider(resolve: (model: string) => LLMProvider | undefined): LLMProvider;
```

**Algorithm:** return `{ name: 'router', async *streamChat(req, opts) { const p = resolve(req.model); if (!p) throw new Error(`No provider for model '${req.model}'`); yield* p.streamChat(req, opts); } }`.

- [ ] **Step 1 — failing tests.** Cover: routes to the provider returned by `resolve` (use two fake providers, assert the right one's `streamChat` ran and its chunks pass through); `resolve` returning `undefined` → `streamChat` throws `No provider for model`; `resolve` is called with `req.model`.
- [ ] **Step 2 — run, expect fail.** Run: `pnpm --filter @ollive/llm-sdk exec vitest run test/router.test.ts`
- [ ] **Step 3 — implement** `router.ts`; add to `index.ts`: `export { createRoutingProvider } from './providers/router.js'`.
- [ ] **Step 4 — run, expect pass.** Run: `pnpm --filter @ollive/llm-sdk exec vitest run test/router.test.ts`
- [ ] **Step 5 — typecheck the package.** Run: `pnpm --filter @ollive/llm-sdk exec tsc --noEmit`
- [ ] **Step 6 — commit.** `git commit -m "feat(llm-sdk): add model-dispatching routing provider"`

---

### Task 4: Anthropic model catalog (shared)

**Files:** Modify `packages/shared/src/api/models.ts`

**Add (mirror `GOOGLE_MODELS` shape):**
```ts
export const ANTHROPIC_MODELS: ModelInfo[] = [
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', provider: 'anthropic', description: 'Balanced — strong general reasoning' },
];
```

- [ ] **Step 1 — add the constant** below `GOOGLE_MODELS`. Confirm it's re-exported via the package's `api` barrel the same way `GOOGLE_MODELS` is (check `packages/shared/src/api/index.ts` exports `./models.js`).
- [ ] **Step 2 — typecheck.** Run: `pnpm --filter @ollive/shared exec tsc --noEmit`
- [ ] **Step 3 — commit.** `git commit -m "feat(shared): add Anthropic model catalog (Claude Sonnet 4.6)"`

---

### Task 5: API config — optional ANTHROPIC_API_KEY

**Files:** Modify `apps/api/src/config.ts`

**Changes:**
- Zod schema: add `ANTHROPIC_API_KEY: z.string().min(1).optional()` (near `GEMINI_API_KEY`, line ~25).
- `AppConfig` type: add `anthropicApiKey?: string` (near `geminiApiKey`, line ~49).
- Returned config object: add `anthropicApiKey: data.ANTHROPIC_API_KEY` (near line ~98).

- [ ] **Step 1 — apply the three edits.**
- [ ] **Step 2 — typecheck.** Run: `pnpm --filter @ollive/api exec tsc --noEmit`
- [ ] **Step 3 — commit.** `git commit -m "feat(api): add optional ANTHROPIC_API_KEY config"`

---

### Task 6: Catalog gating + provider lookup (api)

**Files:** Modify `apps/api/src/models/catalog.ts`; Test `apps/api/test/catalog.test.ts`

**Changes & signatures:**
- In `availableModels(config)`: after the Google block, add `if (config.anthropicApiKey) models.push(...ANTHROPIC_MODELS);` (import `ANTHROPIC_MODELS` from `@ollive/shared/api`).
- Add `export function providerForModel(model: string, config: AppConfig): string | undefined` → returns `availableModels(config).find(m => m.id === model)?.provider`.

- [ ] **Step 1 — failing tests.** Cover: with `anthropicApiKey` unset → `availableModels` has only Google ids, `providerForModel('claude-sonnet-4-6', cfg)` is `undefined`; with it set → catalog includes `claude-sonnet-4-6` and `providerForModel` returns `'anthropic'`; `providerForModel('gemini-2.5-flash', cfg)` returns `'google'`. Build configs via the existing test pattern (see `apps/api/test/chat.int.test.ts` `loadConfig({...})`), no DB needed.
- [ ] **Step 2 — run, expect fail.** Run: `pnpm --filter @ollive/api exec vitest run test/catalog.test.ts`
- [ ] **Step 3 — implement** the two changes.
- [ ] **Step 4 — run, expect pass.** Run: `pnpm --filter @ollive/api exec vitest run test/catalog.test.ts`
- [ ] **Step 5 — commit.** `git commit -m "feat(api): expose Anthropic models when key set; add providerForModel"`

---

### Task 7: Derive stored provider from model (api)

**Files:** Modify `apps/api/src/routes/conversations.ts` (the two `provider: 'google'` literals at ~line 39 and ~line 82); Test: add a case to `apps/api/test/conversations.int.test.ts`

**Change:** replace each `provider: 'google'` with `provider: providerForModel(model, config) ?? 'google'`, where `model` is the validated model in scope for that handler (the create handler already resolves the requested/default model against `availableModelIds`). Import `providerForModel` from `../models/catalog.js`. The `?? 'google'` is a defensive fallback; validation already guarantees the model is in the catalog.

- [ ] **Step 1 — failing test.** In the conversations integration test, create a conversation with `model: 'claude-sonnet-4-6'` under a config that has `anthropicApiKey` set, and assert the persisted/returned `provider === 'anthropic'`; keep an existing-style assertion that a Gemini model yields `provider === 'google'`. Mirror the setup in the current create tests in that file.
- [ ] **Step 2 — run, expect fail.** Run: `pnpm --filter @ollive/api exec vitest run test/conversations.int.test.ts`
- [ ] **Step 3 — implement** the two-literal change.
- [ ] **Step 4 — run, expect pass.** Run: `pnpm --filter @ollive/api exec vitest run test/conversations.int.test.ts`
- [ ] **Step 5 — commit.** `git commit -m "feat(api): store conversation provider derived from chosen model"`

---

### Task 8: Testable provider wiring (api)

**Files:** Create `apps/api/src/chat/provider.ts`; Test `apps/api/test/chat-provider.test.ts`

**Signature:**
```ts
import type { LLMProvider, LogSink } from '@ollive/llm-sdk';
export function buildChatProvider(config: AppConfig, sink: LogSink): LLMProvider;
```

**Algorithm:**
1. `const cfg: InferenceLoggerConfig = { ingestionUrl: `http://localhost:${config.port}/v1/logs`, apiKey: config.ingestionApiKey, redaction: config.piiRedaction }` — used only for `withLogging`'s preview/redaction fields (transport is injected as `sink`).
2. `const wrap = (p: LLMProvider) => withLogging(p, cfg, sink)`.
3. `const byName: Record<string, LLMProvider> = { google: wrap(googleProviderFactory()) }`; `if (config.anthropicApiKey) byName.anthropic = wrap(anthropicProviderFactory())`.
4. Build `const modelToProvider = new Map(availableModels(config).map(m => [m.id, m.provider]))`.
5. `return createRoutingProvider(model => { const name = modelToProvider.get(model); return name ? byName[name] : undefined; })`.

Imports: `withLogging`, `createRoutingProvider`, `googleProviderFactory`, `anthropicProviderFactory` from `@ollive/llm-sdk`; `availableModels` from `../models/catalog.js`.

- [ ] **Step 1 — failing tests.** Use a stub `sink` (`{ enqueue() {} }`). Cover: with `anthropicApiKey` set, streaming a request with `model:'claude-sonnet-4-6'` reaches Anthropic and `model:'gemini-2.5-flash'` reaches Google — assert by spying on which `*ProviderFactory` path runs (module-mock `@ai-sdk/*` `streamText` to emit a marker delta, OR mock the factories). With `anthropicApiKey` unset, a Claude model → router throws `No provider for model`.
- [ ] **Step 2 — run, expect fail.** Run: `pnpm --filter @ollive/api exec vitest run test/chat-provider.test.ts`
- [ ] **Step 3 — implement** `provider.ts` per algorithm.
- [ ] **Step 4 — run, expect pass.** Run: `pnpm --filter @ollive/api exec vitest run test/chat-provider.test.ts`
- [ ] **Step 5 — commit.** `git commit -m "feat(api): buildChatProvider — instrumented per-model provider routing"`

---

### Task 9: Wire server.ts + .env.example + full verification

**Files:** Modify `apps/api/src/server.ts`, `.env.example`

**`server.ts` change (replaces the `withLoggingTransport(googleProviderFactory(), {...})` block, ~lines 33-42):**
1. `const cfg = { ingestionUrl: `http://localhost:${config.port}/v1/logs`, apiKey: config.ingestionApiKey, redaction: config.piiRedaction }`.
2. `const transport = new BufferedHttpTransport(cfg)` (import `BufferedHttpTransport`).
3. `const chatProvider = buildChatProvider(config, transport)` (import from `./chat/provider.js`).
4. Keep the existing `transportRef`/shutdown flush logic pointing at `transport` (unchanged).

Remove the now-unused `withLoggingTransport` / `googleProviderFactory` imports from `server.ts` (they live in `provider.ts` now). Keep `BufferedHttpTransport`.

**`.env.example`:** add under the provider keys:
```
# Optional — enables Claude models in the switcher when set.
# Get a key: https://console.anthropic.com/settings/keys
ANTHROPIC_API_KEY=
```

- [ ] **Step 1 — apply both edits.**
- [ ] **Step 2 — typecheck whole repo.** Run: `pnpm typecheck` — expect clean.
- [ ] **Step 3 — lint.** Run: `pnpm lint` — expect clean (no unused imports left in `server.ts`).
- [ ] **Step 4 — full test suite.** Run: `pnpm test` — expect all green (existing + new).
- [ ] **Step 5 — commit.** `git commit -m "feat(api): wire Anthropic provider into server + .env.example"`

---

## Self-review notes
- **Spec coverage:** adapter (T2), router (T3), shared catalog (T4), config gating (T5/T6), provider derivation on create (T7), instrumented routing wiring (T8/T9), `.env.example` (T9), shared transport (T8/T9). Testing items map to T1-T8. All spec sections covered.
- **Refinement vs spec:** spec said "server.ts wiring"; plan extracts the logic into `apps/api/src/chat/provider.ts` (`buildChatProvider`) so the highest-risk part is unit-tested without booting the server. server.ts becomes a thin caller. Within spec intent.
- **Type consistency:** `createRoutingProvider(resolve)` signature identical in T3/T8; `providerForModel` returns `string | undefined` in T6, consumed with `?? 'google'` in T7 and `name ? byName[name] : undefined` in T8; normalizers' names identical T1/T2.
