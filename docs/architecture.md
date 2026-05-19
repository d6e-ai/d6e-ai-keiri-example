# Architecture

This document describes the request flow, deployment topology, and
directory layout of `d6e-ai-keiri-example`.

## Sequence

```mermaid
sequenceDiagram
    participant User as User Browser
    participant App as d6e-ai-keiri-example<br/>(SvelteKit)
    participant Auth as d6e-auth<br/>(${D6E_AUTH_URL})
    participant Token as d6e instance<br/>(${D6E_BASE_URL}/api/v1/auth/token)
    participant Files as d6e instance API<br/>(/api/v1/workspaces/{wsId}/files)
    participant Intent as d6e instance<br/>(/api/workflows/execute-by-intent)
    participant Sessions as d6e SvelteKit<br/>(/api/chat-sessions)
    participant LLM as LLM via MCP

    Note over App,Intent: One-time setup (operator)
    App->>Token: POST refresh_token grant<br/>using D6E_INIT_REFRESH_TOKEN
    Token-->>App: { access_token }
    App->>Intent: POST /api/workspace-prompt-rules<br/>(Cookie: auth-token=<access_token>)
    Intent-->>App: 201 Created

    Note over User,App: End-user login (per session)
    User->>App: GET / (no cookie)
    App-->>User: 302 /auth/login
    User->>Auth: log in (email+password / Google)
    Auth-->>App: /auth/callback?code&state
    App->>Auth: POST /api/v1/auth/token (authorization_code)
    Auth-->>App: { access_token (iss=d6e-auth), refresh_token }
    Note over App,Token: stage 2 — d6e-auth's access_token is rejected by<br/>the d6e instance API (aud mismatch), so re-mint at the d6e instance
    App->>Token: POST /api/v1/auth/token (refresh_token)
    Token-->>App: { access_token (iss=&lt;d6e-instance&gt;), refresh_token }
    App->>Files: GET /api/v1/workspaces/{D6E_WORKSPACE_ID}<br/>(membership probe, Bearer d6e-instance token)
    Files-->>App: 200 OK (or 403 -> /auth/no-access)
    App-->>User: Set-Cookie auth-access / auth-refresh; 302 /

    Note over User,LLM: Journal creation
    User->>App: Pick N receipt images
    App->>Files: POST .../files/multipart<br/>(Bearer access_token, x N)
    Files-->>App: { id: <fileId> } (x N)
    User->>App: Press "Generate journal"
    App->>Intent: POST execute-by-intent<br/>(Bearer access_token, inputFileRefs[])
    Intent->>LLM: generateText with MCP tools
    LLM-->>Intent: assistant message<br/>(```json + journal entries```)
    Intent-->>App: IntentResponse
    App->>Sessions: POST /api/chat-sessions<br/>(Cookie: auth-token=<access_token>)
    Sessions-->>App: { id: <sessionId> }
    App-->>User: Render journal table + persist session id

    Note over User,LLM: Revision (re-generation)
    User->>App: Revision comment
    App->>Intent: POST execute-by-intent (message contains<br/><previous_journal>...</previous_journal>,<br/>same inputFileRefs[])
    Intent->>LLM: regenerate
    LLM-->>Intent: updated JSON
    Intent-->>App: IntentResponse
    App->>Sessions: PATCH /api/chat-sessions/<id> (append user+assistant)
    Sessions-->>App: updated session
    App-->>User: Update journal table
```

## Trust boundaries

- The browser only talks to this app's own SvelteKit server. The d6e
  access / refresh tokens are stored exclusively in HTTP-only cookies
  on the user's browser; the JavaScript runtime cannot read them.
- Every d6e API call is made server-side using
  `event.locals.accessToken`, which is populated by `hooks.server.ts`
  from the `auth-access` cookie. There is no shared / long-lived
  server-side token.
- The OAuth flow starts at `${D6E_AUTH_URL}` (e.g. `https://www.d6e.ai`)
  for the user-facing login UI, but the resulting refresh token is
  **immediately re-presented to `${D6E_BASE_URL}/api/v1/auth/token`**
  (the d6e instance). Only the d6e-instance-signed pair is persisted
  in cookies. d6e-auth's access tokens are never stored or used as
  Bearer credentials — the d6e instance rejects them as `aud` mismatch
  (`iss=d6e-auth`). After the two-stage exchange the same
  d6e-instance JWT works for both Bearer-authed d6e instance API
  calls and cookie-authed SvelteKit chat-session calls. Per-session
  refresh (`session.loadSession()`) also stays on the d6e instance
  endpoint so the rotated token never drifts back to a
  d6e-auth-issued one.
