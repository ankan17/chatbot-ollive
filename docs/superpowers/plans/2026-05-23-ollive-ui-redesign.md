# Ollive UI Redesign (Dark Premium) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the entire `apps/web` SPA to a dark-premium aesthetic (deep indigo-slate, electric-indigo accent, glass surfaces, atmosphere + motion) with a persisted dark/light theme switcher and a genuinely-wired, provider-agnostic model switcher.

**Architecture:** All design tokens live in `global.css` as `:root` (dark default) + `[data-theme="light"]` overrides, reusing the existing `--color-*`/`--space-*`/`--radius-*` names so most components re-theme by value alone; structural work is concentrated in shell/sidebar, chat surface, sign-in, and dashboards. Theme state is a small React context applied via `data-theme` on `<html>`, pre-painted in `index.html`. The model switcher is fed by a new `GET /v1/models` endpoint that exposes only the catalogs of configured providers (Gemini today); conversation create/patch accept a validated `model`.

**Tech Stack:** React 18 + Vite + TypeScript, CSS Modules, react-router-dom, react-markdown, recharts; backend Express + Drizzle + Vercel AI SDK (`@ai-sdk/google`); Vitest + Testing Library.

**Branch:** `feat/ui-dark-premium` (already created off clean `main`; spec committed). Warm-paper WIP preserved on `wip/warm-paper-ui`.

**Spec:** `docs/superpowers/specs/2026-05-23-ollive-ui-redesign-design.md`

**Conventions for every task:** follow the lean format — each task lists files, the interface/signatures, the test cases to assert (not full test bodies), the approach, and a pattern file to mirror. CSS-only restyle tasks have no unit tests; for them, "verify" = `pnpm --filter @ollive/web typecheck` + `pnpm test` stays green + manual visual QA in **both themes** at the dev server. Commit after each task.

**Global verification commands:**
- Web unit tests: `pnpm --filter @ollive/web test`
- Web typecheck: `pnpm --filter @ollive/web typecheck`
- API tests: `pnpm --filter @ollive/api test` (or `pnpm test` for the whole workspace)
- Dev server (already runnable): `pnpm --filter @ollive/web dev`

---

## Phase 1 — Design foundation (tokens + theme system)

### Task 1: Dark-premium token system in `global.css`

**Files:**
- Modify: `apps/web/src/styles/global.css`
- Delete: `apps/web/src/styles/tokens.module.css` (dead — imported nowhere; its `--color-*` names are reused below)

