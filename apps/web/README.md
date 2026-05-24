# @ollive/web

Vite + React + TypeScript SPA for the Ollive AI chatbot frontend.

## Commands

```bash
# Development server (hot-reloading)
pnpm --filter @ollive/web dev

# Production build (outputs to apps/web/dist/)
pnpm --filter @ollive/web build

# Preview the production build locally
pnpm --filter @ollive/web preview

# Run unit tests (watch mode)
pnpm exec vitest --project web

# Run unit tests (single pass)
pnpm exec vitest run --project web

# Type-check without emitting
pnpm --filter @ollive/web exec tsc --noEmit
```

## Environment Variables

| Variable | Required | Example | Description |
|---|---|---|---|
| `VITE_API_BASE_URL` | yes | `http://localhost:3000` | Base URL for the backend API (no trailing slash) |

Copy `.env.example` to `.env` and fill in the value before running `dev` or `build`.

## Routes

| Path | Auth required | Description |
|---|---|---|
| `/` | No | Chat — guest trial or authed new conversation |
| `/c/:id` | Yes | Existing conversation |
| `/dashboards` | Yes | Metrics dashboards |
| `/sign-in` | No | Google OAuth entry point |

## Architecture

- **State**: React context (`SessionProvider`) for auth; `useReducer` for guest/authed chat.
- **Streaming**: Server-Sent Events via `streamChat` + `createSseParser`.
- **Charts**: Recharts time-series via pure data-shaping helpers in `src/lib/chartData.ts`.
- **CSS**: CSS Modules; design tokens in `src/styles/tokens.module.css`.

## Deferred: Cross-service Manual Walkthrough (Plan 7)

The following end-to-end flow is owned by Plan 7 and requires a running backend (Postgres + Redis + API server):

1. Guest sends 2 messages → receives streamed replies from the assistant.
2. Guest attempts a 3rd message → cap triggers, `GuestSignInPrompt` appears.
3. User clicks "Sign in" → redirected to `/auth/google` → OAuth flow completes.
4. On return, `import-on-login` runs: guest conversation is imported as a real conversation and the user is navigated to `/c/:id`.
5. Sidebar title auto-updates after the first assistant response (`refreshOne` triggered by `SseDoneData`).
6. User navigates to `/dashboards` → filter presets (1h / 6h / 24h / 7d), summary cards (Requests, Error Rate, Total Tokens), and four Recharts time-series charts (Latency, Throughput, Error Rate, Token Usage) render with live data.
