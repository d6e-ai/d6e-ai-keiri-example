# d6e-ai-keiri-example

An example AI accounting application that demonstrates how to build a thin
frontend on top of the [d6e](https://github.com/d6e-ai/d6e) platform's
`/api/workflows/execute-by-intent` endpoint.

## What this app does

The user uploads a receipt image, the AI generates a freee-compatible
journal entry, and the user revises it with free-form Japanese until it
looks right. There is no real accounting backend — this repository exists
to show how to wire up d6e for a single-purpose vertical app.

````mermaid
sequenceDiagram
    participant User as Browser
    participant App as d6e-ai-keiri-example (this app)
    participant Files as d6e API (files)
    participant Intent as d6e SvelteKit (/api/workflows/execute-by-intent)
    participant LLM as LLM via MCP

    User->>App: Upload receipt image
    App->>Files: POST /api/v1/workspaces/{wsId}/files
    Files-->>App: { id: fileId }
    App->>Intent: POST execute-by-intent (message, inputFileRefs)
    Intent->>LLM: generateText with MCP tools
    LLM-->>Intent: ```json {"kind":"journal","entries":[...]} ```
    Intent-->>App: IntentResponse
    App-->>User: Render journal table (or markdown fallback)
````

## Repository contents

```
.
├── src/                   # SvelteKit app (UI + /api/upload + /api/intent)
├── scripts/
│   ├── init-workspace.mjs # Register the AI accounting prompt rule
│   └── prompts/
│       └── ai-keiri-prompt.md  # SINGLE SOURCE OF TRUTH for LLM behaviour
├── docs/
│   ├── architecture.md
│   ├── d6e-api-integration.md
│   ├── workspace-setup.md
│   ├── llm-output-contract.md
│   └── migration-to-full-integration.md
└── .env.example
```

## Tech stack

- [SvelteKit](https://svelte.dev/docs/kit) + [Svelte 5](https://svelte.dev/docs/svelte) (Runes) + TypeScript strict
- [Tailwind CSS v4](https://tailwindcss.com/) (utility-first design tokens, no shadcn CLI dependency at runtime)
- [Paraglide](https://inlang.com/m/gerre34r/library-inlang-paraglideJs) for i18n (`ja-JP`, `en-US`)
- [@lucide/svelte](https://lucide.dev/) for icons
- [Zod 4](https://zod.dev/) for JSON contract validation
- [@sveltejs/adapter-vercel](https://svelte.dev/docs/kit/adapter-vercel)

## Getting started

### Prerequisites

- Node.js >= 20 (Node 22+ recommended; the lockfile is built against 20.18.2)
- A running d6e backend you can reach over HTTP. For local development this
  means `d6e` (the Rust API + the SvelteKit frontend) running on its default
  ports.
- A workspace UUID in that d6e instance where you have admin access.

### 1. Install

```bash
npm install
```

### 2. Configure environment variables

Copy `.env.example` to `.env` and fill in the seven values:

| Variable                 | Used by                       | How to obtain                                                           |
| ------------------------ | ----------------------------- | ----------------------------------------------------------------------- |
| `D6E_API_URL`            | `/api/upload`                 | Base URL of the d6e Rust API (managed: same host as `D6E_FRONTEND_URL`) |
| `D6E_FRONTEND_URL`       | `/api/intent`, `npm run init` | Base URL of the d6e SvelteKit frontend (e.g. `https://b-button.d6e.ai`) |
| `D6E_WORKSPACE_ID`       | all calls                     | UUID of the d6e workspace this app should operate on                    |
| `D6E_AUTH_URL`           | server-side token refresh     | Base URL of d6e-auth (`https://www.d6e.ai` for managed instances)       |
| `D6E_AUTH_CLIENT_ID`     | server-side token refresh     | OAuth client ID issued by d6e-auth for your d6e instance                |
| `D6E_AUTH_CLIENT_SECRET` | server-side token refresh     | OAuth client secret paired with the client ID                           |
| `D6E_REFRESH_TOKEN`      | server-side token refresh     | Long-lived `auth-refresh` cookie value from a logged-in browser session |

> The `auth-refresh` cookie is `HttpOnly`, so you'll need to copy it
> from the browser dev tools (`Application` -> `Cookies`) after logging
> in to the d6e frontend. The cookie is valid for 30 days; this app
> exchanges it for a fresh 1-hour access token via the d6e-auth OAuth
> refresh flow so you never need to paste short-lived JWTs into `.env`.

### 3. Bootstrap the workspace (one-time)

```bash
npm run init
```

This POSTs the contents of [`scripts/prompts/ai-keiri-prompt.md`](./scripts/prompts/ai-keiri-prompt.md)
to `/api/workspace-prompt-rules` so the LLM running inside
`execute-by-intent` knows to produce the strict JSON journal format. Run
once per workspace. See [docs/workspace-setup.md](./docs/workspace-setup.md)
for troubleshooting.

### 4. Run the dev server

```bash
npm run dev
```

Open <http://localhost:5173> (or whichever port Vite assigns) and try the
AI Journal page.

## Documentation

- [`docs/architecture.md`](./docs/architecture.md) — request flow and directory layout
- [`docs/d6e-api-integration.md`](./docs/d6e-api-integration.md) — exact request/response payloads
- [`docs/workspace-setup.md`](./docs/workspace-setup.md) — `npm run init` deep dive
- [`docs/llm-output-contract.md`](./docs/llm-output-contract.md) — JSON schema, scenarios, parse fallback
- [`docs/migration-to-full-integration.md`](./docs/migration-to-full-integration.md) — roadmap toward the full d6e-auth/STF integration (C-case)

## Status & caveats

- `/api/workflows/execute-by-intent` is internal to d6e and has no
  stability guarantee. If the upstream contract changes, this app will
  need to follow.
- This example uses a single shared workspace, a single OAuth client,
  and a single user's refresh token. Per-user authentication is
  intentionally out of scope; see `docs/migration-to-full-integration.md`
  for the multi-user roadmap.
- The access token cache lives in Node process memory. Serverless cold
  starts will perform one refresh round-trip (~200 ms) per cold
  invocation. For higher-traffic deployments, persist the rotated
  refresh token returned by `/api/v1/auth/token` instead of keeping
  `D6E_REFRESH_TOKEN` static.
- The journal table is read-only. Revisions happen by sending a
  natural-language correction back to the LLM (see
  `docs/llm-output-contract.md`).

## License

Proprietary - d6e AI, Inc.