- [ ] **Step 1 — Inventory token usage.** `grep -rho "var(--[a-z0-9-]*)" apps/web/src/components | sort -u` to confirm every referenced token name is defined by this task. Expected names include the `--color-*`, `--space-*`, `--text-*`, `--radius-*`, `--shadow-*` families from the old `tokens.module.css`.
- [ ] **Step 2 — Write tokens.** In `global.css`, define `:root` (dark, default) and `[data-theme="light"]` blocks. Reuse existing names so components re-theme automatically; add new tokens for atmosphere/glow. Concrete starting values (tune for WCAG AA during QA):

  Shared (both themes):
  - `--font-display:'Fraunces',Georgia,serif; --font-body:'Hanken Grotesk',system-ui,sans-serif; --font-mono:'JetBrains Mono',ui-monospace,monospace;`
  - `--accent-2:#c4b5fd; --accent-2-rgb:196 181 253;`
  - radii: `--radius-sm:8px; --radius-md:12px; --radius-lg:18px; --radius-xl:26px; --radius-full:999px;`
  - keep the `--space-*` and `--text-*` scales as-is.

  Dark (`:root`):
  - `--color-bg-base:#0a0c14; --color-bg-surface:#11141f; --color-bg-elevated:#181c2b;`
  - `--color-border:rgb(255 255 255/0.09); --border-strong:rgb(255 255 255/0.16);`
  - `--color-text-primary:#edf0f6; --color-text-secondary:#b6bccb; --color-text-muted:#8b91a6; --color-text-on-accent:#0a0c14;`
  - `--color-accent:#818cf8; --color-accent-hover:#6f7bf0; --color-accent-light:rgb(129 140 248/0.14); --accent-rgb:129 140 248;`
  - `--color-error:#f4717a; --color-error-light:rgb(244 113 122/0.14); --color-success:#4ade80; --color-warning:#fbbf24;`
  - `--shadow-sm:0 1px 2px rgb(0 0 0/0.4); --shadow-md:0 10px 30px -12px rgb(0 0 0/0.6),0 2px 6px -2px rgb(0 0 0/0.4); --shadow-lg:0 30px 70px -25px rgb(0 0 0/0.7);`
  - `--grain-opacity:0.5; --grain-blend:overlay;`

  Light (`[data-theme="light"]`):
  - `--color-bg-base:#f3f4f8; --color-bg-surface:#ffffff; --color-bg-elevated:#ffffff;`
  - `--color-border:rgb(18 22 40/0.09); --border-strong:rgb(18 22 40/0.16);`
  - `--color-text-primary:#14172a; --color-text-secondary:#424a63; --color-text-muted:#6b7186; --color-text-on-accent:#ffffff;`
  - `--color-accent:#5b63e8; --color-accent-hover:#4f46e5; --color-accent-light:rgb(91 99 232/0.10); --accent-rgb:91 99 232;`
  - `--color-error:#dc2626; --color-error-light:#fef2f2; --color-success:#16a34a; --color-warning:#d97706;`
  - `--shadow-lg:0 30px 60px -28px rgb(30 40 80/0.35);` (+ softer sm/md) `--grain-opacity:0.4; --grain-blend:multiply;`
- [ ] **Step 3 — Global atmosphere & base.** Set `color-scheme` per theme; `body { font-family:var(--font-body); background:var(--color-bg-base); color:var(--color-text-primary); }`; add fixed `body::before` layered radial glows using `rgb(var(--accent-rgb)/…)` + `rgb(var(--accent-2-rgb)/…)`, and `body::after` SVG `feTurbulence` grain at `var(--grain-opacity)`/`var(--grain-blend)` (mirror the technique in the mockup `.superpowers/brainstorm/56628-1779555486/content/dark-premium.html`). Add `h1–h4{font-family:var(--font-display)}`, themed `::selection`, `:focus-visible` accent ring, themed thin scrollbars, and a `@media (prefers-reduced-motion: reduce)` block disabling transforms/animation.
- [ ] **Step 4 — Verify.** `pnpm --filter @ollive/web typecheck` passes; `pnpm --filter @ollive/web test` stays green; dev server renders with dark tokens (app still functionally intact, if unstyled in spots). Toggle `<html data-theme="light">` in devtools to sanity-check light values resolve.
- [ ] **Step 5 — Commit.** `style(web): dark-premium design tokens + light theme in global.css; remove dead tokens.module.css`

**Pattern:** the mockup file for atmosphere/grain/glow values; the old `tokens.module.css` for the canonical token-name list.

### Task 2: Pre-paint theme + fonts in `index.html`

**Files:** Modify `apps/web/index.html`

- [ ] **Step 1 — Fonts.** Add the Google Fonts `<link>` for `Fraunces` (500;600;700, opsz), `Hanken Grotesk` (400;500;600;700), `JetBrains Mono` (400;500) with `preconnect` (copy from the mockup `<head>`).
- [ ] **Step 2 — Pre-paint script.** Add a tiny blocking inline `<script>` in `<head>` that reads `localStorage.getItem('ollive-theme')`, falls back to `matchMedia('(prefers-color-scheme: dark)')`, else `'dark'`, and sets `document.documentElement.dataset.theme` before first paint (avoids flash). Set `<html data-theme="dark">` as the static default attribute too.
- [ ] **Step 3 — Verify.** Reload dev server: no theme flash; `localStorage.ollive-theme='light'` then reload → starts light.
- [ ] **Step 4 — Commit.** `feat(web): preload brand fonts and pre-paint theme attribute`

