# d6e API integration

This document captures the exact request/response shapes used by this
app. They are derived from the d6e source as of the time this example was
written; if d6e changes its API, the relevant files here must be updated.

## 1. File upload — `/api/v1/workspaces/{workspaceId}/files/multipart`

**Hosted by:** d6e Rust API server, exposed under
`${D6E_BASE_URL}/api/v1/...`. In a managed d6e deployment a reverse
proxy on the same origin routes `/api/v1/*` to the Rust API and
everything else to the SvelteKit frontend, so a single `D6E_BASE_URL`
covers both surfaces.

**Auth:** `Authorization: Bearer <access_token>` + `X-Workspace-ID: <UUID>`.
The access token comes from `event.locals.accessToken`, which
`hooks.server.ts` populates from the end user's `auth-access` cookie
(see section 4 below).

**Request:** `multipart/form-data` with one `file` field carrying the
raw file bytes and one `metadata` field containing a JSON-encoded
object (this app sends `{"source":"d6e-ai-keiri-example"}`).

**Response (JSON):**

```json
{
	"id": "019bbac4-68a4-71d3-8928-8b32cabec841",
	"filename": "receipt.jpg",
	"content_type": "image/jpeg",
	"size": 124300
}
```

The `id` field is the Storage UUID that must be passed to
`execute-by-intent` as `inputFileRefs[].fileId`.

**This app's wrapper:**
[`src/routes/api/upload/+server.ts`](../src/routes/api/upload/+server.ts)
relays the browser's `multipart/form-data` via
[`uploadFile()`](../src/lib/server/d6e-client.ts). When the user
removes a queued file before pressing "Generate journal",
[`DELETE /api/upload/{fileId}`](../src/routes/api/upload/%5BfileId%5D/+server.ts)
forwards a DELETE to the same Rust endpoint to clean up the orphan.

