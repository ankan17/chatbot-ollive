# Ollive UI Redesign — ollive.ai Brand Design Spec

**Date:** 2026-05-23
**Status:** Awaiting review
**Scope:** Entire web app (`apps/web`), plus a modest, additive backend change for a wired model switcher.
**Reference mockups:** `.superpowers/brainstorm/56628-1779555486/content/chat-ollive-brand.html` (chat homepage in the ollive.ai brand system) and `…/dashboard.html` (dashboard). **Brand source:** https://www.ollive.ai/ (design tokens extracted from the live site).

---

## 1. Goal

The current UI has a coherent token system but unfinished *composition*: the guest homepage is an empty void, the empty-state is a tiny lost label, the composer's controls read as disabled, there is no constrained reading column, no real onboarding moment, and no polish/motion. The dashboards and sign-in are similarly bare.

Redesign every screen to match the **ollive.ai brand system** — a dark-first, editorial aesthetic: green-black canvas, warm-cream text, a vivid **lime-green** accent, **Young Serif** display + **Space Grotesk** body, full-pill controls, glassy surfaces, subtle atmosphere + grain, and considered motion — while keeping the app fully functional. Ship a **light theme** (the brand's inverted cream/dark-green palette) alongside dark with a persisted user switcher, and a **wired, provider-agnostic model selector** that only ever surfaces models the backend can actually serve.

**Success criteria**
- Every in-scope screen matches the ollive.ai brand language in both dark and light themes.
- Theme choice persists across reloads; defaults to dark.
- The model switcher lists only available models (Gemini today), and the selected model is genuinely used for generation.
- All existing Vitest suites stay green (logic unchanged); new behavior is covered by tests.
- No regression to auth, streaming, guest flow, or metrics.

**Non-goals**
- New OpenAI/Anthropic provider adapters (the switcher is *built to* support them, but none are added here).
- Backend/business-logic changes beyond what the model switcher requires.
- New product features beyond the redesign + switcher.

---

## 2. Design language (tokens)

Implemented in `src/styles/global.css` as CSS custom properties. The current `:root` token set is **replaced**; component CSS Modules already consume `var(--…)`, so most update automatically.

### Themes
Two themes, selected by a `data-theme="dark|light"` attribute on `<html>` (or `documentElement.classList`). Dark is the default and the designed-first surface.

**Accent (shared by both themes) — Lime Green (ollive.ai)**
- `--color-accent: #98f46f`, `--accent-deep: #7fe052` (hover, and accent-as-text on light), `--accent-rgb: 152 244 111`
- Used as a **fill** (with near-black `--color-text-on-accent` text) for: send button, active-nav/streaming dot, focus rings, key chart series, brand-mark glow, primary CTAs. Lime is an accent/fill — never body-text color.

**Dark surfaces (primary, brand-accurate)**
- `--color-bg-base: #0a0c0a` (green-black, matching ollive.ai); subtle lime-tinted radial glows + a fixed fine-grain SVG noise overlay at low opacity.
- `--color-bg-surface: rgb(245 245 240 / 0.05)` (cream glass), `--color-bg-elevated: rgb(245 245 240 / 0.07)`
- `--color-border: rgb(245 245 240 / 0.10)`, `--border-strong: rgb(245 245 240 / 0.18)`
- Ink (warm cream): `--color-text-primary: #f5f5f0`, `--color-text-secondary: rgb(245 245 240 / 0.78)`, `--color-text-muted: rgb(245 245 240 / 0.62)`, `--color-text-subtle: rgb(245 245 240 / 0.32)`; `--color-text-on-accent: #0a0c0a`

**Light surfaces (inverted — ollive.ai's light sections)**
- `--color-bg-base: #f5f5f0` (warm cream) with lime-tinted radial glows at lower alpha + multiply-blend grain.
- `--color-bg-surface: rgb(30 47 28 / 0.05)`, `--color-bg-elevated: #ffffff`
- `--color-border: rgb(30 47 28 / 0.12)`, `--border-strong: rgb(30 47 28 / 0.20)`
- Ink (dark green): `--color-text-primary: #14201a`, `--color-text-secondary: rgb(30 47 28 / 0.78)`, `--color-text-muted: rgb(30 47 28 / 0.62)`, `--color-text-subtle: rgb(30 47 28 / 0.40)`; `--color-text-on-accent: #14201a` (dark text on the lime fill)

### Typography (ollive.ai brand fonts)
- Display: **Young Serif** (sidebar wordmark, hero headline, big numerals, section headings) — chunky editorial serif, single weight 400, tight tracking (~-0.03em).
- Body/UI: **Space Grotesk** (300–700). Intentional brand match (ollive.ai's body face) despite being a common pick — brand fidelity wins.
- Mono: **JetBrains Mono** (code blocks, kbd hints) — ollive.ai ships no mono; added for code/metrics where a true monospace is needed.
- Loaded via a Google Fonts `<link>` in `index.html`: `Young+Serif` + `Space+Grotesk:wght@300;400;500;600;700` + `JetBrains+Mono`.

### Other tokens
- Radii: `--radius-sm 8px`, `-md 12px`, `-lg 16px`, `-xl 22px`, `-full 999px`. **Buttons/controls use `--radius-full` (pills)**, matching ollive.ai.
- Shadows: a soft elevation set tuned per theme (`--shadow-lg` deep on dark, soft on light) + accent-glow shadows for the composer/send.
- Motion: a single orchestrated entrance per screen — staggered `rise` (fade + translateY) on hero/composer/chips; sidebar slides in; respect `prefers-reduced-motion` (disable transforms, keep opacity).

---

## 3. Theme system (dark/light switcher)

- **State:** a small `ThemeProvider` (React context) holding `'dark' | 'light'`, applied to `document.documentElement` via `data-theme`. Initialized from `localStorage('ollive-theme')`, else `prefers-color-scheme`, else dark. Writes back on change. A blocking inline snippet in `index.html` sets the attribute before first paint to avoid a flash.
- **Placement:** a segmented Dark/Light control (sun/moon icons) in the **sidebar footer**, next to the user chip. (The preview pill in the mockup is mockup-only; this is its real home.)
- **Coverage:** every screen and state must be verified in both themes, including charts, error states, and the sign-in screen.

---

## 4. Screen-by-screen design

### 4.1 App shell — `AppShell.tsx` + `Sidebar.tsx`
Move from the current top-only header to a **persistent left sidebar + main column** grid (`272px 1fr`), matching the approved mockup. The sidebar is glassy with a right border.

**Sidebar (top→bottom):** brand row (circular Ollive mark + "Ollive" in Young Serif) · accent-tinted **New chat** button · nav (Chat active, Metrics) with line icons · grouped conversation history ("Today/Yesterday" mono labels; active item has a glowing accent dot; hover lifts) · spacer · **theme switcher** · **user chip** (gradient avatar with initials, name, plan) opening a menu (Sign out, etc.).

The top **header** is replaced by a slim in-main `topbar` (see 4.5 model switcher + share/settings icon buttons). On `< 900px`, the sidebar collapses behind a hamburger toggle (overlay drawer); main goes full-width.

### 4.2 Chat homepage / empty state — `ChatView.tsx`
Replace the tiny centered label with the approved **hero**: glowing circular Ollive mark, a large **Young Serif headline** ("How can I help?"), a muted Space Grotesk sub-line, a row of **suggested-prompt chips** (pill, glass, line icons; clicking one fills the composer and focuses it), then the elevated composer with its lime send button, then a muted footnote with keyboard hints. Vertically centered; staggered entrance.

### 4.3 Conversation view — `MessageList.tsx` + `MessageBubble.tsx`
- **Reading column:** messages constrained to `max-width: 760px`, centered, generous vertical rhythm (the mockup composer width). Fixes edge-to-edge sprawl on wide screens.
- **User bubble:** accent-tinted glass (`rgb(var(--accent-rgb)/0.14)` fill, accent-ish border), right-aligned, rounded with a tucked bottom-right corner. Readable in both themes (no solid-accent fill behind body text).
- **Assistant message:** no heavy bubble — an editorial block on `--color-bg-surface` with a small accent Ollive-mark/avatar glyph in the gutter, full markdown support. `pre/code` use `--color-bg-elevated` + JetBrains Mono with a copy button on hover; inline `code` tinted.
- **Streaming:** a pulsing accent caret/dot while `status==='partial'`; smooth token append; auto-scroll pinned to bottom unless the user scrolls up (then show a "scroll to latest" affordance).
- **Error message:** `--color-error` treatment with a retry affordance; keeps the existing error semantics.
- **Status/meta:** relative time + token/status tags as muted mono, revealed on hover to reduce noise.
- Preserve `MessageBubble` props/markdown behavior so `messageBubble.test.tsx` stays valid.

### 4.4 Composer — `Composer.tsx`
The hero control. Elevated glass card (`--radius-xl`), auto-sizing textarea (`min ~52px`, `max 200px`), a left **attach** ghost button (visual; wire only if upload exists — otherwise omit), and a circular **accent send** button with an up-arrow and accent glow that intensifies on `:focus-within`. **Stop** state during streaming swaps the send button to a stop glyph (reuse existing stop logic + `--color-error`). Disabled/sending states tuned for clear affordance (the old low-contrast problem is gone). Enter sends, Shift+Enter newlines (existing behavior).

### 4.5 Model switcher — `topbar` (new small component, e.g. `ModelSwitcher.tsx`)
- **UI:** a pill in the main `topbar` showing the active model (`◆ Gemini 2.5 Flash ▾`) with a status dot. Opens a menu listing **available** models grouped by provider, each with label + one-line descriptor (e.g. "fast" / "most capable") and a check on the active one.
- **Data:** fetched from a new `GET /v1/models` endpoint (see §5); never hardcoded. If the list has one entry, the pill is non-interactive (just shows the model).
- **Behavior:**
  - On the **homepage** (no conversation yet): the switcher sets the model for the *next* conversation; persisted in `localStorage('ollive-model')` (validated against available models on load; falls back to the server default).
  - In an **existing conversation:** the switcher reflects `conversation.model`; changing it `PATCH`es the conversation's model so subsequent messages use it (history is unaffected).
- Default: server's default model (Gemini 2.5 Flash).

### 4.6 Sign-in — `SignInScreen.tsx`
Replace the marooned plain card. Center a glassy elevated card on the atmospheric dark canvas: large circular Ollive mark with glow, Young Serif "Ollive", tagline, and a **Google** button with the multi-color Google glyph + proper affordance/hover. Add a subtle one-line value prop and a faint footer. Entrance animation. Must look intentional in both themes.

### 4.7 Guest mode — `GuestBanner.tsx` + `GuestSignInPrompt.tsx`
- **Guest banner:** restyle as a slim glass top strip with an accent "Sign in" link; clear but unobtrusive. When the trial is exhausted, it adopts a warning treatment.
- **Guest empty-state:** the homepage hero adapts copy ("Try Ollive free — sign in to save your chats"); the sign-in prompt becomes a polished inline card, not a bare line.

### 4.8 Dashboards — `Dashboards.tsx`, `SummaryCards.tsx`, `MetricFilters.tsx`, `*Chart.tsx`
- **Layout:** a titled page within the shell; a responsive grid of **summary cards** (glass, large Young Serif numerals, mono labels, small trend hints) above a 2-col chart grid (`LatencyChart`, `ThroughputChart`, `TokenUsageChart`, `ErrorRateChart`).
- **Filters:** `MetricFilters` restyled as glass pills/selects (range, provider, model, bucket) consistent with the switcher.
- **Charts (recharts):** theme the existing charts via CSS variables — axis/grid in `--color-text-subtle`/`--color-border`, series in the lime accent + a small harmonized palette (lime `#98f46f`, a soft teal/green secondary, and a warm tone `#f4b14f` / error-red for the error series), tooltips as glass cards, area gradients using the accent. Must be legible on both dark and light backgrounds. Keep `chartData.ts` logic and `chartData.test.ts` untouched.

### 4.9 Shared states — `components/states/*`
Restyle `Spinner` (accent ring), `ErrorState` (glass card, accent retry button), and any empty/loading placeholders to the new language. Keep `ErrorBoundary` behavior; restyle its fallback.

---

## 5. Backend changes (additive — for the wired switcher)

Principle: **adapters declare their catalog; the API exposes only configured providers' catalogs; the registry resolves the provider per conversation.** Today only Google is configured, so only Gemini models appear — no new adapters added.

1. **Model catalog in the SDK.** Add a typed catalog (id, label, provider, short description, optional tier/default flag) and have `GoogleProvider` declare its servable models (`gemini-2.5-flash` = default/"fast", `gemini-2.5-pro` = "most capable"). The Google adapter already passes `req.model` straight through, so both work with no adapter logic change. *(Confirm exact Gemini model IDs available on the configured key before finalizing the catalog list.)*
2. **`GET /v1/models`.** New route returning the merged catalog for providers that are both registered **and** have credentials configured (Google has a key ⇒ included). Shape added to `@ollive/shared/api` and re-exported through `apps/web/src/api/types.ts`. Includes which model is the default.
3. **`POST /v1/conversations` accepts `model` (and `provider`).** Extend `createConversationSchema` to optionally accept a `model`; validate it against the catalog (reject unknown ⇒ `validation_error`); default to `config.defaultModel`. Replaces today's hardcoded `model: config.defaultModel`. Same for the guest/import paths where relevant.
4. **`PATCH /v1/conversations/:id` accepts `model`.** Extend `patchConversationSchema` to allow changing the model (validated against the catalog), enabling mid-conversation switching.
5. **Provider resolution by name.** In the chat wiring, resolve the provider from `conversation.provider` via the existing `ProviderRegistry` instead of a single injected `chatProvider`. With only Google registered, behavior is identical today, but the switcher becomes truly provider-agnostic. (If lower-risk, keep the single-provider injection for now and gate this on >1 provider — decide during planning.)

**Out of scope / future:** OpenAI/Anthropic adapters + keys. When added (adapter + registry entry + key), they surface in `/v1/models` automatically and the switcher lists them with no UI change.

---

## 6. File impact map

**Tokens/global:** `styles/global.css` (replace token set, themes, background atmosphere, grain), `index.html` (pre-paint theme attribute; fonts already present).
**New:** `state/themeContext.tsx` (or similar), `components/ThemeToggle.tsx`, `components/ModelSwitcher.tsx`, `api/models.ts` (+ hook `hooks/useModels.ts`).
**Restyle (CSS Modules, minimal TSX):** `AppShell`, `Sidebar`, `ConversationListItem`, `ChatView`, `MessageList`, `MessageBubble`, `Composer`, `SignInScreen`, `GuestBanner`, `GuestSignInPrompt`, `Dashboards`, `SummaryCards`, `MetricFilters`, the four `*Chart.tsx`, `states/*`, `ErrorBoundary` fallback.
**Wiring (TSX/logic):** `ChatView`/`useChat`/`useConversation`/`conversations.ts` to thread the selected model into create/patch; suggested-prompt chips → composer.
**Backend:** `packages/llm-sdk` (catalog + Google catalog), `packages/shared` (DTOs), `apps/api/src/routes/models.ts` (new), `routes/conversations.ts`, `conversations/validation.ts`, chat wiring/registry, `app.ts`/`server.ts` (mount route).

---

## 7. Accessibility & responsiveness
- Contrast: verify body text and muted text meet WCAG AA in **both** themes (the dark muted/subtle inks are chosen for this; re-check on light).
- Focus: visible accent focus rings on all interactive elements (keep the global `:focus-visible`).
- Keyboard: composer (Enter/Shift+Enter), menus (model switcher, user menu) operable and dismissible; sidebar drawer toggle reachable.
- `prefers-reduced-motion`: disable transform animations, keep opacity fades.
- Responsive: sidebar → drawer under ~900px; chat reading column and composer stay centered and padded on small screens; dashboards grid reflows to single column.

## 8. Testing
- Keep all existing suites green — they assert logic/markup, not visuals: `messageBubble`, `composer`, `chatReducer`, `useSession`, `stream`, `routing`, `guestMachine`, `chartData`, `relativeTime`, `smoke`.
- Add: `ThemeProvider` (persist/restore/default) test; `ModelSwitcher` (renders available models, selects, persists, sends model on create/patch) test; `useModels` fetch/fallback test.
- Backend: `GET /v1/models` (only-configured-providers) + create/patch model validation tests in the API package's style.
- Manual visual QA via the dev server in both themes across all screens.

## 9. Out of scope / future
- Additional provider adapters (OpenAI/Anthropic) and their keys.
- Streaming UX features beyond the redesign (e.g., message editing, regenerate) unless already present.
- Avatar uploads / attachments unless a backend already exists (attach button is visual-only otherwise).

## 10. Open questions
- Exact Gemini model IDs available on the configured key (finalize the catalog list during planning).
- Whether to do provider-by-registry resolution now or gate it until a 2nd provider exists (risk/scope call at planning time).