### Task 3: `ThemeProvider` context

**Files:** Create `apps/web/src/state/themeContext.tsx`; Test `apps/web/src/test/themeContext.test.tsx`; Modify `apps/web/src/main.tsx` (wrap `<App/>`).

**Interface:**
```ts
type Theme = 'dark' | 'light';
function ThemeProvider(props: { children: React.ReactNode }): JSX.Element;
function useTheme(): { theme: Theme; setTheme(t: Theme): void; toggleTheme(): void };
```

- [ ] **Step 1 — Failing tests.** Assert: (a) default is `'dark'` when no `localStorage` and `matchMedia` mocked to no-preference; (b) initializes from `localStorage('ollive-theme')` when present; (c) `setTheme('light')` updates `document.documentElement.dataset.theme==='light'` and writes `localStorage`; (d) `toggleTheme()` flips dark↔light; (e) `useTheme` outside provider throws. Mirror provider/test patterns in `state/sessionContext.tsx` + `test/useSession.test.tsx`.
- [ ] **Step 2 — Run, expect fail.** `pnpm --filter @ollive/web test themeContext`
- [ ] **Step 3 — Implement.** Context reads initial theme from `document.documentElement.dataset.theme` (set by pre-paint), syncs `data-theme` + `localStorage` in `setTheme`. Wrap `App` in `main.tsx`.
- [ ] **Step 4 — Run, expect pass;** full web suite green.
- [ ] **Step 5 — Commit.** `feat(web): ThemeProvider with persisted dark/light state`

### Task 4: `ThemeToggle` component

**Files:** Create `apps/web/src/components/ThemeToggle.tsx` + `.module.css`; Test `apps/web/src/test/themeToggle.test.tsx`.

**Interface:** `function ThemeToggle(): JSX.Element;` (segmented sun/moon control, uses `useTheme`).

- [ ] **Step 1 — Failing test.** Renders two options; clicking "Light" calls into context → `data-theme==='light'`; active option has `aria-pressed="true"`. Wrap render in `ThemeProvider`.
- [ ] **Step 2 — Run, expect fail.**
- [ ] **Step 3 — Implement.** Segmented control mirroring the mockup `.seg`; sun/moon inline SVGs; accessible labels.
- [ ] **Step 4 — Run, expect pass.**
- [ ] **Step 5 — Commit.** `feat(web): ThemeToggle segmented control`

---

## Phase 2 — App shell + sidebar

### Task 5: App shell layout (sidebar grid + topbar scaffold)

**Files:** Modify `apps/web/src/components/AppShell.tsx` + `AppShell.module.css`.

- [ ] **Step 1 — Restyle/restructure.** Replace top-header layout with `display:grid; grid-template-columns:272px 1fr; height:100vh`. Left = `<Sidebar/>` (Task 6); right = `.main` column containing a slim `.topbar` (left: model switcher slot — placeholder until Task 18; right: Share + Settings icon buttons) and `{children}`. Keep the `user`/`onSignOut` props and pass to Sidebar. Glass topbar with bottom border; entrance `fadeDown`.
- [ ] **Step 2 — Verify.** `smoke.test.tsx` + `routing.test.tsx` green (AppShell still renders children & nav targets exist); typecheck passes; visual check both themes.
- [ ] **Step 3 — Commit.** `feat(web): grid app shell with sidebar + slim topbar`

**Pattern:** mockup `.app`/`.topbar`; current `AppShell.tsx` for prop wiring (`user`, `onSignOut`, nav links to `/` and `/dashboards`).

### Task 6: Sidebar redesign

**Files:** Modify `apps/web/src/components/Sidebar.tsx` + `Sidebar.module.css`. Place `<ThemeToggle/>` in the footer.

