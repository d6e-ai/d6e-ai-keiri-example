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
object (this app sends `{"source":"d6e-custom-frontend-skills"}`).

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
[d6e `packages/frontend/src/routes/api/workspaces/[workspaceId]/files/upload/+server.ts`](https://gitlab.com/cauchye/d6e-ai/d6e/-/blob/main/packages/frontend/src/routes/api/workspaces/%5BworkspaceId%5D/files/upload/+server.ts)
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
[d6e `packages/frontend/src/routes/api/workflows/execute-by-intent/+server.ts`](https://gitlab.com/cauchye/d6e-ai/d6e/-/blob/main/packages/frontend/src/routes/api/workflows/execute-by-intent/+server.ts).

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
[d6e `packages/frontend/src/routes/api/workspace-prompt-rules/+server.ts`](https://gitlab.com/cauchye/d6e-ai/d6e/-/blob/main/packages/frontend/src/routes/api/workspace-prompt-rules/+server.ts).

## 4. End-user OAuth2 — instance-brokered token exchange

**Hosted by:** d6e-auth (e.g. `https://www.d6e.ai`) hosts the interactive
login page; the per-app d6e instance (`${D6E_BASE_URL}`) hosts the token
endpoint this app talks to. The authorization code is exchanged at the
**d6e instance**, which relays it to d6e-auth using the instance's own
OAuth client credentials and returns a token pair already signed for the
audience the instance's own Bearer endpoints accept. Because the instance
brokers the exchange, this frontend never holds a `client_secret`, and the
access_token is usable as a Bearer credential against `${D6E_BASE_URL}`
immediately — no separate re-mint step.

> The audience matters: the d6e instance verifies the `aud` claim of every
> Bearer token against its own configured OAuth client id, rejecting a
> token minted for a different client with 401. Exchanging the code at the
> instance guarantees the right `aud` from the very first call.

This app implements the OAuth2 **Authorization Code** flow per end
user. The flow lives in these SvelteKit routes:

| Step                                | Endpoint                           |
| ----------------------------------- | ---------------------------------- |
| Start (state cookie + 302 to auth)  | `GET /auth/login`                  |
| Callback (state verify + exchange)  | `GET /auth/callback`               |
| Logout (local + upstream)           | `GET /auth/logout` (or POST form)  |
| Membership reject                   | `GET /auth/no-access`              |

### Code exchange — d6e instance (`${D6E_BASE_URL}/api/v1/auth/token`)

**Request body (JSON):**

```json
{
	"grant_type": "authorization_code",
	"code": "<value from /auth/callback>",
	"redirect_uri": "<D6E_AUTH_REDIRECT_URI>"
}
```

No `client_id` / `client_secret` is sent by this app: the d6e instance
injects its own when it forwards the grant to d6e-auth. The `redirect_uri`
must be present (d6e-auth requires it for the authorization_code grant)
and allow-listed on the instance — both in the instance's
`registered_client.redirectUris` on d6e-auth (self-service for franchise
owners/admins in the d6e-auth franchise portal — see
[`workspace-setup.md`](./workspace-setup.md)) and in the instance's
`ALLOWED_REDIRECT_URIS` env var.

The d6e instance returns a token pair signed for its own audience, and
**this pair is written straight to the user's cookies**. All subsequent
refreshes (triggered by `loadSession()` when the access token is within
60 seconds of expiry) hit the same endpoint with
`grant_type=refresh_token`, so once the user is logged in we never call
d6e-auth's token endpoint directly.

**Response shape (exchange + refresh):**

```json
{
	"access_token": "eyJhbGciOi...",
	"refresh_token": "eyJhbGciOi...",
	"token_type": "Bearer",
	"expires_in": 3600
}
```

Notes:

- The endpoint rotates `refresh_token` on every call. The app stores the
  rotated value in the user's `auth-refresh` cookie (HTTP-only,
  SameSite=Lax, 30-day cap), so the next refresh round-trip always uses
  the freshest token.
- 4xx responses cause the user to be bounced back to `/auth/login` so
  they can try again with a fresh authorization code.
- 5xx responses are transient and surface as a 502 client error.

**This app's wrappers:**
[`src/lib/server/oauth.ts`](../src/lib/server/oauth.ts)
(`exchangeAuthorizationCode()` for the code exchange,
`refreshAccessTokenViaBaseUrl()` for refresh — both target the d6e
instance), [`src/lib/server/session.ts`](../src/lib/server/session.ts)
(cookie store and exp-based refresh), and
[`src/hooks.server.ts`](../src/hooks.server.ts) (per-request session
loading + unauthenticated redirect).

> **Alternative — standalone client.** A frontend that cannot change the
> d6e instance's redirect-uri allow-list can register its own
> `registered_client` on d6e-auth (own `client_id` / `client_secret`),
> exchange the code at `${D6E_AUTH_URL}/api/v1/auth/token`, then re-mint
> the refresh token at `${D6E_BASE_URL}/api/v1/auth/token` to obtain an
> instance-audience pair. See
> [`skills/d6e-auth-integration/SKILL.md`](../skills/d6e-auth-integration/SKILL.md).

### Logout — local cookies + d6e-auth session

`/auth/logout` does **two** things in a single hop:

1. Deletes the four local cookies (`auth-access`, `auth-refresh`,
   `auth-user`, `auth-oauth-state`).
2. 303-redirects the browser to
   `${D6E_AUTH_URL}/auth/logout?redirect_uri=${origin}/auth/login`,
   which deletes d6e-auth's own session row + cookie before sending
   the user back to this app's `/auth/login`.

The upstream hop is required because d6e-auth holds its own session
cookie on `${D6E_AUTH_URL}`. Without step 2, hitting `/auth/login`
immediately after a logout would just call back to
`${D6E_AUTH_URL}/auth/login` with the still-live session, d6e-auth
would silently issue a fresh `code`, this app would run the code
exchange again, and the user would end up logged in within ~200 ms
of clicking "logout".

`d6e-auth`'s logout endpoint reference:
[d6e-auth `src/routes/auth/logout/+server.ts`](https://gitlab.com/cauchye/d6e-ai/d6e-auth/-/blob/main/src/routes/auth/logout/+server.ts).

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
d6e instance) because the prompt-rule POST requires a
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
Scenario D content (appended into the same workspace prompt rule via
`scripts/prompts/freee-registration-prompt.md` — see
[docs/llm-output-contract.md](./llm-output-contract.md) for the
activation flow) instructs the LLM to call `d6e_call_external_api`
against `freee` and `google_workspace`. Keeping the orchestration inside
the prompt means the same backend works for the Slack / Discord / LINE
proxies without any code changes here.

**Activating Scenario D:**

Scenario D is appended to the existing workspace prompt rule by the d6e
AI itself. When the user pastes
[`scripts/prompts/freee-registration-prompt.md`](../scripts/prompts/freee-registration-prompt.md)
into the d6e chat UI, the receiving model uses these MCP tools to
perform a short interactive discovery before the actual rule update:

- `d6e_list_workspace_prompt_rules` — locate the rule that currently
  carries Scenarios A/B/C.
- `d6e_list_saas_credentials` — confirm both `freee` and
  `google_workspace` are still connected.
- `d6e_call_external_api` — call `GET /api/1/companies` (freee) and
  `GET /drive/v3/files?q=...folder...` (Google Drive root) so the
  model can ask the user **which company** and **which Drive folder**
  to bake into Scenario D. The chosen IDs are substituted into the
  template's `{{company_id}}` / `{{drive_folder_id}}` placeholders
  before the rule is written.
- `d6e_update_workspace_prompt_rule` — insert the now-concrete
  Scenario D body into the rule **immediately before the
  `## 共通ルール` heading** (i.e. directly after Scenario C). This
  keeps A/B/C/D as a contiguous block of task scenarios; the shared
  rules below apply to all four. Scenarios A/B/C themselves are left
  byte-identical.

Because the company and folder selections are resolved **at activation
time** (not at every "freee に登録" click), the runtime LLM no longer
needs to hit `GET /api/1/companies` or to ask the user where to upload
the receipt — the values are already in the prompt. At runtime the LLM
still uses `d6e_call_external_api` to:

- list accounting items (`GET /api/1/account_items`) and tax codes
  (`GET /api/1/taxes/codes`) for the bound company,
- create a deal per entry (`POST /api/1/deals`),
- ensure the `YYYY/MM/` Drive sub-folder under the bound parent folder
  exists (using `GET /drive/v3/files` and `POST /drive/v3/files`,
  creating year/month folders on demand), then
- upload the receipt
  (`POST /upload/drive/v3/files?uploadType=multipart` with `file_id`).

This avoids a separate REST round-trip from this app and keeps the
sample's `npm run init` script unchanged (it still registers only the
base `ai-keiri-prompt.md`). To rebind the company or folder later, the
user removes the `### シナリオ D` section from the d6e admin UI and
pastes the activation file again.

**Upstream references:**

- MCP tool descriptor: [d6e `packages/mcp/src/server/mod.rs`](https://gitlab.com/cauchye/d6e-ai/d6e/-/blob/main/packages/mcp/src/server/mod.rs)
- Proxy implementation: [d6e `packages/api/src/routes/v1/saas_proxy.rs`](https://gitlab.com/cauchye/d6e-ai/d6e/-/blob/main/packages/api/src/routes/v1/saas_proxy.rs)
- Provider catalog: [d6e `packages/frontend/src/lib/saas-providers/catalog.ts`](https://gitlab.com/cauchye/d6e-ai/d6e/-/blob/main/packages/frontend/src/lib/saas-providers/catalog.ts)

## Auth model summary

| Endpoint                                              | Header / Body                          | Source                                                                  |
| ----------------------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------- |
| `POST /api/v1/workspaces/{id}/files/multipart`        | `Authorization: Bearer <access_token>` | `event.locals.accessToken` (auth-access cookie via hooks.server.ts)     |
| `DELETE /api/v1/workspaces/{id}/files/{fileId}`       | `Authorization: Bearer <access_token>` | same as above                                                           |
| `GET /api/v1/workspaces/{id}`                         | `Authorization: Bearer <access_token>` | same as above (only called from `/auth/callback`)                       |
| `POST /api/workflows/execute-by-intent`               | `Authorization: Bearer <access_token>` | same as above                                                           |
| `/api/chat-sessions[*]`                               | `Cookie: auth-token=<access_token>`    | same as above (re-emitted as a server-to-server cookie)                 |
| `POST ${D6E_BASE_URL}/api/v1/auth/token` (user, code exchange) | JSON `code` + `redirect_uri`  | OAuth2 authorization code from `/auth/callback`; instance brokers it to d6e-auth |
| `POST ${D6E_BASE_URL}/api/v1/auth/token` (user, refresh) | JSON `refresh_token`               | rotated `auth-refresh` cookie value                                     |
| `POST ${D6E_BASE_URL}/api/v1/auth/token` (init)       | JSON `refresh_token`                   | `D6E_INIT_REFRESH_TOKEN` (admin-only, never used by the user flow)      |
| `POST /api/workspace-prompt-rules`                    | `Cookie: auth-token=<access_token>`    | access token issued by the init refresh above                           |

Bearer headers and `auth-token` cookies carry the same JWT — only the
transport differs. The app never persists the JWT server-side; every
request reads the user's cookie via `hooks.server.ts`, which
transparently refreshes it via `${D6E_BASE_URL}/api/v1/auth/token` when
the JWT's `exp` is within 60 seconds. Refreshing against the d6e
instance (not d6e-auth) is intentional — only d6e-instance-issued
access tokens are accepted by the d6e instance API.
