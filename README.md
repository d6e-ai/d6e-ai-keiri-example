# d6e-ai-keiri-example

An example AI accounting application that demonstrates how to build a thin
frontend on top of the [d6e](https://github.com/d6e-ai/d6e) platform's
`/api/workflows/execute-by-intent` endpoint.

## What this app does

The user signs in with their own d6e-auth account, uploads one or more
receipt images, presses "Generate journal", and the AI produces a
freee-compatible journal entry. The user revises it with free-form
Japanese until it looks right. There is no real accounting backend —
this repository exists to show how to wire up d6e for a single-purpose
vertical app, including the OAuth2 login flow.

````mermaid
sequenceDiagram
    participant User as Browser
    participant App as d6e-ai-keiri-example (this app)
    participant Auth as d6e-auth (www.d6e.ai)
    participant Files as d6e API (files)
    participant Intent as d6e SvelteKit (/api/workflows/execute-by-intent)
    participant LLM as LLM via MCP

    User->>App: GET / (no cookie)
    App-->>User: 302 /auth/login
    User->>Auth: log in with email+password or Google
    Auth-->>App: redirect ?code=...&state=...
    App->>Auth: POST /api/v1/auth/token (authorization_code)
    Auth-->>App: access_token (iss=d6e-auth) + refresh_token
    Note over App,Files: stage 2 — re-mint at the d6e instance so the access_token has the audience the d6e instance API expects
    App->>Files: POST /api/v1/auth/token (refresh_token)
    Files-->>App: access_token (d6e-instance audience) + refresh_token
    Note over App,Files: tokens written to HTTP-only cookies
    App->>Files: GET /api/v1/workspaces/{wsId} (membership check)
    Files-->>App: 200 OK (or 403 -> /auth/no-access)

    User->>App: Pick N receipts
    App->>Files: POST /api/v1/workspaces/{wsId}/files/multipart (xN)
    Files-->>App: { id: fileId } (xN)
    User->>App: Press "Generate journal"
    App->>Intent: POST execute-by-intent (message, inputFileRefs[])
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

Copy `.env.example` to `.env` and fill in the values:

| Variable                 | Used by                                            | How to obtain                                                                                         |
| ------------------------ | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `D6E_BASE_URL`           | `/api/upload`, `/api/intent`, `/api/chat-sessions` | Base URL of the d6e instance (e.g. `https://your-d6e-instance.example.com`)                           |
| `D6E_WORKSPACE_ID`       | all calls                                          | UUID of the d6e workspace this app should operate on                                                  |
| `D6E_AUTH_URL`           | `/auth/login`, `/auth/callback`, refresh           | Base URL of the d6e-auth instance (e.g. `https://www.d6e.ai`)                                         |
| `D6E_AUTH_CLIENT_ID`     | server-side OAuth                                  | `client_id` of the `registered_client` row that maps this app to d6e-auth                             |
| `D6E_AUTH_CLIENT_SECRET` | server-side OAuth                                  | `client_secret` paired with `D6E_AUTH_CLIENT_ID`                                                      |
| `D6E_AUTH_REDIRECT_URI`  | `/auth/login`, `/auth/callback`                    | Callback URL exposed by this app (e.g. `http://localhost:5173/auth/callback`). Must be pre-registered |
| `D6E_INIT_REFRESH_TOKEN` | `npm run init` only                                | Long-lived `auth-refresh` cookie value from a workspace-ADMIN browser session on `D6E_BASE_URL`       |

> Managed d6e deployments expose the Rust API (`/api/v1/...`) and the
> SvelteKit frontend (everything else) on the same origin via a reverse
> proxy that routes by path, so a single base URL is sufficient. If you
> ever need to split them across different hosts, reintroduce a
> dedicated accessor in `src/lib/server/env.ts` and update the callers
> in `src/lib/server/d6e-client.ts`.

> **Before logins work**, the d6e-auth administrator must:
>
> 1. Create a `registered_client` row for this app on d6e-auth.
> 2. Add the callback URL of every environment (e.g.
>    `http://localhost:5173/auth/callback` for dev,
>    `https://<your-deploy>.vercel.app/auth/callback` for prod) to
>    that row's `redirect_uris` array.
> 3. Hand the resulting `client_id` / `client_secret` to operators of
>    this app so they can populate `.env`.

> Every end user authenticates with their own d6e-auth account. Their
> JWT access token is stored in an HTTP-only `auth-access` cookie and
> refreshed transparently via the `auth-refresh` cookie. When a user
> tries to sign in but is not a member of `D6E_WORKSPACE_ID`, the
> server returns them to `/auth/no-access` with a message asking them
> to contact their workspace administrator.

> `D6E_INIT_REFRESH_TOKEN` is only used by the developer-side
> `npm run init` bootstrap (see step 3); the end-user OAuth flow does
> not read it.

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

### 5. (Optional) Enable the "freee に登録" button

Journal generation works as soon as step 3 finishes. The
[`scripts/prompts/freee-registration-prompt.md`](./scripts/prompts/freee-registration-prompt.md)
file is **not** registered by `npm run init` — it is a paste-target for
the d6e chat UI. To activate the registration flow, copy that file in
full and paste it into a d6e chat in the same workspace. The d6e AI
then walks you through a short discovery flow:

1. checks that `freee` and `google_workspace` are connected
   (`d6e_list_saas_credentials`),
2. calls freee `GET /api/1/companies` and Google Drive
   `GET /drive/v3/files` to ask **which company** and **which Drive
   parent folder** to use, then
3. bakes those choices into a per-workspace concrete copy of Scenario D
   and **inserts it just before the `## 共通ルール` heading** of the
   existing prompt rule (so A/B/C/D end up as a contiguous block) via
   `d6e_list_workspace_prompt_rules` and
   `d6e_update_workspace_prompt_rule`.

From that point on, pressing "freee に登録" on a generated journal
returns a structured `kind: "registration"` payload that reuses the
pre-confirmed company and parent folder on every press — the user is no
longer asked at runtime. Receipts are filed under
`<parent folder>/YYYY/MM/` so monthly browsing in Drive is easy; the
LLM auto-creates the year/month folders the first time they are
needed. See
[`docs/llm-output-contract.md`](./docs/llm-output-contract.md) for the
activation contract, idempotency rules, and how to rebind the company
or parent folder later.

## Documentation

- [`docs/architecture.md`](./docs/architecture.md) — request flow and directory layout
- [`docs/d6e-api-integration.md`](./docs/d6e-api-integration.md) — exact request/response payloads
- [`docs/workspace-setup.md`](./docs/workspace-setup.md) — `npm run init` deep dive
- [`docs/llm-output-contract.md`](./docs/llm-output-contract.md) — JSON schema, scenarios, parse fallback
- [`docs/migration-to-full-integration.md`](./docs/migration-to-full-integration.md) — roadmap toward the full d6e-auth/STF integration (C-case)

## Agent Skills

This repository doubles as a reusable Agent Skill package. Three
[`skills/`](./skills/README.md) entries teach AI agents (Claude /
Cursor / etc.) how to build their own d6e-connected frontends using
this codebase as a reference:

| Skill                                                                    | Concern                                                                                                                                                                  |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`d6e-auth-integration`](./skills/d6e-auth-integration/SKILL.md)         | OAuth2 two-stage exchange (d6e-auth → d6e instance), session cookies, transparent refresh, workspace allow-list.                                                         |
| [`d6e-workspace-api-client`](./skills/d6e-workspace-api-client/SKILL.md) | Bearer vs cookie header matrix, the `caller + accessToken + AbortSignal` wrapper convention in `src/lib/server/d6e-client.ts`, and the idempotent prompt-rule bootstrap. |
| [`d6e-prompt-driven-ui`](./skills/d6e-prompt-driven-ui/SKILL.md)         | `kind`-discriminated JSON inside fenced code blocks, Zod parse with markdown fallback, XML-tag revision flows, scenario-append activation via the d6e chat UI.           |