- [ ] **Step 1 — Restyle.** Sections top→bottom (mirror mockup `.sidebar`): brand row (olive-sprig SVG mark + "Ollive" in Fraunces); accent-tinted **New chat** button (existing new-conversation action); nav (Chat → `/`, Metrics → `/dashboards`) with line-icon + active state; conversation history (existing `useConversations` data) grouped by recency with `ConversationListItem`; spacer; `<ThemeToggle/>`; user chip (gradient-initials avatar, name, plan) opening the existing sign-out menu.
- [ ] **Step 2 — Preserve behavior.** Keep all existing handlers/data hooks; only markup/classes + the ThemeToggle addition change. If Sidebar currently lacks history grouping, add a pure helper `groupConversationsByRecency(items)` (Today/Yesterday/Earlier) — unit-test it if added.
- [ ] **Step 3 — Verify.** Existing tests green; nav + new-chat + sign-out still work in manual QA, both themes.
- [ ] **Step 4 — Commit.** `feat(web): redesign sidebar (brand, nav, history, theme toggle, user chip)`

### Task 7: `ConversationListItem` redesign

**Files:** Modify `ConversationListItem.tsx` + `.module.css`.

- [ ] **Step 1 — Restyle.** Glass hover, ellipsis truncation, active item gets the glowing accent dot (mockup `.convo.cur::before`). Preserve click/select + active-route logic and props.
- [ ] **Step 2 — Verify.** Tests green; active highlighting matches current route in QA.
- [ ] **Step 3 — Commit.** `style(web): redesign conversation list item`

### Task 8: Responsive sidebar drawer

**Files:** Modify `AppShell.tsx` + `AppShell.module.css` (and `Sidebar.module.css`).

- [ ] **Step 1 — Implement.** Under `~900px`, collapse sidebar to an off-canvas drawer toggled by a hamburger button in the topbar; main goes full width; overlay scrim closes it; `Esc` closes. Use a local `open` state in AppShell.
- [ ] **Step 2 — Verify.** Resize to mobile width in dev server: drawer opens/closes, focus returns to toggle on close; tests green.
- [ ] **Step 3 — Commit.** `feat(web): responsive sidebar drawer under 900px`

---

## Phase 3 — Chat surface

### Task 9: Chat homepage hero + suggested prompts

**Files:** Modify `ChatView.tsx` + `ChatView.module.css`. Optional new `components/SuggestedPrompts.tsx` + `.module.css`.

**Interface (if extracted):** `function SuggestedPrompts(props: { onPick(text: string): void }): JSX.Element;`

- [ ] **Step 1 — Test.** When the conversation is empty, the hero renders the wordmark, tagline, and N prompt chips; clicking a chip calls `onPick` with that prompt text (and ChatView routes it into the composer input + focuses). Add `suggestedPrompts.test.tsx` for the chip→callback contract.
- [ ] **Step 2 — Run, expect fail.**
- [ ] **Step 3 — Implement.** Replace the tiny empty-state with the mockup hero (`.heromark` sprig + glow, Fraunces gradient wordmark, tagline, `.chips` row with line-icons, staggered `rise` animation). Wire chip click to set composer draft + focus. Guest variant copy ("Try Ollive free — sign in to save your chats").
- [ ] **Step 4 — Run, expect pass;** suite green.
- [ ] **Step 5 — Commit.** `feat(web): chat homepage hero with suggested prompts`

**Pattern:** mockup `.hero`; current `ChatView.tsx` for empty-vs-conversation branching and composer wiring.

### Task 10: Composer redesign

**Files:** Modify `Composer.tsx` + `Composer.module.css`.

- [ ] **Step 1 — Restyle (preserve logic).** Elevated glass card (`--radius-xl`), autosizing textarea (min ~52px, max 200px), circular **accent send** button with up-arrow + glow that intensifies on `:focus-within`; **stop** state swaps to a stop glyph using existing stop/abort logic; disabled/sending states with clear affordance. Keep Enter=send / Shift+Enter=newline and all existing props/handlers. Attach button only if an upload path already exists — otherwise omit (do not add dead UI).
- [ ] **Step 2 — Verify.** `composer.test.tsx` stays green (send/stop/disabled behavior unchanged); manual QA both themes; focus glow visible.
- [ ] **Step 3 — Commit.** `feat(web): redesign composer (glass, accent send, focus glow)`