- The bootstrap script (`scripts/init-workspace.mjs`) uses a separate
  admin-only refresh token (`D6E_INIT_REFRESH_TOKEN`) that follows the
  same d6e instance refresh pattern. End users never touch it.

## Directory layout

```
src/
├── routes/
│   ├── +layout.svelte                       # Sidebar + content shell
│   ├── +layout.server.ts                    # Surface locals.user to PageData
│   ├── +page.server.ts                      # SSR loader: pending tasks (chat_session)
│   ├── +page.svelte                         # AI Journal (root)
│   ├── tasks/+page.server.ts                # SSR loader: completed tasks
│   ├── tasks/+page.svelte                   # Completed tasks
│   ├── ask/+page.svelte                     # Free-form accounting Q&A
│   ├── auth/+layout.svelte                  # Sidebar-less layout for /auth/*
│   ├── auth/login/+server.ts                # Start OAuth2 (state cookie + 302)
│   ├── auth/callback/+server.ts             # OAuth2 code exchange + membership
│   ├── auth/logout/+server.ts               # Clear local cookies + delegate to d6e-auth logout
│   ├── auth/no-access/+page.svelte          # Workspace allow-list reject page
│   └── api/
│       ├── upload/+server.ts                # POST /api/upload  -> d6e Files API
│       ├── upload/[fileId]/+server.ts       # DELETE /api/upload/{id}
│       ├── intent/+server.ts                # POST /api/intent  -> execute-by-intent + persist
│       ├── chat-sessions/+server.ts         # GET list, POST create
│       └── chat-sessions/[id]/+server.ts    # GET / PATCH / DELETE
├── hooks.server.ts                          # Per-request session load + redirect
├── app.d.ts                                 # locals.user / locals.accessToken types
└── lib/
    ├── components/
    │   ├── app-sidebar.svelte               # Now displays user + logout
    │   ├── receipt-uploader.svelte          # Multi-file picker
    │   ├── uploaded-file-list.svelte        # Queue + per-row delete
    │   ├── task-card.svelte                 # ChatSessionRow -> card
    │   ├── task-detail-dialog.svelte        # Detail + complete / revert / delete
    │   ├── journal-result.svelte
    │   └── revise-comment-form.svelte
    ├── server/
    │   ├── oauth.ts                         # Token endpoint client + state helpers
    │   ├── session.ts                       # auth-* cookie store + exp-based refresh
    │   ├── d6e-client.ts                    # Bearer- and cookie-authed fetch wrappers
    │   └── env.ts                           # Lazy env-var validation
    ├── upload-types.ts                      # Shared types for the queue UI
    ├── journal-schema.ts                    # Zod schema for the LLM JSON contract
    ├── journal-title.ts                     # Title prefix / suffix helpers
    ├── journal-task.ts                      # Derive task summary from chat sessions
    ├── parse-journal.ts                     # extractJsonBlocks + parseJournalMessage
    ├── markdown.ts                          # marked-based renderer for assistant text
    ├── paraglide/                           # Auto-generated i18n (do not edit)
    └── utils.ts                             # cn() and formatJpyAmount()
scripts/
├── init-workspace.mjs           # Register prompt rule on d6e (D6E_INIT_REFRESH_TOKEN)
└── prompts/
    └── ai-keiri-prompt.md       # Single source of truth for LLM behaviour
docs/                            # This directory
messages/
├── ja-JP.json                   # Base locale
└── en-US.json
```

## Module responsibilities