Install in your agent:

```bash
npx skills add https://github.com/d6e-ai/d6e-ai-keiri-example --skill d6e-auth-integration
npx skills add https://github.com/d6e-ai/d6e-ai-keiri-example --skill d6e-workspace-api-client
npx skills add https://github.com/d6e-ai/d6e-ai-keiri-example --skill d6e-prompt-driven-ui
```

These skills are auto-discovered by [skills.sh](https://skills.sh)
from the `skills/<name>/SKILL.md` files in this repository and appear
at `https://skills.sh/d6e-ai/d6e-ai-keiri-example/<skill-name>`.

## Status & caveats

- `/api/workflows/execute-by-intent` is internal to d6e and has no
  stability guarantee. If the upstream contract changes, this app will
  need to follow.
- This example uses a single shared workspace per deployment. Every
  user must be a member of `D6E_WORKSPACE_ID`; non-members are blocked
  at `/auth/no-access` after login.
- Tokens live only in the user's `auth-access` / `auth-refresh`
  cookies. There is no persistent server-side session store; cookies
  are HTTP-only and rotated via the d6e instance's
  `${D6E_BASE_URL}/api/v1/auth/token` endpoint when they are about to
  expire. d6e-auth is only touched during the initial interactive
  login at `/auth/callback`; after the two-stage exchange every
  subsequent refresh stays on the same d6e instance so the
  resulting access_token retains the audience the d6e instance API
  requires.
- The journal table is read-only. Revisions happen by sending a
  natural-language correction back to the LLM (see
  `docs/llm-output-contract.md`). Files cannot be added or removed
  mid-revision; remove receipts from the queue before pressing
  "Generate journal" if you want to retry with a different set.

## License

Proprietary - d6e AI, Inc.