### Task 11: Message list reading column + scroll behavior

**Files:** Modify `MessageList.tsx` + `MessageList.module.css`.

- [ ] **Step 1 — Restyle/behavior.** Constrain messages to a centered `max-width:760px` column with generous vertical rhythm. Auto-scroll pinned to bottom on new tokens unless the user has scrolled up; in that case show a "scroll to latest" affordance (small accent pill). Keep the list's data/streaming props intact.
- [ ] **Step 2 — Verify.** Existing tests green; in QA, streaming auto-scrolls, scrolling up reveals the affordance, clicking returns to bottom.
- [ ] **Step 3 — Commit.** `feat(web): centered reading column + smart autoscroll`

### Task 12: Message bubble redesign

**Files:** Modify `MessageBubble.tsx` + `MessageBubble.module.css`.

- [ ] **Step 1 — Restyle (preserve markdown/props).** User = accent-tinted glass (`--color-accent-light` fill + accent-ish border, right-aligned, tucked corner). Assistant = editorial block on `--color-bg-surface` with a small sprig glyph gutter, full markdown; `pre`/`code` on `--color-bg-elevated` + JetBrains Mono; inline code tinted; add a hover **copy** button on code blocks. Streaming `status==='partial'` shows a pulsing accent caret. Error status uses `--color-error`/`--color-error-light` with a retry affordance. Status/meta (relative time, token tags) muted-mono, revealed on hover.
- [ ] **Step 2 — Verify.** `messageBubble.test.tsx` stays green (markdown rendering + role/status branching unchanged); QA both themes incl. code block + copy.
- [ ] **Step 3 — Commit.** `feat(web): redesign message bubbles (glass user, editorial assistant, code copy)`

**Pattern:** current `MessageBubble.tsx` for markdown components + status/role props.

---

## Phase 4 — Model switcher (backend + frontend)

### Task 13: Model catalog in the LLM SDK

**Files:** Modify `packages/llm-sdk/src/types.ts` (catalog types), `packages/llm-sdk/src/providers/google.ts` (declare catalog), `packages/llm-sdk/src/index.ts` (export); Test `packages/llm-sdk/test/...` (mirror existing llm-sdk test layout).

**Interface:**
```ts
interface ModelInfo { id: string; label: string; provider: string; description?: string; tier?: 'fast'|'capable'; isDefault?: boolean; }
// On LLMProvider (optional, additive): models?(): ModelInfo[];
```

- [ ] **Step 1 — Confirm available Gemini IDs** the configured key serves (spec open question). Default catalog: `gemini-2.5-flash` (label "Gemini 2.5 Flash", tier "fast", isDefault) + `gemini-2.5-pro` (label "Gemini 2.5 Pro", tier "capable").
- [ ] **Step 2 — Failing test.** `GoogleProvider.models()` returns the two entries with `provider:'google'` and exactly one `isDefault`.
- [ ] **Step 3 — Implement** the type + `GoogleProvider.models()` (static list; `streamChat` already passes `req.model` through, no other change).
- [ ] **Step 4 — Run, expect pass.** `pnpm --filter @ollive/llm-sdk test`
- [ ] **Step 5 — Commit.** `feat(llm-sdk): model catalog + Google provider models()`

### Task 14: Shared DTO + `GET /v1/models` route

**Files:** Modify `packages/shared/src/api.ts` (add `ModelInfo`, `ModelsResponse`); Create `apps/api/src/routes/models.ts`; Modify `apps/api/src/app.ts`/`server.ts` (mount); Test `apps/api/test/models.int.test.ts`.

**Interface:** `GET /v1/models → { models: ModelInfo[]; defaultModel: string }` (auth-required, mirroring other `/v1` routes). Built by merging `models()` from registered providers that have credentials configured (Google has `geminiApiKey`).