**Upstream reference:**
[d6e `packages/frontend/src/routes/api/workspaces/[workspaceId]/files/upload/+server.ts`](https://github.com/d6e-ai/d6e/blob/main/packages/frontend/src/routes/api/workspaces/%5BworkspaceId%5D/files/upload/+server.ts)
(the d6e frontend's own proxy of the same Rust endpoint).

## 2. Natural-language workflow — `/api/workflows/execute-by-intent`

**Hosted by:** d6e SvelteKit frontend, exposed under
`${D6E_BASE_URL}/api/workflows/...`.

**Auth:** `Authorization: Bearer <access_token>` (no cookie required).

**Request body (JSON):**

```json
{
	"message": "領収書を仕訳に変換してください",
	"workspaceId": "<UUID>",
	"inputFileRefs": [
		{
			"fileId": "<UUID from Storage>",
			"filename": "receipt.jpg",
			"mimeType": "image/jpeg",
			"sizeBytes": 124300
		}
	]
}
```

Notes:

- `workspaceId` is validated as a UUID upstream; non-UUID values produce
  HTTP 400. This app injects the configured `D6E_WORKSPACE_ID` so callers
  never have to pass it.
- `inputFileRefs` is optional. For purely textual questions (the `/ask`
  page) it is omitted.
- `conversationContextBlock`, `snsSource`, and `externalConversationKey`
  are upstream-supported fields aimed at SNS bot proxies. We don't use
  them; revisions are handled by embedding the previous JSON in
  `message` instead.

**Response (JSON):**

```json
{
	"success": true,
	"message": "領収書を解析し、3件の仕訳を生成しました。\n\n```json\n{...}\n```",
	"workflowName": null,
	"files": [],
	"result": null
}
```

- `message` is the free-form assistant text. This app runs it through
  [`parseJournalMessage()`](../src/lib/parse-journal.ts) to extract the
  ` ```json ` block.
- `files` is populated when the LLM produces a binary output via the
  `d6e_instant_run_stf` MCP tool (e.g. an Excel export). In the example
  app no STF is registered so `files` is always empty.

**This app's wrapper:**
[`src/routes/api/intent/+server.ts`](../src/routes/api/intent/+server.ts)
uses [`executeByIntent()`](../src/lib/server/d6e-client.ts) to relay the
upstream response unchanged.

**Upstream reference:**
[d6e `packages/frontend/src/routes/api/workflows/execute-by-intent/+server.ts`](https://github.com/d6e-ai/d6e/blob/main/packages/frontend/src/routes/api/workflows/execute-by-intent/+server.ts).

## 3. Workspace prompt rule — `/api/workspace-prompt-rules`

**Hosted by:** d6e SvelteKit frontend, exposed under
`${D6E_BASE_URL}/api/workspace-prompt-rules`.

**Auth:** `Cookie: auth-token=<access_token>` (admin-on-workspace required).
**This endpoint does NOT accept Bearer headers** — see [workspace-setup.md](./workspace-setup.md).

**Request body (JSON):**

```json
{
	"workspaceId": "<UUID>",
	"content": "<prompt body up to 50,000 characters>"
}
```

**Response (JSON, HTTP 201):**

```json
{
	"id": "...",
	"workspaceId": "...",
	"content": "...",
	"sortOrder": 0
}
```

POST appends the new rule at the next `sortOrder`. There is no PUT/DELETE
helper in this app; if you need to remove or replace a rule, do it from
the d6e frontend's admin UI for now.

**This app's wrapper:**
[`scripts/init-workspace.mjs`](../scripts/init-workspace.mjs) reads
`scripts/prompts/ai-keiri-prompt.md` and POSTs it once.

**Upstream reference:**
[d6e `packages/frontend/src/routes/api/workspace-prompt-rules/+server.ts`](https://github.com/d6e-ai/d6e/blob/main/packages/frontend/src/routes/api/workspace-prompt-rules/+server.ts).

## 4. End-user OAuth2 — `${D6E_AUTH_URL}/api/v1/auth/token`

**Hosted by:** d6e-auth (e.g. `https://www.d6e.ai`). Returns JWT pairs
whose `aud` matches the same `b-button` instance that validates them,
which avoids audience-claim mismatch errors on the API side.

This app implements the OAuth2 **Authorization Code** flow per end
user. The flow lives in three SvelteKit routes:

| Step                                | Endpoint                           |
| ----------------------------------- | ---------------------------------- |
| Start (state cookie + 302 to auth)  | `GET /auth/login`                  |
| Callback (state verify + exchange)  | `GET /auth/callback`               |
| Logout (cookie clear + 302)         | `GET /auth/logout` (or POST form)  |
| Membership reject                   | `GET /auth/no-access`              |

**Token endpoint request body (JSON):**

```json
{
	"grant_type": "authorization_code",
	"code": "<value from /auth/callback>",
	"client_id": "<D6E_AUTH_CLIENT_ID>",
	"client_secret": "<D6E_AUTH_CLIENT_SECRET>",
	"redirect_uri": "<D6E_AUTH_REDIRECT_URI>"
}
```

Refresh requests use `grant_type=refresh_token` with the rotated
`refresh_token` instead of `code` and drop the `redirect_uri` field.

**Response (JSON):**

```json
{
	"access_token": "eyJhbGciOi...",
	"refresh_token": "eyJhbGciOi...",
	"token_type": "Bearer",
	"expires_in": 3600
}
```

Notes:

- The response always rotates `refresh_token`. This app stores the
  rotated value in the user's `auth-refresh` cookie (HTTP-only,
  SameSite=Lax, 30-day cap), so the next refresh round-trip uses the
  freshest token automatically.
- 4xx responses cause the user to be bounced back to `/auth/login` so
  they can try again with a fresh authorization code.
- 5xx responses are transient and surface as a 502 client error.

**This app's wrappers:**
[`src/lib/server/oauth.ts`](../src/lib/server/oauth.ts) (token endpoint),
[`src/lib/server/session.ts`](../src/lib/server/session.ts) (cookie store
and exp-based refresh), and [`src/hooks.server.ts`](../src/hooks.server.ts)
(per-request session loading + unauthenticated redirect).

### Workspace allow-list

After a successful code-exchange, `/auth/callback` calls
`GET ${D6E_BASE_URL}/api/v1/workspaces/${D6E_WORKSPACE_ID}` to confirm
the user is a member of the configured workspace. Non-members are
forwarded to `/auth/no-access` and never see the rest of the app. See
[`verifyWorkspaceMembership()`](../src/lib/server/d6e-client.ts).

### Developer-side init token

`scripts/init-workspace.mjs` still uses a fixed long-lived refresh
token, but under a renamed env var (`D6E_INIT_REFRESH_TOKEN`) so that
it cannot be confused with the user-facing `auth-refresh` cookie. The
script targets `${D6E_BASE_URL}/api/v1/auth/token` directly (the
b-button instance) because the prompt-rule POST requires a
cookie-authenticated admin session on the same origin.

## 5. Chat session persistence — `/api/chat-sessions`

**Hosted by:** the d6e SvelteKit frontend, exposed under
`${D6E_BASE_URL}/api/chat-sessions[/...]`.

This app stores every journal run and every general-question run as a
`chat_session` in d6e so that the AI Journal list survives across page
reloads and is also visible in the d6e chat UI.

| Method                  | Purpose                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------ |
| `GET /api/chat-sessions?workspaceId=…` | List the workspace's sessions (descending by `updatedAt`).                                 |
| `POST /api/chat-sessions`              | Create a session — body `{ workspaceId, title, messages, snsSource?, externalConversationKey? }`. |
| `GET /api/chat-sessions/{id}`          | Fetch one session.                                                                         |
| `PATCH /api/chat-sessions/{id}`        | Update `title` and/or `messages` (used for marking completed and appending revisions).     |
| `DELETE /api/chat-sessions/{id}`       | Soft-deletes via the d6e implementation; row is removed from list endpoints.               |

All five accept the access token through a `Cookie: auth-token=<jwt>`
header (Bearer is rejected). This app pins `workspaceId` from
`D6E_WORKSPACE_ID` on the server side so the browser cannot leak across
workspaces.

Title conventions (see [`src/lib/journal-title.ts`](../src/lib/journal-title.ts)):

- `[keiri] <generated title>` — a journal session created from this app.
- `[keiri-ask] <generated title>` — a `/ask` (general question) session.
- ` #completed` suffix — the user marked the journal complete.

**This app's wrappers:**
[`src/routes/api/chat-sessions/+server.ts`](../src/routes/api/chat-sessions/+server.ts)
and
[`src/routes/api/chat-sessions/[id]/+server.ts`](../src/routes/api/chat-sessions/%5Bid%5D/+server.ts),
which in turn call helpers in
[`src/lib/server/d6e-client.ts`](../src/lib/server/d6e-client.ts).

## Auth model summary

| Endpoint                                              | Header / Body                          | Source                                                                  |
| ----------------------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------- |
| `POST /api/v1/workspaces/{id}/files/multipart`        | `Authorization: Bearer <access_token>` | `event.locals.accessToken` (auth-access cookie via hooks.server.ts)     |
| `DELETE /api/v1/workspaces/{id}/files/{fileId}`       | `Authorization: Bearer <access_token>` | same as above                                                           |
| `GET /api/v1/workspaces/{id}`                         | `Authorization: Bearer <access_token>` | same as above (only called from `/auth/callback`)                       |
| `POST /api/workflows/execute-by-intent`               | `Authorization: Bearer <access_token>` | same as above                                                           |
| `/api/chat-sessions[*]`                               | `Cookie: auth-token=<access_token>`    | same as above (re-emitted as a server-to-server cookie)                 |
| `POST ${D6E_AUTH_URL}/api/v1/auth/token` (user)       | JSON `code` / `refresh_token`          | OAuth2 code from `/auth/callback`, or rotated value of `auth-refresh`   |
| `POST ${D6E_BASE_URL}/api/v1/auth/token` (init)       | JSON `refresh_token`                   | `D6E_INIT_REFRESH_TOKEN` (admin-only, never used by the user flow)      |
| `POST /api/workspace-prompt-rules`                    | `Cookie: auth-token=<access_token>`    | access token issued by the init refresh above                           |

Bearer headers and `auth-token` cookies carry the same JWT — only the
transport differs. The app never persists the JWT server-side; every
request reads the user's cookie via `hooks.server.ts`, which
transparently refreshes it via `${D6E_AUTH_URL}/api/v1/auth/token` when
the JWT's `exp` is within 60 seconds.
