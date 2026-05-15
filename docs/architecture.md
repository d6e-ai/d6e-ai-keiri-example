# Architecture

This document describes the request flow, deployment topology, and
directory layout of `d6e-ai-keiri-example`.

## Sequence

```mermaid
sequenceDiagram
    participant User as User Browser
    participant App as d6e-ai-keiri-example<br/>(SvelteKit)
    participant Auth as d6e-auth<br/>(D6E_AUTH_URL)
    participant Files as d6e Rust API<br/>(/api/v1/workspaces/{wsId}/files)
    participant Intent as d6e SvelteKit<br/>(/api/workflows/execute-by-intent)
    participant LLM as LLM via MCP

    Note over App,Intent: One-time setup
    App->>Auth: POST /api/v1/auth/token (refresh_token grant)
    Auth-->>App: { access_token, refresh_token }
    App->>Intent: POST /api/workspace-prompt-rules<br/>(Cookie: auth-token=<access_token>)
    Intent-->>App: 201 Created

    Note over User,LLM: Journal creation
    User->>App: Upload receipt image
    App->>Auth: getAccessToken() — refresh if cached token<br/>is within 60s of exp
    Auth-->>App: access_token (cached in memory)
    App->>Files: POST .../files (Bearer access_token, base64 body)
    Files-->>App: { id: <fileId> }
    App->>Intent: POST execute-by-intent (Bearer access_token, inputFileRefs)
    Intent->>LLM: generateText with MCP tools
    LLM-->>Intent: assistant message<br/>(```json + journal entries```)
    Intent-->>App: IntentResponse
    App-->>User: Render journal table

    Note over User,LLM: Revision (re-generation)
    User->>App: Revision comment
    App->>Intent: POST execute-by-intent (message contains<br/><previous_journal>...</previous_journal>)
    Intent->>LLM: regenerate
    LLM-->>Intent: updated JSON
    Intent-->>App: IntentResponse
    App-->>User: Update journal table
```

## Trust boundaries

- The browser only talks to this app's own SvelteKit server. The
  d6e access token is never sent to the browser.
- The long-lived refresh token (`D6E_REFRESH_TOKEN`) lives only in
  environment variables on this server. It is exchanged for a
  short-lived access token via the d6e-auth OAuth refresh flow.
- The OAuth client credentials (`D6E_AUTH_CLIENT_ID` /
  `D6E_AUTH_CLIENT_SECRET`) are sent only to `D6E_AUTH_URL`. They
  authenticate the application itself with d6e-auth.

## Directory layout

```
src/
├── routes/
│   ├── +layout.svelte           # Sidebar + content shell
│   ├── +page.svelte             # AI Journal (root)
│   ├── tasks/+page.svelte       # Completed tasks (mock)
│   ├── ask/+page.svelte         # Free-form accounting Q&A
│   └── api/
│       ├── upload/+server.ts    # POST /api/upload  -> d6e Files API
│       └── intent/+server.ts    # POST /api/intent  -> execute-by-intent
└── lib/
    ├── components/
    │   ├── app-sidebar.svelte
    │   ├── receipt-uploader.svelte
    │   ├── task-card.svelte
    │   ├── journal-result.svelte
    │   └── revise-comment-form.svelte
    ├── server/
    │   ├── d6e-token.ts         # In-memory access token cache + auto-refresh
    │   ├── d6e-client.ts        # Bearer-authed fetch wrapper (uses d6e-token)
    │   └── env.ts               # Lazy env-var validation
    ├── journal-schema.ts        # Zod schema for the LLM JSON contract
    ├── parse-journal.ts         # extractJsonBlocks + parseJournalMessage
    ├── mock-data/tasks.ts       # Pending / completed task fixtures
    ├── paraglide/               # Auto-generated i18n (do not edit)
    └── utils.ts                 # cn() and formatJpyAmount()
scripts/
├── init-workspace.mjs           # Register prompt rule on d6e
└── prompts/
    └── ai-keiri-prompt.md       # Single source of truth for LLM behaviour
docs/                            # This directory
messages/
├── ja-JP.json                   # Base locale
└── en-US.json
```

## Module responsibilities

| Module                                                      | Responsibility                                                                                                |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `src/lib/server/env.ts`                                     | Validate `D6E_*` env vars on first read with clear error messages.                                            |
| `src/lib/server/d6e-token.ts`                               | Cache the d6e access token in memory and refresh it via d6e-auth (`refresh_token` grant) before it expires.   |
| `src/lib/server/d6e-client.ts`                              | `uploadFile()` / `executeByIntent()` — single place that injects the cached access token and retries on 401.  |
| `src/routes/api/upload/+server.ts`                          | Accepts `multipart/form-data` and forwards each file to d6e Storage.                                          |
| `src/routes/api/intent/+server.ts`                          | Accepts JSON `{ message, inputFileRefs? }` and forwards to execute-by-intent, injecting `workspaceId`.        |
| `src/lib/parse-journal.ts`                                  | Pulls the first valid ` ```json ` block out of the assistant response and validates it with Zod.              |
| `src/lib/components/journal-result.svelte`                  | Renders the parsed journal as a read-only table; falls back to raw text on parse failure.                     |
| `src/lib/components/revise-comment-form.svelte`             | Captures the user's natural-language revision request and forwards it to the page.                            |
| `src/routes/+page.svelte`                                   | Owns the upload → parse → revise pipeline and the pending-task list.                                          |

## Failure model

- **d6e unreachable**: `D6eClientError` bubbles up with the upstream status
  and body. The route handler relays that status code back to the
  browser, and the AI Journal / Ask pages show a red banner.
- **Access token expired**: `d6e-client.ts` retries once after calling
  `invalidateAccessToken()`. If the upstream still returns 401 the error
  propagates as usual. Normally callers never observe this path because
  `d6e-token.ts` refreshes 60 seconds before `exp`.
- **Refresh token rotated / revoked**: `d6e-token.ts` surfaces the
  d6e-auth response verbatim with a hint to update `D6E_REFRESH_TOKEN`.
  The operator has to copy a fresh `auth-refresh` cookie value into
  `.env` and restart `npm run dev`.
- **LLM off-contract**: `parseJournalMessage` returns a `fallback` result.
  The UI shows a warning banner plus the raw assistant text. No data is
  thrown away.

## Deployment

The app is built with `@sveltejs/adapter-vercel`, so any Vercel project
can deploy it directly. Environment variables map 1:1 between `.env`
and the Vercel dashboard. The bootstrap script (`npm run init`) is a
one-shot script and is not part of the deployed runtime.