- [ ] **Step 1 — Failing test.** With only Google configured, `GET /v1/models` (authed) returns the two Gemini entries and `defaultModel===config.defaultModel`; unauth → 401. Mirror `conversations.int.test.ts` setup (test app + auth helper).
- [ ] **Step 2 — Run, expect fail.**
- [ ] **Step 3 — Implement** route + DTOs + mount. Source the provider list from the registry/configured providers (see Task 16 wiring; for now Google).
- [ ] **Step 4 — Run, expect pass.** `pnpm --filter @ollive/api test models`
- [ ] **Step 5 — Commit.** `feat(api): GET /v1/models lists available provider models`

### Task 15: Conversation create/patch accept validated `model`

**Files:** Modify `apps/api/src/conversations/validation.ts` (`createConversationSchema`, `patchConversationSchema`), `apps/api/src/routes/conversations.ts` (use body `model` ?? `config.defaultModel`), repository if needed; Test extend `apps/api/test/conversations.int.test.ts`.

- [ ] **Step 1 — Failing tests.** (a) `POST /v1/conversations {model:'gemini-2.5-pro'}` persists that model; (b) omitted model → `config.defaultModel`; (c) unknown model → `validation_error` (validate against the catalog from Task 13/14); (d) `PATCH /v1/conversations/:id {model:'gemini-2.5-flash'}` updates `conversation.model`; (e) PATCH unknown model → `validation_error`.
- [ ] **Step 2 — Run, expect fail.**
- [ ] **Step 3 — Implement.** Extend zod schemas (optional `model`); validate against catalog ids; replace hardcoded `model: config.defaultModel` in create; add model to patch path. Keep `provider:'google'` for now.
- [ ] **Step 4 — Run, expect pass.**
- [ ] **Step 5 — Commit.** `feat(api): conversations accept validated model on create/patch`

### Task 16: Registry-based provider resolution (gated)

**Files:** Modify chat wiring (`apps/api/src/routes/chat.ts` deps / `app.ts`) to resolve provider from `conversation.provider` via `ProviderRegistry`; Test `apps/api/test/chat.int.test.ts` (no behavior change with Google-only).

- [ ] **Step 1 — Decision.** Only do this if low-risk; otherwise keep the single injected `chatProvider` and note the future change. With one provider the observable behavior is identical.
- [ ] **Step 2 — If implementing:** inject the `ProviderRegistry` into chat deps; resolve `registry.create(conv.provider)` per request; falls back/throws clearly if unregistered. Keep existing chat tests green.
- [ ] **Step 3 — Verify + Commit.** `refactor(api): resolve chat provider via registry by conversation.provider`

### Task 17: Web models API client + `useModels` hook

**Files:** Create `apps/web/src/api/models.ts` + `apps/web/src/hooks/useModels.ts`; re-export DTOs in `apps/web/src/api/types.ts`; Test `apps/web/src/test/useModels.test.ts`.

**Interface:** `fetchModels(): Promise<ModelsResponse>`; `useModels(): { models: ModelInfo[]; defaultModel?: string; loading: boolean; error?: ApiError }`.

- [ ] **Step 1 — Failing test.** `useModels` fetches and exposes models; on fetch error returns empty list + error (switcher then shows default-only). Mirror `api/conversations.ts` + an existing hook test for fetch mocking.
- [ ] **Step 2 — Run, expect fail.**
- [ ] **Step 3 — Implement** using the shared `http`/`buildUrl` helpers.
- [ ] **Step 4 — Run, expect pass.**
- [ ] **Step 5 — Commit.** `feat(web): models API client + useModels hook`

### Task 18: `ModelSwitcher` component

**Files:** Create `apps/web/src/components/ModelSwitcher.tsx` + `.module.css`; mount in `AppShell` topbar (replace Task 5 placeholder); Test `apps/web/src/test/modelSwitcher.test.tsx`.

