# d6e API integration

This document captures the exact request/response shapes used by this
app. They are derived from the d6e source as of the time this example was
written; if d6e changes its API, the relevant files here must be updated.

## 1. File upload — `/api/v1/workspaces/{workspaceId}/files`

**Hosted by:** d6e Rust API server, exposed under
`${D6E_BASE_URL}/api/v1/...`. In a managed d6e deployment a reverse
proxy on the same origin routes `/api/v1/*` to the Rust API and
everything else to the SvelteKit frontend, so a single `D6E_BASE_URL`
covers both surfaces.

**Auth:** `Authorization: Bearer <access_token>` + `X-Workspace-ID: <UUID>`.
The access token is obtained by `src/lib/server/d6e-token.ts` from
d6e-auth — see section 4 below.

**Request body (JSON):**

```json
{
	"filename": "receipt.jpg",
	"content_type": "image/jpeg",
	"content": "<base64 of the file bytes>"
}
```

**Response (JSON):**

```json
{
	"id": "019bbac4-68a4-71d3-8928-8b32cabec841",
	"filename": "receipt.jpg"
}
```

The `id` field is the Storage UUID that must be passed to
`execute-by-intent` as `inputFileRefs[].fileId`.

**This app's wrapper:**
[`src/routes/api/upload/+server.ts`](../src/routes/api/upload/+server.ts)
turns a browser-sent `multipart/form-data` into the JSON above via
[`uploadFile()`](../src/lib/server/d6e-client.ts).

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

## 4. Token refresh — `/api/v1/auth/token`

**Hosted by:** the d6e frontend, exposed under
`${D6E_BASE_URL}/api/v1/auth/token` (e.g.
`https://b-button.d6e.ai/api/v1/auth/token`). The same `b-button`
instance both issues and validates access tokens, which guarantees the
`aud` claim always matches.

**Request body (JSON):**

```json
{
	"grant_type": "refresh_token",
	"refresh_token": "<value of the auth-refresh cookie>"
}
```

No `client_id` / `client_secret` is required — the b-button instance
already knows which OAuth client backs it.

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

- The response always rotates `refresh_token`. The example app keeps the
  refresh token in `.env` (`D6E_REFRESH_TOKEN`) and does **not**
  persist rotated values — this is acceptable because the original
  refresh token stays valid until its 30-day expiry. For longer-lived
  deployments, persist the new refresh token after each refresh.
- 4xx responses indicate the refresh token is genuinely rejected
  (revoked, malformed, or signed with a key d6e-auth no longer knows
  about). The operator must copy a fresh `auth-refresh` cookie value
  into `.env` and restart the server.
- 5xx responses are transient and should be retried after backoff.

**This app's wrapper:**
[`src/lib/server/d6e-token.ts`](../src/lib/server/d6e-token.ts).

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

## 6. External SaaS API access — `d6e_call_external_api` (MCP tool)

**Hosted by:** the d6e MCP server, exposed indirectly via the SaaS proxy
in the d6e Rust API. This sample app **does not call the proxy
directly**; instead, the LLM running inside `execute-by-intent` invokes
the MCP tool when the workspace prompt asks it to.

**Tool signature (relevant fields):**

```ts
d6e_call_external_api({
	provider: 'freee' | 'google_workspace' | ...,
	method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
	path: '/api/1/deals',
	body?: { ... },
	file_id?: '<d6e storage UUID>'  // upload binary as request body
});
```

When `file_id` is set, the d6e Rust API resolves the storage file and
streams its bytes as the request body (raw binary for `uploadType=media`,
multipart/related metadata + binary for `uploadType=multipart`). This is
how the Drive upload step works without re-fetching the receipt image
through the LLM.

OAuth tokens for `freee` and `google_workspace` are stored encrypted in
d6e's `saas_credential` table per workspace. The proxy refreshes them
when needed (with `SELECT FOR UPDATE` to avoid race conditions). The
LLM never sees the tokens themselves; it only sees response bodies.

**Why this app does not call the proxy directly:**

The integration is entirely prompt-driven. The "freee に登録" button
on the AI Journal page sends a fixed natural-language message wrapped in
`<registration_request>...</registration_request>` to `/api/intent`; the
Scenario D prompt (`scripts/prompts/freee-registration-prompt.md`)
instructs the LLM to call `d6e_call_external_api` against `freee` and
`google_workspace`. Keeping the orchestration inside the prompt means
the same backend works for the Slack / Discord / LINE proxies without
any code changes here.

**Upstream references:**

- MCP tool descriptor: [d6e `packages/mcp/src/server/mod.rs`](https://github.com/d6e-ai/d6e/blob/main/packages/mcp/src/server/mod.rs)
- Proxy implementation: [d6e `packages/api/src/routes/v1/saas_proxy.rs`](https://github.com/d6e-ai/d6e/blob/main/packages/api/src/routes/v1/saas_proxy.rs)
- Provider catalog: [d6e `packages/frontend/src/lib/saas-providers/catalog.ts`](https://github.com/d6e-ai/d6e/blob/main/packages/frontend/src/lib/saas-providers/catalog.ts)

## Auth model summary

| Endpoint                                | Header / Body                          | Source variable                          |
| --------------------------------------- | -------------------------------------- | ---------------------------------------- |
| `POST /api/v1/workspaces/{id}/files`    | `Authorization: Bearer <access_token>` | `getAccessToken()` (cached)              |
| `POST /api/workflows/execute-by-intent` | `Authorization: Bearer <access_token>` | `getAccessToken()` (cached)              |
| `POST /api/workspace-prompt-rules`      | `Cookie: auth-token=<access_token>`    | `getAccessToken()` at startup of init    |
| `/api/chat-sessions[*]`                 | `Cookie: auth-token=<access_token>`    | `getAccessToken()` (cached)              |
| `POST /api/v1/auth/token`               | JSON `refresh_token` only              | `D6E_REFRESH_TOKEN`                      |

Bearer headers and `auth-token` cookies carry the same JWT — only the
transport differs. The app obtains that JWT exactly once per ~1 hour by
exchanging the long-lived refresh token, so operators never have to
paste short-lived tokens into `.env`.
