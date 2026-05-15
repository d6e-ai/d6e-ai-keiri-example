# Architecture

This document describes the request flow, deployment topology, and
directory layout of `d6e-ai-keiri-example`.

## Sequence

````mermaid
sequenceDiagram
    participant User as User Browser
    participant App as d6e-ai-keiri-example<br/>(SvelteKit)
    participant Token as d6e frontend<br/>(/api/v1/auth/token)
    participant Files as d6e Rust API<br/>(/api/v1/workspaces/{wsId}/files)
    participant Intent as d6e SvelteKit<br/>(/api/workflows/execute-by-intent)
    participant Sessions as d6e SvelteKit<br/>(/api/chat-sessions)
    participant LLM as LLM via MCP

    Note over App,Intent: One-time setup
    App->>Token: POST refresh_token grant
    Token-->>App: { access_token }
    App->>Intent: POST /api/workspace-prompt-rules<br/>(Cookie: auth-token=<access_token>)
    Intent-->>App: 201 Created

    Note over User,LLM: Journal creation
    User->>App: Upload receipt image
    App->>Token: getAccessToken() — refresh if cached token<br/>is within 60s of exp
    Token-->>App: access_token (cached in memory)
    App->>Files: POST .../files (Bearer access_token, base64 body)
    Files-->>App: { id: <fileId> }
    App->>Intent: POST execute-by-intent (Bearer access_token, inputFileRefs)
    Intent->>LLM: generateText with MCP tools
    LLM-->>Intent: assistant message<br/>(```json + journal entries```)
    Intent-->>App: IntentResponse
    App->>Sessions: POST /api/chat-sessions<br/>(Cookie: auth-token=<access_token>)
    Sessions-->>App: { id: <sessionId> }
    App-->>User: Render journal table + persist session id

    Note over User,LLM: Revision (re-generation)
    User->>App: Revision comment
    App->>Intent: POST execute-by-intent (message contains<br/><previous_journal>...</previous_journal>)
    Intent->>LLM: regenerate
    LLM-->>Intent: updated JSON
    Intent-->>App: IntentResponse
    App->>Sessions: PATCH /api/chat-sessions/<id> (append user+assistant)
    Sessions-->>App: updated session
    App-->>User: Update journal table
````

## Trust boundaries

- The browser only talks to this app's own SvelteKit server. The
  d6e access token is never sent to the browser.
- The long-lived refresh token (`D6E_REFRESH_TOKEN`) lives only in
  environment variables on this server. It is exchanged for a
  short-lived access token via
  `${D6E_FRONTEND_URL}/api/v1/auth/token`. That endpoint accepts only
  the refresh token (no `client_id` / `client_secret`) and issues a
  token whose `aud` claim matches the same `b-button` instance that
  validates it, so audience mismatch is impossible by construction.

## Directory layout

```
src/
├── routes/
│   ├── +layout.svelte                       # Sidebar + content shell
│   ├── +page.server.ts                      # SSR loader: pending tasks (chat_session)
│   ├── +page.svelte                         # AI Journal (root)
│   ├── tasks/+page.server.ts                # SSR loader: completed tasks
│   ├── tasks/+page.svelte                   # Completed tasks
│   ├── ask/+page.svelte                     # Free-form accounting Q&A
│   └── api/
│       ├── upload/+server.ts                # POST /api/upload  -> d6e Files API
│       ├── intent/+server.ts                # POST /api/intent  -> execute-by-intent + persist
│       ├── chat-sessions/+server.ts         # GET list, POST create
│       └── chat-sessions/[id]/+server.ts    # GET / PATCH / DELETE
└── lib/
    ├── components/
    │   ├── app-sidebar.svelte
    │   ├── receipt-uploader.svelte
    │   ├── task-card.svelte                 # ChatSessionRow -> card
    │   ├── task-detail-dialog.svelte        # Detail + complete / revert / delete
    │   ├── journal-result.svelte
    │   └── revise-comment-form.svelte
    ├── server/
    │   ├── d6e-token.ts                     # In-memory access token cache + auto-refresh
    │   ├── d6e-client.ts                    # Bearer- and cookie-authed fetch wrappers
    │   └── env.ts                           # Lazy env-var validation
    ├── journal-schema.ts                    # Zod schema for the LLM JSON contract
    ├── journal-title.ts                     # Title prefix / suffix helpers
    ├── journal-task.ts                      # Derive task summary from chat sessions
    ├── parse-journal.ts                     # extractJsonBlocks + parseJournalMessage
    ├── markdown.ts                          # marked-based renderer for assistant text
    ├── paraglide/                           # Auto-generated i18n (do not edit)
    └── utils.ts                             # cn() and formatJpyAmount()
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

| Module                                          | Responsibility                                                                                                                                  |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/server/env.ts`                         | Validate `D6E_*` env vars on first read with clear error messages.                                                                              |
| `src/lib/server/d6e-token.ts`                   | Cache the d6e access token in memory and refresh it via `${D6E_FRONTEND_URL}/api/v1/auth/token` before it expires.                              |
| `src/lib/server/d6e-client.ts`                  | Bearer- and cookie-authed fetch wrappers for files / execute-by-intent / chat-sessions; retries each call once on 401 after invalidating cache. |
| `src/routes/api/upload/+server.ts`              | Accepts `multipart/form-data` and forwards each file to d6e Storage.                                                                            |
| `src/routes/api/intent/+server.ts`              | Calls `executeByIntent`, then persists user+assistant messages into a `chat_session` (creating or appending depending on `chatSessionId`).      |
| `src/routes/api/chat-sessions/+server.ts`       | List / create chat sessions, pinning `workspaceId` from server env so the browser cannot leak across workspaces.                                |
| `src/routes/api/chat-sessions/[id]/+server.ts`  | Retrieve / patch (title / messages) / delete a single chat session.                                                                             |
| `src/lib/journal-title.ts`                      | Build and inspect the `[keiri] ...`, `[keiri-ask] ...`, and `... #completed` title conventions.                                                 |
| `src/lib/journal-task.ts`                       | Derive `{ status, entryCount, totalAmount, journalDate }` from a `ChatSessionRow` for card rendering.                                           |
| `src/lib/parse-journal.ts`                      | Pulls the first valid ` ```json ` block out of the assistant response and validates it with Zod.                                                |
| `src/lib/components/journal-result.svelte`      | Renders the parsed journal as a read-only table; falls back to markdown on parse failure.                                                       |
| `src/lib/components/task-card.svelte`           | One card per `chat_session` — title, status, derived journal summary.                                                                           |
| `src/lib/components/task-detail-dialog.svelte`  | Modal that shows the full journal table and exposes Mark Completed / Revert / Delete.                                                           |
| `src/lib/components/revise-comment-form.svelte` | Captures the user's natural-language revision request and forwards it to the page.                                                              |
| `src/routes/+page.svelte`                       | Owns the upload → parse → revise pipeline and renders pending-task cards from the SSR loader.                                                   |

## Failure model

- **d6e unreachable**: `D6eClientError` bubbles up with the upstream status
  and body. The route handler relays that status code back to the
  browser, and the AI Journal / Ask pages show a red banner.
- **Access token expired**: `d6e-client.ts` retries once after calling
  `invalidateAccessToken()`. If the upstream still returns 401 the error
  propagates as usual. Normally callers never observe this path because
  `d6e-token.ts` refreshes 60 seconds before `exp`.
- **Refresh token rotated / revoked**: `d6e-token.ts` surfaces the
  upstream response verbatim with a hint to update `D6E_REFRESH_TOKEN`.
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