**Interface:**
```ts
function ModelSwitcher(props: { value: string; onChange(modelId: string): void; }): JSX.Element;
```

- [ ] **Step 1 — Failing tests.** Renders the active model label; opens a menu listing available models grouped by provider with a check on `value`; selecting calls `onChange(id)`; with a single available model the control is non-interactive (just a label). Keyboard: `Esc` closes, arrow nav optional.
- [ ] **Step 2 — Run, expect fail.**
- [ ] **Step 3 — Implement** the topbar pill + menu (mockup `.modelpill` styling + a popover). Consumes `useModels` for the list.
- [ ] **Step 4 — Run, expect pass.**
- [ ] **Step 5 — Commit.** `feat(web): model switcher component`

### Task 19: Wire selected model through conversation create/patch + persistence

**Files:** Modify `apps/web/src/api/conversations.ts` (create/patch accept `model`), `hooks/useConversation.ts`/`useChat.ts`, `ChatView.tsx`; Test extend relevant hook/`chatReducer` tests as applicable.

- [ ] **Step 1 — Failing tests.** Creating a conversation sends the selected `model`; persisted choice read from `localStorage('ollive-model')` (validated against `useModels`, fallback to `defaultModel`); switching in an existing conversation issues a PATCH with the new model. Update `api/conversations.ts` create/patch signatures to include `model?`.
- [ ] **Step 2 — Run, expect fail.**
- [ ] **Step 3 — Implement.** Homepage `ModelSwitcher` sets the next-conversation model (persisted); in a conversation it reflects `conversation.model` and PATCHes on change. Thread `model` into the create call.
- [ ] **Step 4 — Run, expect pass;** suite green.
- [ ] **Step 5 — Commit.** `feat(web): wire model selection into conversation create/patch`

---

## Phase 5 — Sign-in + guest

### Task 20: Sign-in screen redesign

**Files:** Modify `SignInScreen.tsx` + `SignInScreen.module.css`; Test `smoke.test.tsx` stays green.

- [ ] **Step 1 — Restyle.** Centered glass card on the atmospheric canvas: glowing sprig mark, Fraunces "Ollive", tagline, one-line value prop, **Google** button with the multicolor Google "G" SVG glyph + hover/affordance, faint footer, entrance animation. Keep the existing `onSignIn` handler/prop.
- [ ] **Step 2 — Verify.** Tests green; QA both themes; button triggers `onSignIn`.
- [ ] **Step 3 — Commit.** `feat(web): redesign sign-in screen`

### Task 21: Guest banner redesign

**Files:** Modify `GuestBanner.tsx` + `GuestBanner.module.css`.

- [ ] **Step 1 — Restyle.** Slim glass top strip; accent "Sign in" link; trial-exhausted state adopts a `--color-warning`/error treatment. Preserve existing trial-state props/logic.
- [ ] **Step 2 — Verify + Commit.** `style(web): redesign guest banner` (tests green).

### Task 22: Guest sign-in prompt redesign

**Files:** Modify `GuestSignInPrompt.tsx` + `GuestSignInPrompt.module.css`.

- [ ] **Step 1 — Restyle** the bare prompt into a polished inline glass card with a clear CTA; preserve handler/props.
- [ ] **Step 2 — Verify + Commit.** `style(web): redesign guest sign-in prompt` (tests green).

---

## Phase 6 — Dashboards

### Task 23: Dashboards layout + page header

**Files:** Modify `Dashboards.tsx` + `Dashboards.module.css`.

- [ ] **Step 1 — Restyle.** Titled page within the shell; responsive grid — summary cards row above a 2-col chart grid (single col under ~900px). Preserve all data hooks (`useMetrics`) and filter wiring.
- [ ] **Step 2 — Verify + Commit.** `feat(web): redesign dashboards layout` (tests green; QA both themes).

### Task 24: Summary cards redesign

**Files:** Modify `SummaryCards.tsx` + `SummaryCards.module.css`.

