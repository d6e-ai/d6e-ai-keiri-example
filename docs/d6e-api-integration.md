# d6e API integration

This document captures the exact request/response shapes used by this
app. They are derived from the d6e source as of the time this example was
written; if d6e changes its API, the relevant files here must be updated.

## 1. File upload — `/api/v1/workspaces/{workspaceId}/files`

**Hosted by:** d6e Rust API server, exposed under `D6E_API_URL`. In a
managed d6e deployment the same origin proxies `/api/v1/*` to the Rust
API, so `D6E_API_URL` and `D6E_FRONTEND_URL` usually point at the same
host (e.g. `https://b-button.d6e.ai`).

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

**Hosted by:** d6e SvelteKit frontend (`D6E_FRONTEND_URL`).

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

**Hosted by:** d6e SvelteKit frontend (`D6E_FRONTEND_URL`).

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

**Hosted by:** d6e-auth (`D6E_AUTH_URL`, e.g. `https://www.d6e.ai`).

**Request body (JSON):**

```json
{
	"grant_type": "refresh_token",
	"refresh_token": "<value of the auth-refresh cookie>",
	"client_id": "<D6E_AUTH_CLIENT_ID>",
	"client_secret": "<D6E_AUTH_CLIENT_SECRET>"
}
```

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
  persist rotated values — this is acceptable because d6e-auth does not
  invalidate the original refresh token until it expires (30 days).
  For longer-lived deployments, persist the new refresh token after
  each refresh.
- 4xx responses indicate the refresh token is genuinely rejected
  (revoked, malformed, or signed with a key d6e-auth no longer knows
  about). The operator must copy a fresh `auth-refresh` cookie value
  into `.env` and restart the server.
- 5xx responses are transient and should be retried after backoff.

**This app's wrapper:**
[`src/lib/server/d6e-token.ts`](../src/lib/server/d6e-token.ts).

**Upstream reference:**
[d6e-auth `src/routes/api/v1/auth/token/+server.ts`](https://github.com/d6e-ai/d6e-auth/blob/main/src/routes/api/v1/auth/token/%2Bserver.ts).

## Auth model summary

| Endpoint                                | Header / Body                            | Source variable                                                         |
| --------------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------- |
| `POST /api/v1/workspaces/{id}/files`    | `Authorization: Bearer <access_token>`   | `getAccessToken()` (cached)                                             |
| `POST /api/workflows/execute-by-intent` | `Authorization: Bearer <access_token>`   | `getAccessToken()` (cached)                                             |
| `POST /api/workspace-prompt-rules`      | `Cookie: auth-token=<access_token>`      | `getAccessToken()` at startup of `npm run init`                         |
| `POST /api/v1/auth/token`               | JSON `client_id` / `client_secret` / `refresh_token` | `D6E_AUTH_CLIENT_ID`, `D6E_AUTH_CLIENT_SECRET`, `D6E_REFRESH_TOKEN`     |

Bearer headers and `auth-token` cookies carry the same JWT — only the
transport differs. The app obtains that JWT exactly once per ~1 hour by
exchanging the long-lived refresh token, so operators never have to
paste short-lived tokens into `.env`.
