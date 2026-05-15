# d6e API integration

This document captures the exact request/response shapes used by this
app. They are derived from the d6e source as of the time this example was
written; if d6e changes its API, the relevant files here must be updated.

## 1. File upload — `/api/v1/workspaces/{workspaceId}/files`

**Hosted by:** d6e Rust API server (`D6E_API_URL`).

**Auth:** `Authorization: Bearer <JWT>` + `X-Workspace-ID: <UUID>`.

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

**Auth:** `Authorization: Bearer <JWT>` (no cookie required).

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

**Auth:** `Cookie: auth-token=<JWT>` (admin-on-workspace required).
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

## Auth model summary

| Endpoint                                            | Header                  | Source variable   |
| --------------------------------------------------- | ----------------------- | ----------------- |
| `POST /api/v1/workspaces/{id}/files/multipart`      | `Authorization: Bearer` | `D6E_JWT`         |
| `DELETE /api/v1/workspaces/{id}/files/{fileId}`     | `Authorization: Bearer` | `D6E_JWT`         |
| `GET /api/v1/workspaces/{id}`                       | `Authorization: Bearer` | `D6E_JWT`         |
| `POST /api/workflows/execute-by-intent`             | `Authorization: Bearer` | `D6E_JWT`         |
| `POST /api/workspace-prompt-rules`                  | `Cookie: auth-token`    | `D6E_AUTH_COOKIE` |

The Bearer token and the cookie value are typically the same JWT, just
transported on different headers. Make sure both are issued for an
account that has admin role on the target workspace.

### Same-origin tip for managed deployments

On managed d6e deployments (e.g. `https://b-button.d6e.ai`) the Rust API
and the SvelteKit frontend are reachable on the **same host** under the
`/api/v1/...` and `/api/...` prefixes respectively. In that case
`D6E_API_URL` can be left empty and the app will reuse `D6E_FRONTEND_URL`
automatically.