- [ ] **Step 1 — Restyle.** Glass cards, large Fraunces numerals, mono labels, subtle trend hint. Preserve props/data.
- [ ] **Step 2 — Verify + Commit.** `style(web): redesign metric summary cards`.

### Task 25: Metric filters redesign

**Files:** Modify `MetricFilters.tsx` + `MetricFilters.module.css`.

- [ ] **Step 1 — Restyle** range/provider/model/bucket controls as glass pills/selects consistent with the model switcher. Preserve filter state/handlers and the `MetricFilters` shape from `api/types.ts`.
- [ ] **Step 2 — Verify + Commit.** `style(web): redesign metric filters`.

### Task 26: Chart theming (recharts, both themes)

**Files:** Create `apps/web/src/lib/chartTheme.ts` (theme-aware colors read from CSS vars / `useTheme`); Modify `LatencyChart.tsx`, `ThroughputChart.tsx`, `TokenUsageChart.tsx`, `ErrorRateChart.tsx`. Do **not** touch `lib/chartData.ts` (keep `chartData.test.ts` green).

**Interface:** `function getChartTheme(theme: 'dark'|'light'): { axis:string; grid:string; series:string[]; tooltipBg:string; tooltipBorder:string; areaGradientId:string };`

- [ ] **Step 1 — Implement** the theme helper (indigo accent + a small harmonized palette: `#818cf8`, `#c4b5fd`, plus theme-tuned secondaries) and apply to each chart's axes/grid/series/tooltip/area-gradient. Read current theme via `useTheme`.
- [ ] **Step 2 — Verify.** `chartData.test.ts` + suite green; charts legible and on-brand in **both** themes in QA.
- [ ] **Step 3 — Commit.** `feat(web): theme recharts for dark/light`

---

## Phase 7 — Shared states + final QA

### Task 27: Spinner / ErrorState / ErrorBoundary fallback

**Files:** Modify `components/states/Spinner*`, `components/states/ErrorState.tsx` + `.module.css`, `ErrorBoundary.tsx` fallback markup.

- [ ] **Step 1 — Restyle.** Spinner = accent ring; ErrorState = glass card + accent retry button; ErrorBoundary fallback matches. Preserve behavior/props.
- [ ] **Step 2 — Verify + Commit.** `style(web): redesign shared loading/error states` (tests green).

### Task 28: Full QA pass + cross-cutting polish

- [ ] **Step 1 — Run everything.** `pnpm test` (whole workspace) and `pnpm --filter @ollive/web typecheck` + `pnpm --filter @ollive/api typecheck` — all green.
- [ ] **Step 2 — Visual QA** every screen in **both themes** at the dev server: homepage (auth + guest), conversation w/ streaming + code + error, sidebar/drawer at mobile width, model switcher, sign-in, dashboards. Check WCAG AA contrast on muted/subtle text; verify `prefers-reduced-motion`.
- [ ] **Step 3 — Fix** any contrast/spacing/responsive issues found (small commits).
- [ ] **Step 4 — Final commit.** `chore(web): dark-premium redesign QA polish`

---

## Self-review notes
- **Spec coverage:** tokens/themes (T1–T2), theme switcher (T3–T4), shell+sidebar (T5–T8), homepage/hero+chips (T9), composer (T10), conversation/bubbles/streaming/code (T11–T12), model switcher FE+BE incl. available-only + create/patch + registry (T13–T19), sign-in (T20), guest (T21–T22), dashboards incl. chart theming (T23–T26), shared states (T27), accessibility/responsive/QA (T8, T28). All spec sections map to tasks.
- **Open items carried from spec:** exact Gemini model IDs (T13 step 1); registry resolution gated (T16).
- **Type consistency:** `ModelInfo`/`ModelsResponse` defined in T13–T14 and consumed unchanged in T17–T19; `useTheme()` shape from T3 consumed in T4/T26; `model?` added to create/patch in T15 (API) and T19 (web client) consistently.
