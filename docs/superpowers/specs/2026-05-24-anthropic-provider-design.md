# Anthropic Provider with Per-Conversation Routing — Design Spec

**Date:** 2026-05-24
**Status:** Awaiting review
**Branch:** off `main`
**Scope:** `packages/llm-sdk` (new adapter + router), `packages/shared` (model catalog), `apps/api` (config, model catalog gating, provider wiring, create route), `.env.example`. No `apps/web` changes.

---

## 1. Goal

Add Anthropic (Claude) as a second chat provider alongside the existing Google/Gemini provider, and make a conversation's `provider` actually select which provider serves it. A user picks a Claude model in the existing model switcher and the chat — and its auto-generated title — route to Anthropic.

**Success criteria**
- With `ANTHROPIC_API_KEY` set, `claude-sonnet-4-6` appears in `GET /v1/models` and in the switcher.
- A conversation created with a Claude model is stored as `provider:'anthropic'` and streams replies from Anthropic.
- Title generation for a Claude conversation uses Anthropic (same `conv.model`).
- With no `ANTHROPIC_API_KEY`, behavior is identical to today (Google-only); nothing breaks.
- New behavior is covered by tests; existing tests (which inject a single fake provider) are unaffected.

**Non-goals**
- No UI changes (the switcher lists catalog models automatically).
- No streaming/SSE contract changes.
- No change to the default model (`gemini-2.5-flash` stays the default for new conversations).
- Not adding Opus/Haiku now — catalog is a one-line-per-model array, trivial to extend later.

## 2. Routing approach

The injected `chatProvider` (an `LLMProvider`) becomes a thin **model router**: on each `streamChat(req)` it resolves `req.model → the matching instrumented provider` and delegates. This preserves the existing single-`LLMProvider` injection seam — `app.ts`, the chat route, and the guest route are unchanged. Because `req.model` is already threaded to every call site (including the title-gen call in `naming.ts`), Claude conversations and their titles route correctly with no extra plumbing.

**Wrapping order:** each underlying provider is individually wrapped with `withLogging` so inference logs record the correct `provider.name` (`'google'` / `'anthropic'`). The router sits *outside* the logging wrappers and delegates to already-wrapped providers; the router itself is never logged.

## 3. Components & files

### `packages/llm-sdk`
- **Add dependency** `@ai-sdk/anthropic` (`^2.x`, pairs with `ai@^5`). Exact version confirmed on install.
- **`providers/normalize.ts` (new)** — extract `normalizeUsage` and `normalizeFinishReason` (currently private to `google.ts`) into a shared internal module. Justified: the Anthropic adapter needs the identical logic. `google.ts` imports from here.
- **`providers/anthropic.ts` (new)** — `AnthropicProvider` (`name = 'anthropic'`) + `anthropicProviderFactory()`, mirroring `google.ts`: `createAnthropic()` (reads `ANTHROPIC_API_KEY` from env), `streamText`, yield deltas, then a final usage+finishReason chunk.
- **`providers/router.ts` (new)** — `createRoutingProvider(resolve: (model: string) => LLMProvider | undefined): LLMProvider`. Its `streamChat` calls `resolve(req.model)`; if undefined, throws `Error("No provider for model '<model>'")` (mapped to `provider_error` by the existing `mapProviderError`). Generic — no catalog dependency.
- **`index.ts`** — export `AnthropicProvider`, `anthropicProviderFactory`, `createRoutingProvider`.

### `packages/shared/src/api/models.ts`
- Add `ANTHROPIC_MODELS: ModelInfo[] = [{ id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', provider: 'anthropic', description: 'Balanced — strong general reasoning' }]`.

### `apps/api`
- **`config.ts`** — add `ANTHROPIC_API_KEY: z.string().min(1).optional()` and `anthropicApiKey?: string` on `AppConfig`. Optional → non-breaking.
- **`models/catalog.ts`** — `availableModels()` pushes `ANTHROPIC_MODELS` when `config.anthropicApiKey` is set (mirrors the Google gating). Add a small `providerForModel(model, config)` helper (looks up the model in the available catalog, returns its `provider`).
- **`server.ts`** — construct **one** `BufferedHttpTransport`; build `byName = { google: withLogging(googleProviderFactory(), cfg, transport) }`, adding `anthropic: withLogging(anthropicProviderFactory(), cfg, transport)` only when `anthropicApiKey` is set; build a `model → provider` resolver from the available catalog; pass `createRoutingProvider(resolve)` as `chatProvider`.
- **`routes/conversations.ts`** — replace the two hardcoded `provider: 'google'` literals (create paths) with `providerForModel(model, config)` so the stored `provider` matches the chosen model. (Import path / guest path left as-is.)

### `.env.example`
- Add `ANTHROPIC_API_KEY=` placeholder with a short comment.

## 4. Data flow

New conversation with a Claude model → create route stores `provider:'anthropic'`, `model:'claude-sonnet-4-6'` → chat route builds `chatRequest{ model }` → router resolves `model → anthropic` → instrumented Anthropic provider streams + logs under `name:'anthropic'`. Title generation reuses `conv.model`, so it routes to Anthropic too.

## 5. Edge cases & error handling
- **No Anthropic key:** Anthropic models absent from the catalog; create validation (`availableModelIds`) rejects them; router only knows Google. Identical to today.
- **Model with no provider** (shouldn't occur, since create validates against the catalog): router throws → `mapProviderError` → `provider_error` SSE event. Defensive only.
- **Anthropic call fails (quota/rate limit):** flows through the existing `mapProviderError` (429 → `rate_limited`, etc.) exactly like Google. Title-gen failure stays swallowed (FR17) as designed.
- **Shared transport:** one buffer/flush timer for both providers (avoids duplicate timers from calling `withLoggingTransport` twice).

## 6. Testing
- `packages/llm-sdk/test/anthropic.test.ts` — mirror `google.test.ts` (mock `@ai-sdk/anthropic`): deltas stream through, final usage/finishReason normalized.
- `packages/llm-sdk/test/router.test.ts` — dispatch by model to the right provider; unknown model throws.
- API catalog test — Anthropic models present iff `anthropicApiKey` set; `availableModelIds` includes them.
- API create-route test — creating with `claude-sonnet-4-6` stores `provider:'anthropic'`; with a Gemini model stores `provider:'google'`.
- Existing tests inject a single fake `chatProvider` → unaffected.