| Module                                                  | Responsibility                                                                                                                                                |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/server/env.ts`                                 | Validate `D6E_*` and `D6E_AUTH_*` env vars on first read with clear error messages.                                                                           |
| `src/lib/server/oauth.ts`                               | Build authorize URLs, exchange codes at `${D6E_AUTH_URL}/api/v1/auth/token`, re-mint at `${D6E_BASE_URL}/api/v1/auth/token` (`refreshAccessTokenViaBaseUrl`), decode JWT `exp`, generate CSRF state. |
| `src/lib/server/session.ts`                             | Read / write the `auth-access` / `auth-refresh` / `auth-user` cookies; transparently refresh tokens against the d6e instance when within 60 seconds of expiry. |
| `src/hooks.server.ts`                                   | Populate `event.locals.accessToken` / `event.locals.user` per request; redirect unauthenticated requests to `/auth/login`.                                    |
| `src/lib/server/d6e-client.ts`                          | Bearer- and cookie-authed fetch wrappers for files / execute-by-intent / chat-sessions; every entry point now takes `accessToken: string` explicitly.         |
| `src/routes/auth/login/+server.ts`                      | Generate a state cookie and 302 the user to `${D6E_AUTH_URL}/auth/login`.                                                                                     |
| `src/routes/auth/callback/+server.ts`                   | Verify state, exchange the code, probe workspace membership, set session cookies (or send the user to `/auth/no-access`).                                     |
| `src/routes/auth/logout/+server.ts`                     | Clear local session cookies and 303 to `${D6E_AUTH_URL}/auth/logout?redirect_uri=/auth/login` so d6e-auth also drops its own session cookie. Without this hop the next `/auth/login` would silently re-issue a code from the still-live d6e-auth session and put the user back in. |
| `src/routes/api/upload/+server.ts`                      | POST `multipart/form-data` -> d6e Storage. Uses `event.locals.accessToken`.                                                                                   |
| `src/routes/api/upload/[fileId]/+server.ts`             | DELETE one previously uploaded file when the user removes it from the queue before pressing "Generate journal".                                               |
| `src/routes/api/intent/+server.ts`                      | Calls `executeByIntent` with the full `inputFileRefs[]`, then persists user+assistant messages into a `chat_session`.                                         |
| `src/routes/api/chat-sessions/+server.ts`               | List / create chat sessions, pinning `workspaceId` server-side.                                                                                               |
| `src/routes/api/chat-sessions/[id]/+server.ts`          | Retrieve / patch (title / messages) / delete a single chat session.                                                                                           |
| `src/lib/components/receipt-uploader.svelte`            | Multi-file picker (drag-drop + button). Hands back a `File[]` to the page.                                                                                    |
| `src/lib/components/uploaded-file-list.svelte`          | Renders the pending-upload + uploaded queue with a per-row delete button.                                                                                     |
| `src/lib/journal-title.ts`                              | Build and inspect the `[keiri] ...`, `[keiri-ask] ...`, and `... #completed` title conventions.                                                               |
| `src/lib/journal-task.ts`                               | Derive `{ status, entryCount, totalAmount, journalDate }` from a `ChatSessionRow` for card rendering.                                                         |
| `src/lib/parse-journal.ts`                              | Pulls the first valid ` ```json ` block out of the assistant response and validates it with Zod.                                                              |
| `src/lib/components/journal-result.svelte`              | Renders the parsed journal as a read-only table; falls back to markdown on parse failure.                                                                     |
| `src/lib/components/task-card.svelte`                   | One card per `chat_session` — title, status, derived journal summary.                                                                                         |
| `src/lib/components/task-detail-dialog.svelte`          | Modal that shows the full journal table and exposes Mark Completed / Revert / Delete.                                                                         |
| `src/lib/components/revise-comment-form.svelte`         | Captures the user's natural-language revision request and forwards it to the page.                                                                            |
| `src/routes/+page.svelte`                               | Owns the upload-queue + execute + revise pipeline and renders pending-task cards from the SSR loader.                                                         |

## Failure model

- **d6e unreachable**: `D6eClientError` bubbles up with the upstream status
  and body. The route handler relays that status code back to the
  browser, and the AI Journal / Ask pages show a red banner.
- **Access token expired**: `session.loadSession()` refreshes the token
  60 seconds before `exp` by POSTing the `auth-refresh` cookie value
  to `${D6E_BASE_URL}/api/v1/auth/token` (the d6e instance, never
  d6e-auth). The rotated `access_token` therefore still carries the
  d6e instance's `iss`, which is what every d6e instance API endpoint
  expects. If the refresh round-trip fails, the cookies are cleared
  and the next request lands
  on `/auth/login`. Route handlers therefore never have to retry on
  401 themselves.
- **Refresh token rotated / revoked**: same as above — the user is
  redirected to `/auth/login` and can sign in again. There is no
  shared server-side token to update.
- **Workspace membership revoked mid-session**: d6e API responses
  start coming back as 403. The user has to log out and log back in;
  the membership probe in `/auth/callback` will then send them to
  `/auth/no-access` until an admin re-adds them.
- **LLM off-contract**: `parseJournalMessage` returns a `fallback` result.
  The UI shows a warning banner plus the raw assistant text. No data is
  thrown away.

## Deployment

The app is built with `@sveltejs/adapter-vercel`, so any Vercel project
can deploy it directly. Environment variables map 1:1 between `.env`
and the Vercel dashboard. The bootstrap script (`npm run init`) is a
one-shot script and is not part of the deployed runtime.
