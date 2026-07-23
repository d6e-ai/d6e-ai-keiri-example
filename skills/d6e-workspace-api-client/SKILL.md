---
name: d6e-workspace-api-client
description: Builds the server-side proxy layer that lets a custom frontend talk to a d6e workspace — file upload/list/download/delete, workspace SQL execute/preview, named workflow CRUD/execute, workspace member admin, Markdown documents, column/file/table embeddings, pinned dashboard charts, execute-by-intent (sync and async job API), chat-session CRUD, workspace prompt rule registration, workspace membership probes, SaaS API calls via the d6e saas-proxy (+ binary download), Google Drive sync mirror endpoints, and workspace pending-invitation admin CRUD. Use when adding a new `/api/*` route that talks to d6e, when building a data browser or admin members page, when wiring expense-check-style workflow lookup+execute, when surfacing SQL policy errors to the UI, when designing a fetch wrapper that needs to surface timeouts/aborts cleanly, when seeing 401 on `/api/chat-sessions` or 402 from `execute-by-intent`, when the synchronous execute-by-intent times out and you need the async job API, when building a progress display with tool-trace polling, when adding a cancel button for long-running AI jobs, when calling freee/Google/Notion APIs with workspace-stored credentials, when writing a bootstrap script that registers workspace prompt rules idempotently, when wiring a Drive Sync UI (config / roots / sync / materialize / picker), or when building an admin members page that needs to list and cancel pending email invitations.
---

# d6e Workspace API Client

## Overview

This skill teaches the server-side glue that sits between a custom
frontend and a d6e workspace. It covers:

- The strict rule that the browser never talks to d6e directly — every
  request must traverse a same-origin `/api/*` proxy under the app's
  control.
- The fetch wrapper conventions used by `src/lib/server/d6e-client.ts`
  (explicit `caller` tag, explicit `accessToken`, normalized
  `D6eClientError`, combined `AbortSignal` for timeout + caller
  cancellation).
- The Bearer vs Cookie authentication split — d6e's Rust API accepts
  `Authorization: Bearer <jwt>` while the SvelteKit-hosted endpoints
  (`/api/chat-sessions`, `/api/workspace-prompt-rules`) require
  `Cookie: auth-token=<jwt>`. Mixing them up surfaces as empty 401/403
  bodies that are easy to miss.
- The SHA-256-keyed idempotency pattern that `scripts/init-workspace.mjs`
  uses so `npm run init` can be re-run safely.
- The **SaaS proxy** (`POST /api/v1/saas-proxy`) that lets server code
  call freee / Google Workspace / Notion / GitHub / Salesforce / Box /
  MoneyForward / Chatwork / Zendesk APIs with the workspace's stored
  credential — after a workspace admin connects the provider in the
  d6e console's settings page (there is no API for that step).
- The **async intent job API** (`/api/workflows/execute-by-intent/jobs`)
  that removes the ~13-minute synchronous ceiling. The caller posts a
  job (returns immediately with a `jobId`), then polls for status, tool
  trace, and result independently of the HTTP connection lifetime. The
  d6e instance runs the agent loop in the background (long-lived
  adapter-node process) with a configurable wall-clock cap (default 30
  minutes). This is the recommended path for Vercel-hosted frontends
  where the sync endpoint exceeds `maxDuration`.
- The **workspace SQL API** under `/api/v1/workspaces/{id}/sql` —
  Bearer execute + preview endpoints that auto-prefix logical table
  names into `user_data.ws_{uuid}_{name}`, enforce row-level policies,
  and return structured `{ error, code }` bodies (`POLICY_DENIED`,
  `DDL_FORBIDDEN`, `PARSE_ERROR`, …).
- **File storage beyond upload/delete** — list metadata, fetch
  metadata by id, and stream binary downloads (1 GB upstream cap; pin
  `X-Workspace-ID` even though the path carries `{id}`).
- **Named workflow CRUD + execute** under `/api/v1/workflows` —
  header-scoped (`X-Workspace-ID` required); the expense-check pattern
  lists by name then POSTs the input JSON to `/{id}/execute` and
  receives the last step's output JSON.
- **Workspace member admin** — list/add/patch/remove under
  `/workspaces/{id}/members` (mutations admin-only; `LAST_ADMIN` guard
  on demote/remove).
- **Markdown documents**, **embeddings** (column / file / table-row),
  and **pinned dashboard charts** — see
  [Workspace data, workflows, and admin APIs](#workspace-data-workflows-and-admin-apis).
- Optional integrations newer d6e instances expose:
  - **Google Drive Sync Mirror** under `/api/v1/drive-sync/*` — Bearer
    endpoints whose `workspace_id` is supplied in the body or query
    string (not in the URL path). Backs a `drive_files` SQL projection
    that LLMs can query via `d6e_sql` and on-demand `materialize` /
    `read` actions that cache Drive bytes into `storage_file`.
  - **Workspace Pending Invitations** under
    `/api/v1/workspaces/{id}/invitations` — admin-only Bearer CRUD that
    lets a custom admin UI list and cancel email invitations made to
    users who have not yet signed in to the d6e instance.

## When to Use

Apply this skill when the user says:

- "Add a new endpoint that talks to d6e"
- "How do I upload files to a d6e workspace from my app?"
- "Run SQL from my custom frontend's server proxy" / "ワークスペース SQL をサーバ側から実行したい"
- "Preview SQL before mutating data" / "UPDATE 前に SQL をプレビューしたい"
- "List or download files already uploaded to the workspace"
- "Call a named d6e workflow directly (expense-check pattern)" / "ワークフローを名前で探して execute したい"
- "Build an admin members page (list, invite, change role, remove)" / "メンバー管理 UI を作りたい"
- "CRUD Markdown docs from my app" / "ドキュメント API をフロントから使いたい"
- "Generate embeddings or run similarity search on a table column"
- "Why does `POST /api/v1/workflows/.../execute` return 400 Missing X-Workspace-ID?"
- "Why does `/api/chat-sessions` give me 401 when Bearer works elsewhere?"
- "Wrap the d6e API with timeouts and abort handling"
- "Make `npm run init` idempotent"
- "Proxy `execute-by-intent` from my SvelteKit/Next.js backend"
- "サーバ側で d6e API を叩く層を作りたい"
- "Where do I plumb the workspace ID through?"
- "Add a Google Drive sync UI to my custom frontend"
- "Trigger a Drive sync from my app" / "Drive 同期ボタンを実装したい"
- "List and cancel pending workspace invitations" / "保留招待を管理 UI から扱いたい"
- "Why does `/api/v1/drive-sync/sync` accept the workspace id in the body but not in the URL?"
- "Call the freee / Google Drive API with the workspace's stored credential" / "SaaS 連携の API をサーバ側から叩きたい"
- "Why does execute-by-intent return 402?"
- "execute-by-intent keeps timing out on Vercel" / "780s タイムアウトを回避したい"
- "How do I use the async job API?" / "非同期ジョブ API を使いたい"
- "Add a cancel button for running jobs" / "実行中のジョブをキャンセルしたい"
- "Show progress (tool trace) while a job is running"

## Core Concepts

### Browser never calls d6e directly

The frontend posts to **this app's** `/api/upload`, `/api/intent`,
`/api/chat-sessions`. Each of these routes:

1. Reads the access token from `event.locals.accessToken` (populated by
   `hooks.server.ts`; see the
   [`d6e-auth-integration`](../d6e-auth-integration/SKILL.md) skill).
2. Injects `D6E_WORKSPACE_ID` from the environment so the browser
   cannot leak across workspaces.
3. Forwards to the appropriate d6e endpoint via a helper in
   `src/lib/server/d6e-client.ts`.
4. Relays the upstream status code and a normalized error body back
   to the browser.

This guarantees the Bearer/auth-token JWT lives only in HTTP-only
cookies and never reaches client-side JavaScript.

### Authentication header matrix

| Endpoint                                                           | Auth                                                     | Notes                                                                                                                                               |
| ------------------------------------------------------------------ | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST ${D6E_BASE_URL}/api/v1/workspaces/{wsId}/files/multipart`    | `Authorization: Bearer <jwt>` + `X-Workspace-ID: <wsId>` | `multipart/form-data` body with `file` + `metadata` fields                                                                                          |
| `DELETE ${D6E_BASE_URL}/api/v1/workspaces/{wsId}/files/{fileId}`   | `Authorization: Bearer <jwt>` + `X-Workspace-ID: <wsId>` | 404 is treated as success (already gone)                                                                                                            |
| `GET ${D6E_BASE_URL}/api/v1/workspaces/{wsId}/files`               | `Authorization: Bearer <jwt>` + `X-Workspace-ID: <wsId>` | List metadata only. Handler resolves workspace from **header**, not path.                                                                           |
| `GET ${D6E_BASE_URL}/api/v1/workspaces/{wsId}/files/{fileId}`      | `Authorization: Bearer <jwt>` + `X-Workspace-ID: <wsId>` | Metadata by id.                                                                                                                                     |
| `GET ${D6E_BASE_URL}/api/v1/workspaces/{wsId}/files/{fileId}/download` | `Authorization: Bearer <jwt>` + `X-Workspace-ID: <wsId>` | Binary stream. Upstream cap 1 GB. Proxy — never expose the upstream URL.                                                                        |
| `POST ${D6E_BASE_URL}/api/v1/workspaces/{wsId}/sql`                | `Authorization: Bearer <jwt>`                            | Workspace from **path**; membership checked. `X-Workspace-ID` optional (must match if sent).                                                        |
| `POST ${D6E_BASE_URL}/api/v1/workspaces/{wsId}/sql/preview`        | `Authorization: Bearer <jwt>`                            | Same as execute — preview does not evaluate runtime policy conditions.                                                                              |
| `* ${D6E_BASE_URL}/api/v1/workflows[/{id}[/execute]]`              | `Authorization: Bearer <jwt>` + `X-Workspace-ID: <wsId>` | **Required** — workspace is not in the URL. Missing header → 400.                                                                                   |
| `GET ${D6E_BASE_URL}/api/v1/workspaces/{wsId}/members`             | `Authorization: Bearer <jwt>`                            | Any workspace member.                                                                                                                               |
| `POST/PATCH/DELETE …/workspaces/{wsId}/members[/{memberId}]`       | `Authorization: Bearer <jwt>` (workspace **admin**)      | `POST` may return `{ membership }` or `{ invitation }`. `DELETE`/`PATCH` demotion guarded by `LAST_ADMIN`.                                          |
| `GET ${D6E_BASE_URL}/api/v1/workspaces/{wsId}`                     | `Authorization: Bearer <jwt>`                            | Workspace membership probe (returns 200/403/404)                                                                                                    |
| `* ${D6E_BASE_URL}/api/v1/workspaces/{wsId}/invitations[/{id}]`    | `Authorization: Bearer <jwt>` (admin role required)      | GET list / DELETE single. See [Workspace invitation admin endpoints](#workspace-invitation-admin-endpoints).                                        |
| `POST ${D6E_BASE_URL}/api/workflows/execute-by-intent`             | `Authorization: Bearer <jwt>`                            | Body contains `workspaceId` — set server-side                                                                                                       |
| `* ${D6E_BASE_URL}/api/workflows/execute-by-intent/jobs[/{id}[/cancel]]` | `Authorization: Bearer <jwt>`                    | Async job API — create / poll / cancel. Body contains `workspaceId` on POST (create). See [Async intent job API](#async-intent-job-api).             |
| `POST ${D6E_BASE_URL}/api/v1/auth/token`                           | none (refresh token in body)                             | Stage 2 / refresh — see auth skill                                                                                                                  |
| `* ${D6E_BASE_URL}/api/v1/drive-sync/{config,roots,sync,status,…}` | `Authorization: Bearer <jwt>`                            | `workspace_id` is supplied in the **body or query string**, never in the URL path. See [Drive Sync mirror endpoints](#drive-sync-mirror-endpoints). |
| `POST ${D6E_BASE_URL}/api/v1/saas-proxy`                           | `Authorization: Bearer <jwt>`                            | Proxied SaaS API call using the workspace's stored credential. See [SaaS API calls](#saas-api-calls-through-the-d6e-proxy).                          |
| `POST ${D6E_BASE_URL}/api/v1/saas-proxy-download`                  | `Authorization: Bearer <jwt>`                            | Binary sibling of saas-proxy; streams into `storage_file` (100 MB cap).                                                                             |
| `* ${D6E_BASE_URL}/api/chat-sessions[/...]`                        | `Cookie: auth-token=<jwt>`                               | Bearer is rejected; the SvelteKit handler reads `locals.user`                                                                                       |
| `POST ${D6E_BASE_URL}/api/workspace-prompt-rules`                  | `Cookie: auth-token=<jwt>`                               | Requires admin role on the workspace. `GET` (list) is also admin-only                                                                               |
| `GET ${D6E_BASE_URL}/api/workspace-prompt-rules?workspaceId=…`     | `Cookie: auth-token=<jwt>`                               | Used for idempotent rule registration                                                                                                               |

The Bearer JWT and the `auth-token` cookie value are the **same**
string — only the transport differs. Drive Sync and invitation routes
both share the Bearer transport but enforce different authorisation
gates (workspace-member for Drive Sync, workspace-admin for
invitations).

For local development and smoke tests (curl, scripts, or a local AI
coding agent calling `${D6E_BASE_URL}` directly), a long-lived **API
key** (`d6e_...`, created in the d6e console: avatar in the header →
API Keys) works everywhere the table says `Authorization: Bearer <jwt>`
— it carries the same user identity without the ~1 h JWT expiry. The
cookie-transport routes (`/api/chat-sessions`,
`/api/workspace-prompt-rules`) still need the real session cookie. See
[local-ai-development.md](https://github.com/d6e-ai/d6e-plugin-skills/blob/main/docs/local-ai-development.md)
for the full local-development workflow.

### Fetch wrapper conventions

Every helper in [`src/lib/server/d6e-client.ts`](../../src/lib/server/d6e-client.ts)
follows the same shape:

```ts
export async function uploadFile(
  caller: string, // for logs: '/api/upload', 'init-workspace', etc.
  accessToken: string, // never read from globals/cookies inside
  payload: {
    /* args */
  }
): Promise<UploadFileResult>;
```

Conventions:

- `caller` is always the **first** argument so log lines uniformly
  start with `[d6e-client] uploadFile failed (caller=/api/upload): …`.
  This makes one-line greps map back to a specific route.
- `accessToken` is **explicit** — the wrapper never reaches into
  cookies. Route handlers pull the token through
  `requireAccessToken(event, caller)` (which throws 401 with type
  narrowing) and pass it down.
- All errors collapse to `D6eClientError(message, status, upstreamBody, {timedOut, aborted})`
  so callers can switch on `status` and decide what to return to the
  browser.
- Logs use the `[d6e-client]` prefix to make grep-by-module cheap.
- All outbound requests carry an `AbortSignal.timeout(...)` so a
  hung upstream cannot block the function instance indefinitely.

### Combined `AbortSignal` for timeout + caller cancellation

```ts
function buildCombinedSignal(
  timeoutMs: number,
  externalSignal: AbortSignal | undefined
): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  if (!externalSignal) return timeoutSignal;
  return AbortSignal.any([externalSignal, timeoutSignal]);
}
```

`executeByIntent` and `uploadFile` accept an optional `signal` from
the caller (typically `event.request.signal`). When the browser closes
the tab, the resulting `AbortError` lands in the catch arm that maps
it to `D6eClientError(status=499 'Client Closed Request', aborted=true)`.
The timeout side maps to `status=504, timedOut=true`. Keeping these
two flags separate lets the UI distinguish "I gave up" from "you
gave up".

### Workspace ID is server-pinned

The browser never sends a `workspaceId` field. Every helper reads
`D6E_WORKSPACE_ID` from `src/lib/server/env.ts` via `getD6eWorkspaceId(caller)`
and injects it. This is an explicit security choice: a malicious browser
should not be able to read another workspace's data even if the user
holds an access token that would technically grant it.

### Idempotent prompt rule registration

`scripts/init-workspace.mjs` registers the workspace prompt rule from
`scripts/prompts/ai-keiri-prompt.md`. To stay safe under repeated
runs:

1. Refresh the access token via `${D6E_BASE_URL}/api/v1/auth/token`
   using `D6E_INIT_REFRESH_TOKEN` (admin-scoped; distinct from the
   end-user cookie).
2. `GET /api/workspace-prompt-rules?workspaceId=…` to list all
   existing rules.
3. Compute SHA-256 of the trimmed local prompt and of each existing
   rule's content; on a match, log and exit 0 without POSTing.
4. Otherwise POST `{ workspaceId, content }` to
   `/api/workspace-prompt-rules` (Cookie auth).

This means CI can call `npm run init` on every deploy without
duplicating rules.

## Quick Start

A minimal `/api/upload` proxy plus its supporting wrapper.

### Step 1: env helper

```ts
// src/lib/server/env.ts (excerpt)
export function getD6eUrl(caller: string): string {
  return requireEnv(caller, 'D6E_BASE_URL').replace(/\/+$/, '');
}
export function getD6eWorkspaceId(caller: string): string {
  return requireEnv(caller, 'D6E_WORKSPACE_ID');
}
```

`requireEnv(caller, name)` throws a clear `Missing env var <name> (caller=<caller>)`
error so dev mistakes surface immediately.

### Step 2: wrap the upload endpoint

```ts
// src/lib/server/d6e-client.ts (excerpt)
export async function uploadFile(
  caller: string,
  accessToken: string,
  payload: { filename: string; contentType: string; content: Buffer; signal?: AbortSignal }
): Promise<UploadFileResult> {
  const apiUrl = getD6eUrl(caller);
  const workspaceId = getD6eWorkspaceId(caller);

  const formData = new FormData();
  const blob = new Blob([new Uint8Array(payload.content)], { type: payload.contentType });
  formData.append('file', blob, payload.filename);
  formData.append('metadata', JSON.stringify({ source: 'my-app' }));

  const url = `${apiUrl}/api/v1/workspaces/${workspaceId}/files/multipart`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'X-Workspace-ID': workspaceId
    },
    body: formData,
    signal: buildCombinedSignal(UPLOAD_TIMEOUT_MS, payload.signal)
  });
  // … check response.ok, throw D6eClientError, parse JSON …
}
```

Real file: [`src/lib/server/d6e-client.ts`](../../src/lib/server/d6e-client.ts).

### Step 3: write the SvelteKit route handler

```ts
// src/routes/api/upload/+server.ts (excerpt)
export const POST: RequestHandler = async (event) => {
  const accessToken = requireAccessToken(event, '/api/upload');
  const form = await event.request.formData();
  const file = form.get('file');
  if (!(file instanceof File)) {
    return json({ error: 'Missing "file" field' }, { status: 400 });
  }

  try {
    const uploaded = await uploadFile('/api/upload', accessToken, {
      filename: file.name,
      contentType: file.type,
      content: Buffer.from(await file.arrayBuffer()),
      signal: event.request.signal
    });
    return json({
      fileId: uploaded.id,
      filename: uploaded.filename,
      mimeType: uploaded.contentType,
      sizeBytes: uploaded.sizeBytes
    });
  } catch (err) {
    if (err instanceof D6eClientError) {
      return json({ error: err.message }, { status: err.status });
    }
    return json({ error: String(err) }, { status: 500 });
  }
};
```

Real file: [`src/routes/api/upload/+server.ts`](../../src/routes/api/upload/+server.ts).

The browser POSTs `multipart/form-data` to `/api/upload` and receives
`{ fileId, filename, mimeType, sizeBytes }`. That object is exactly
the shape `execute-by-intent` wants in `inputFileRefs[]`, so the
client can stash it and replay it on the next "Generate journal"
press.

## Reference

### `src/lib/server/d6e-client.ts` API

| Function                                                                   | Auth                      | What it does                                                                                                                                                                             |
| -------------------------------------------------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `uploadFile(caller, accessToken, payload)`                                 | Bearer + `X-Workspace-ID` | Uploads bytes to file storage. Returns `{ id, filename, contentType, sizeBytes }`.                                                                                                       |
| `deleteFile(caller, accessToken, fileId)`                                  | Bearer + `X-Workspace-ID` | Best-effort delete. 404 counts as success.                                                                                                                                               |
| `executeByIntent(caller, accessToken, body, options?)`                     | Bearer                    | Runs the natural-language workflow **synchronously**. Body is `{ message, inputFileRefs? }`; the wrapper injects `workspaceId`. Supports `timeoutMs` (default 270s, below Vercel's 300s cap) and `signal`. For long-running runs, prefer the async job API below. |
| `createAsyncIntentJob(caller, accessToken, body)`                          | Bearer                    | Creates an async job and returns `{ jobId }` immediately. Body is `{ message, inputFileRefs?, conversationContext? }`; the wrapper injects `workspaceId`. See [Async intent job API](#async-intent-job-api). |
| `getAsyncIntentJobStatus(caller, accessToken, jobId)`                      | Bearer                    | Polls the status of an async job. Returns the full `AsyncJobStatusResponse` (status, toolTrace, result, error). |
| `cancelAsyncIntentJob(caller, accessToken, jobId)`                         | Bearer                    | Requests cooperative cancellation. Returns `{ cancelled: boolean }`. |
| `verifyWorkspaceMembership(caller, accessToken)`                           | Bearer                    | 200 = `true`, 403/404 = `false`, other status throws `D6eClientError`.                                                                                                                   |
| `listChatSessions(caller, accessToken, workspaceId)`                       | Cookie                    | Returns `ChatSessionRow[]`.                                                                                                                                                              |
| `getChatSessionById(caller, accessToken, sessionId)`                       | Cookie                    | Fetch one row.                                                                                                                                                                           |
| `createChatSession(caller, accessToken, { workspaceId, title, messages })` | Cookie                    | Append a new row.                                                                                                                                                                        |
| `updateChatSession(caller, accessToken, sessionId, { title?, messages? })` | Cookie                    | Patch row.                                                                                                                                                                               |
| `deleteChatSession(caller, accessToken, sessionId)`                        | Cookie                    | Soft-delete.                                                                                                                                                                             |
| `fetchChatSessionsForCaller(caller, accessToken)`                          | Cookie                    | SSR-friendly wrapper that folds errors into `{ ok, rows, error? }` instead of throwing.                                                                                                  |

### `D6eClientError`

```ts
class D6eClientError extends Error {
  readonly status: number; // upstream HTTP status (or 502/504/499 for synthetic ones)
  readonly upstreamBody: string; // first ~500 chars of upstream body
  readonly timedOut: boolean; // true when our AbortSignal.timeout fired
  readonly aborted: boolean; // true when the external signal aborted (browser navigated away)
}
```

The wrapper deliberately uses non-standard `499` (Client Closed
Request) for aborts so calling routes can mirror it back to the
browser — useful for telemetry. The 1 timeout case maps to `504`.

### SvelteKit route handler template

```ts
import { json } from '@sveltejs/kit';

import { D6eClientError /* ... */ } from '$lib/server/d6e-client';
import { requireAccessToken } from '$lib/server/session';

const CALLER_TAG = '/api/<your-route>';

export const POST: RequestHandler = async (event) => {
  const accessToken = requireAccessToken(event, CALLER_TAG);
  // 1. Parse + validate body (return 400 on bad input)
  // 2. Call d6e-client helper with `signal: event.request.signal`
  // 3. Catch D6eClientError -> json({ error, timedOut?, aborted? }, { status: err.status })
  // 4. Catch other errors -> json({ error: msg }, { status: 500 })
};
```

The `requireAccessToken` shim is described in the [auth
skill](../d6e-auth-integration/SKILL.md) — it narrows
`event.locals.accessToken` from `string | undefined` to `string` and
throws SvelteKit's `error(401, 'Not authenticated')` when missing.

### `execute-by-intent` request body

```json
{
  "message": "領収書を仕訳に変換してください",
  "workspaceId": "<UUID, injected server-side>",
  "inputFileRefs": [
    {
      "fileId": "<UUID from /api/upload>",
      "filename": "receipt.jpg",
      "mimeType": "image/jpeg",
      "sizeBytes": 124300
    }
  ]
}
```

The `inputFileRefs` array is optional. For purely textual questions
(e.g. an "Ask" page) omit it entirely; otherwise pass through the
client's queue verbatim.

The response shape:

````json
{
  "success": true,
  "message": "...```json\n{...}\n```...",
  "workflowName": null,
  "files": [],
  "result": null
}
````

`message` is the LLM's free-form text. Parsing it into a typed payload
is the responsibility of the [`d6e-prompt-driven-ui`](../d6e-prompt-driven-ui/SKILL.md)
skill.

### Async intent job API

> Available on d6e instances running `feat/async-intent-jobs` or later.
> See also [docs/d6e-api-integration.md §2b](../../docs/d6e-api-integration.md)
> for full request/response schemas.

The synchronous `execute-by-intent` holds the HTTP connection open for
the entire agent run, which can exceed Vercel's `maxDuration` (~800s) on
heavy workloads. The **async job API** removes this ceiling by posting a
job (immediate return with `jobId`), then polling for status
independently. The d6e backend runs as a long-lived `adapter-node`
process, so the agent runs in the background with a configurable
wall-clock cap (default 30 minutes).

#### Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/workflows/execute-by-intent/jobs` | Create job — returns `{ jobId }` |
| `GET` | `/api/workflows/execute-by-intent/jobs/{id}` | Poll status, tool trace, result |
| `POST` | `/api/workflows/execute-by-intent/jobs/{id}/cancel` | Request cooperative cancellation |

All three use `Authorization: Bearer <jwt>`.

#### Job lifecycle

```
queued → running → succeeded
                 → failed
                 → cancelled
```

- **`queued`**: Row created, awaiting runner pickup (typically
  immediate).
- **`running`**: Runner claimed the job (CAS on `status`). Heartbeat
  updated every ~10 seconds. The runner checks `cancel_requested` on
  each tick.
- **`succeeded`**: Agent completed; `result` field carries the same
  `IntentResponse` shape as the sync endpoint.
- **`failed`**: Agent error (LLM failure, timeout, etc.); `error` field
  describes the cause.
- **`cancelled`**: Cooperative cancellation acknowledged; `error` =
  `"Job was cancelled"`.

#### Wrapper functions (d6e-client.ts)

```ts
export async function createAsyncIntentJob(
  caller: string,
  accessToken: string,
  body: { message: string; inputFileRefs?: IntentInputFileRef[]; conversationContext?: string }
): Promise<{ jobId: string }>;

export async function getAsyncIntentJobStatus(
  caller: string,
  accessToken: string,
  jobId: string
): Promise<AsyncJobStatusResponse>;

export async function cancelAsyncIntentJob(
  caller: string,
  accessToken: string,
  jobId: string
): Promise<{ cancelled: boolean }>;
```

Type definitions:

```ts
interface AsyncJobToolTrace {
  tool: string;
  startedAt: string;        // ISO 8601
  finishedAt?: string | null;
}

type AsyncJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

interface AsyncJobStatusResponse {
  id: string;
  status: AsyncJobStatus;
  toolTrace: AsyncJobToolTrace[];
  startedAt: string | null;
  finishedAt: string | null;
  elapsedMs: number | null;
  result: IntentResponse | null;  // same shape as sync endpoint
  error: string | null;
}
```

#### Integration pattern

For a Vercel-hosted frontend:

1. **Submit:** Server route calls `createAsyncIntentJob()` and returns
   `{ jobId }` to the browser.
2. **Background finalize (optional):** Use `waitUntil()` to poll
   `getAsyncIntentJobStatus()` and write the result to
   `chat_session` once the job completes — so even if the user
   closes the tab, the result is persisted.
3. **Client poll:** Browser polls a same-origin proxy (e.g.
   `/api/intent/d6e-job/{id}`) at 3–5s intervals. Render
   `toolTrace` entries and `elapsedMs` as a live progress display.
4. **Cancel:** Browser calls a same-origin proxy (e.g.
   `/api/intent/d6e-job/{id}/cancel`) when the user clicks cancel.
5. **Finalize:** On terminal status, update the UI. `succeeded` →
   process `result` as normal. `failed`/`cancelled` → render
   `error`.

#### Guardrails

| Guardrail | Default | Env var |
|-----------|---------|---------|
| Wall-clock cap | 30 min | `INTENT_JOB_TIMEOUT_MS` |
| Step cap | 50 | `AGENT_RECURSION_LIMIT` |
| Heartbeat stale | 60s | — |
| Workspace concurrency | 3 | — |
| Tool trace cap | 100 | — |

#### When to use async vs sync

| Scenario | Recommendation |
|----------|----------------|
| Vercel-hosted frontend, heavy agent runs (> 5 min) | **Async** — avoids `maxDuration` |
| SNS bot proxy (Slack / Discord / LINE) | **Sync** — simpler, fits within the bot platform's timeout |
| Light agent runs (< 2 min), no file generation | Either works; sync is simpler |
| Need progress display (tool trace) | **Async** — tool trace is only available via poll |
| Need user-initiated cancellation | **Async** — the sync endpoint has no cancel mechanism |

### Persistence: chat_session rows

When a route handler wants the AI Journal / Tasks pages to remember a
turn, it calls `createChatSession` (new conversation) or
`getChatSessionById` + `updateChatSession` (revision). Each turn
appends one user UIMessage + one assistant UIMessage:

```ts
{
  id: crypto.randomUUID(),
  role: 'user' | 'assistant',
  parts: [{ type: 'text', text: '...' }],
  inputFileRefs?: IntentInputFileRef[],   // only on user messages with attachments
}
```

The title convention (`[keiri] ...` or `[keiri-ask] ...` plus an
optional `#completed` suffix) lives in
[`src/lib/journal-title.ts`](../../src/lib/journal-title.ts). The
[`d6e-prompt-driven-ui`](../d6e-prompt-driven-ui/SKILL.md) skill
explains how the title is derived from the parsed journal payload.

### Bootstrap script idempotency

```js
// scripts/init-workspace.mjs (essence)
const desiredSha = sha256Hex(promptBody);
const existingRules = await listExistingRules({ baseUrl, workspaceId, accessToken });
const duplicate = existingRules.find(
  (rule) => sha256Hex((rule?.content ?? '').trim()) === desiredSha
);
if (duplicate) {
  console.log(
    `[init-workspace] identical rule already registered (id=${duplicate.id}). Skipping POST.`
  );
  process.exit(0);
}
await fetch(`${baseUrl}/api/workspace-prompt-rules`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Cookie: `auth-token=${accessToken}`
  },
  body: JSON.stringify({ workspaceId, content: promptBody })
});
```

Key points:

- The prompt body is `trim()`-ed before hashing so trailing-newline
  drift between editors does not invalidate the match.
- Hashing both sides lets you survive prompt-file refactors that
  preserve content — e.g. moving comments around without changing the
  rule body.
- `D6E_INIT_REFRESH_TOKEN` is read from the admin's `auth-refresh`
  cookie value (HttpOnly, so it must be copied manually from dev
  tools). It must never be the same value as a regular user's
  `auth-refresh` cookie.

### Drive Sync mirror endpoints

> Available on d6e instances that have the Drive Sync mirror feature
> enabled (introduced in `feat/drive-sync-mirror`). Implementation lives
> in
> [`packages/api/src/routes/v1/drive_sync.rs`](https://github.com/d6e-ai/d6e/blob/main/packages/api/src/routes/v1/drive_sync.rs)
> on the d6e side; the [`d6e-saas-google-workspace`
> SKILL](https://github.com/d6e-ai/d6e/blob/main/packages/skills/d6e-saas-google-workspace/SKILL.md)
> documents the LLM-facing view (`drive_files` projection +
> `d6e_read_drive_file` MCP tool).

All routes are mounted under `/api/v1/drive-sync/*` (not nested under
`/api/v1/workspaces/{id}`). The `workspace_id` is supplied in the body
(write methods) or query string (read methods), and every handler
asserts membership through the d6e-side `ensure_workspace_member`
check, so the proxy still has to pin the workspace id server-side just
like every other Bearer endpoint.

| Method   | Path                             | `workspace_id` location             | Body                                                                                                   | Returns                                                                |
| -------- | -------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| `GET`    | `/api/v1/drive-sync/config`      | query                               | —                                                                                                      | `{ config, roots[] }`                                                  |
| `PUT`    | `/api/v1/drive-sync/config`      | body                                | `{ workspace_id, enabled: bool, sync_interval_seconds: int (>=60) }`                                   | `{ config, roots[] }`                                                  |
| `GET`    | `/api/v1/drive-sync/roots`       | query                               | —                                                                                                      | `DriveSyncRoot[]`                                                      |
| `POST`   | `/api/v1/drive-sync/roots`       | body                                | `{ workspace_id, drive_id, drive_type: 'folder'\|'shared_drive'\|'my_drive', name, shared_drive_id? }` | New `DriveSyncRoot` (also kicks off a background initial sync)         |
| `DELETE` | `/api/v1/drive-sync/roots/{rid}` | query                               | —                                                                                                      | `{ status: 'deleted' }` (cascade-deletes nodes + clears projection)    |
| `POST`   | `/api/v1/drive-sync/sync`        | body                                | `{ workspace_id }`                                                                                     | `{ status: 'started' }` (background job; status visible via `/status`) |
| `GET`    | `/api/v1/drive-sync/status`      | query                               | —                                                                                                      | `{ config, roots[], node_count }`                                      |
| `POST`   | `/api/v1/drive-sync/materialize` | body                                | `{ workspace_id, node_id }`                                                                            | `{ storage_file_id }` (downloads bytes once, caches in `storage_file`) |
| `POST`   | `/api/v1/drive-sync/read`        | body                                | `{ workspace_id, drive_id }`                                                                           | `{ storage_file_id, filename, content_type, size }` (TTL-aware cache)  |
| `GET`    | `/api/v1/drive-sync/picker`      | query (`parent?`, `shared_drives?`) | —                                                                                                      | `{ folders: PickerEntry[], shared_drives: PickerEntry[] }`             |

Wrapper convention example (extend `src/lib/server/d6e-client.ts` only
if your app actually exposes Drive Sync controls):

```ts
export async function triggerDriveSync(caller: string, accessToken: string): Promise<void> {
  const apiUrl = getD6eUrl(caller);
  const workspaceId = getD6eWorkspaceId(caller);
  const response = await fetch(`${apiUrl}/api/v1/drive-sync/sync`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ workspace_id: workspaceId }),
    signal: buildCombinedSignal(DRIVE_SYNC_TIMEOUT_MS, undefined)
  });
  if (!response.ok) {
    const upstreamBody = await response.text().catch(() => '');
    throw new D6eClientError(
      `triggerDriveSync failed (caller=${caller}): ${response.status}`,
      response.status,
      upstreamBody.slice(0, 500),
      { timedOut: false, aborted: false }
    );
  }
}
```

Notes specific to Drive Sync proxies:

- **Pin `workspace_id` in the body too.** Forwarding the request body
  verbatim from the browser is a common mistake — the user could swap
  in another workspace id their JWT happens to authorise. Always
  overwrite the field with `getD6eWorkspaceId(caller)` before sending,
  same as for `execute-by-intent`.
- **`sync_interval_seconds` must be ≥ 60.** The d6e side returns 400
  otherwise. Validate in the proxy so the UI gets a JSON 400 instead of
  an opaque error.
- **`/sync` and `/roots POST` return immediately** with `status:
'started'`. The actual job runs in the background; the UI must poll
  `/status` (or display `config.last_sync_error`) to surface failures.
- **`/picker` only returns folders** when not in `shared_drives=true`
  mode, and only returns shared drives in that mode. Don't expect
  files; the browser/agent picks folders, not individual files.
- **`/materialize` blocks until the Drive download finishes.** Native
  Docs/Sheets/Slides are exported (PDF / XLSX / PPTX), which can take a
  few seconds on large files; size the proxy timeout accordingly.
- **`/read` is what an LLM-driven flow usually wants.** It takes a
  `drive_id` from the `drive_files` SQL projection and returns the
  cached `storage_file` for downstream use (`d6e_view_image` /
  `d6e_extract_file_text`). For agent UX, prefer `/read` over
  `/materialize` because it survives Drive-side file moves.

### SaaS API calls through the d6e proxy

> The LLM behind `execute-by-intent` already reaches SaaS APIs via the
> `d6e_call_external_api` MCP tool, so most prompt-driven flows never
> need this endpoint directly. Use it when your **own server code**
> must call a SaaS API (freee, Google Workspace, Notion, …) with the
> workspace's stored credential.

**Prerequisite — connect the provider in the d6e console first.** SaaS
credentials are created on the workspace settings page
(`{D6E_BASE_URL}/{locale}/workspaces/{id}/settings` → SaaS integrations
section, workspace **admin** role required):

- OAuth providers (freee, Google Workspace, Notion, GitHub, Salesforce,
  Box, MoneyForward クラウド / 経費) hop through d6e-auth's consent
  flow, which holds the provider's client secret.
- Token providers (Chatwork, Zendesk) take API tokens typed into a
  dialog.

There is no REST API to create these credentials from a custom
frontend — the console is the only entry point. Plan this as a setup
step with the workspace admin before writing any proxy code.

Once connected, any workspace **member** JWT can call:

```
POST ${D6E_BASE_URL}/api/v1/saas-proxy
Authorization: Bearer <jwt>
{
  "workspace_id": "<UUID>",        // pin server-side, as always
  "provider": "freee",             // catalog id
  "method": "GET",                 // GET/POST/PUT/PATCH/DELETE
  "path": "/api/1/companies",      // appended to the provider's base URL
  "headers": { ... },              // optional; auth headers are ignored
  "body": { ... },                 // optional JSON body
  "file_id": "<storage UUID>"      // optional: send a workspace file as the body
}
```

Response: `{ status, headers, body }` mirroring the upstream reply
(response bodies capped at 10 MB; use
`POST /api/v1/saas-proxy-download` for binaries). Notes:

- The proxy injects the real `Authorization` (or provider-specific
  token header) from the encrypted `saas_credential` row and refreshes
  expired OAuth tokens automatically. Caller-supplied `authorization`,
  `cookie`, `host`, and `x-chatworktoken` headers are discarded.
- `404 No credential found for provider=…` means the provider has not
  been connected in the console for this workspace — not a bug in your
  code.
- `file_id` alone sends the file's bytes as the raw body; `file_id` +
  `body` builds a multipart/related request (JSON metadata + binary),
  which is what Google Drive uploads want.

### Workspace data, workflows, and admin APIs

> The endpoints below live on the d6e Rust API (`${D6E_BASE_URL}/api/v1/...`).
> Every custom-frontend proxy must pin `D6E_WORKSPACE_ID` server-side — the
> browser never chooses the workspace. Canonical wrappers in the official
> console live in
> [`packages/frontend/src/lib/server/d6e-cloud.ts`](https://gitlab.com/cauchye/d6e-ai/d6e/-/blob/main/packages/frontend/src/lib/server/d6e-cloud.ts);
> mirror that shape in `src/lib/server/d6e-client.ts`.

#### Auth header rule of thumb

| Route shape | Where workspace is resolved | `X-Workspace-ID` |
| ----------- | --------------------------- | ---------------- |
| `/api/v1/workspaces/{id}/sql`, `/members`, `/invitations`, `/embeddings`, `/setup/*` | Path `{id}` + membership check | Optional; must match if sent |
| `/api/v1/workspaces/{id}/files/...`, `/documents/...` | **Header** (`auth.workspace_id()`; path id is ignored by the handler) | **Required** |
| Top-level `/workflows`, `/stfs`, `/effects`, `/policies`, `/policy-groups`, `/pinned-charts`, `/api-keys`, `/audit-logs` | Header only | **Required** |
| `/api/v1/saas-proxy`, `/api/v1/saas-proxy-download`, `/api/v1/drive-sync/*` | Body or query `workspace_id` (pin server-side) | Not used |

Bearer JWT and API keys (`d6e_...`) share the same `Authorization: Bearer`
transport everywhere the table says Bearer.

---

#### Workspace SQL

Execute and preview raw SQL against the workspace's `user_data` schema.
Logical table names in your SQL are rewritten to
`user_data.ws_{uuid_with_underscores}_{name}` (max **23** chars for the
logical name — the 40-char prefix consumes most of PostgreSQL's 63-char
identifier limit). `CREATE TABLE` adds system columns including
`deleted_at`; `DELETE` becomes a soft delete when that column exists.
Row-level policies are evaluated on execute (not on preview).

| Method | Path | Auth | Request | Response | Notes |
| ------ | ---- | ---- | ------- | -------- | ----- |
| `POST` | `/api/v1/workspaces/{wsId}/sql` | Bearer | `{ "sql": "<statement>" }` | `{ rows? }` for SELECT; `{ affected_rows?, executed_sql? }` for DML/DDL | Single statement only. DDL requires admin or `ddl_policy_group` membership. |
| `POST` | `/api/v1/workspaces/{wsId}/sql/preview` | Bearer | `{ "sql": "<statement>" }` | `{ proposal_id, original_sql, transformed_sql, operation, affected_tables, requires_approval }` | `requires_approval` is `false` only for SELECT. Does **not** evaluate runtime policy conditions. |

```ts
interface ExecuteSqlRequest {
  sql: string;
}

interface ExecuteSqlResponse {
  rows?: Record<string, unknown>[];
  affected_rows?: number;
  executed_sql?: string;
}

interface PreviewSqlResponse {
  proposal_id: string;
  original_sql: string;
  transformed_sql: string;
  operation: string;
  affected_tables: string[];
  requires_approval: boolean;
}

interface SqlErrorResponse {
  error: string;
  code: string; // POLICY_DENIED | DDL_FORBIDDEN | PARSE_ERROR | INVALID_TABLE | EXECUTION_ERROR | ...
}
```

```bash
# Preview an UPDATE before showing an approval dialog
curl -sS -X POST "${D6E_BASE_URL}/api/v1/workspaces/${WS_ID}/sql/preview" \
  -H "Authorization: Bearer ${JWT}" \
  -H "Content-Type: application/json" \
  -d '{"sql":"UPDATE invoices SET status = '\''paid'\'' WHERE id = '\''…'\''"}'
```

Proxy tip: surface `{ error, code }` verbatim for `POLICY_DENIED` and
`DDL_FORBIDDEN` so the UI can distinguish "forbidden by policy" from
"bad SQL syntax" (`PARSE_ERROR` / `INVALID_TABLE`).

---

#### File storage (list, metadata, download)

Complements upload/delete already documented above. All file routes resolve
workspace from `X-Workspace-ID` even though the path includes `{wsId}` —
always set both.

| Method | Path | Auth | Request | Response | Notes |
| ------ | ---- | ---- | ------- | -------- | ----- |
| `GET` | `/api/v1/workspaces/{wsId}/files` | Bearer + `X-Workspace-ID` | — | `FileMetadata[]` | Lightweight list; excludes byte content. |
| `GET` | `/api/v1/workspaces/{wsId}/files/{fileId}` | Bearer + `X-Workspace-ID` | — | `FileMetadata` | 404 when soft-deleted or wrong workspace. |
| `GET` | `/api/v1/workspaces/{wsId}/files/{fileId}/download` | Bearer + `X-Workspace-ID` | — | binary body | Stream to the browser from your proxy; don't expose the upstream URL. Max 1 GB. |

```ts
interface FileMetadata {
  id: string;
  workspace_id: string;
  filename: string;
  content_type: string;
  size: number;
  metadata?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}
```

Size your proxy timeout for large downloads. Enforce a client-side cap in
the app (this repo uses 10 MB on upload) even though upstream allows 1 GB.

---

#### Named workflows

Header-scoped CRUD plus direct execution. Used by patterns like
**expense-check**: `GET /api/v1/workflows` → find by `name` →
`POST /api/v1/workflows/{id}/execute` with the workflow's input JSON.

| Method | Path | Auth | Request | Response | Notes |
| ------ | ---- | ---- | ------- | -------- | ----- |
| `GET` | `/api/v1/workflows` | Bearer + `X-Workspace-ID` | — | `Workflow[]` | Sorted by `created_at` desc. |
| `POST` | `/api/v1/workflows` | Bearer + `X-Workspace-ID` | `{ name, description?, input_schema?, input_steps?, stf_steps, effect_steps }` | `Workflow` (201) | Editor permission enforced. |
| `GET` | `/api/v1/workflows/{id}` | Bearer + `X-Workspace-ID` | — | `WorkflowResponse` | Enriched STF/effect step metadata. |
| `PATCH` | `/api/v1/workflows/{id}` | Bearer + `X-Workspace-ID` | partial update body | `WorkflowResponse` | |
| `DELETE` | `/api/v1/workflows/{id}` | Bearer + `X-Workspace-ID` | — | 204 | Soft delete. |
| `POST` | `/api/v1/workflows/{id}/execute` | Bearer + `X-Workspace-ID` | workflow input JSON (any shape) | last step output JSON | Missing header → 400. Returns the final step's JSON value. |

```ts
// Expense-check pattern (server-side)
const workflows = await listWorkflows(caller, accessToken);
const wf = workflows.find((w) => w.name === 'expense-check');
const result = await executeWorkflow(caller, accessToken, wf.id, {
  receipt_file_id: uploaded.id,
  amount: 1200
});
```

Pin `X-Workspace-ID` from `getD6eWorkspaceId(caller)` in every workflow
helper — the URL never carries the workspace id. Docker STF steps can be
slow on first image pull; use a generous timeout (expense-check uses 120s)
and accept `event.request.signal`.

---

#### Workspace members

Member CRUD under the workspace path. Mutations require **admin** role.
`POST` shares the discriminated response with invitations (see
[Workspace invitation admin endpoints](#workspace-invitation-admin-endpoints)).

| Method | Path | Auth | Request | Response | Notes |
| ------ | ---- | ---- | ------- | -------- | ----- |
| `GET` | `/api/v1/workspaces/{wsId}/members` | Bearer (member) | — | `MemberInfo[]` | Joins user email/name server-side. |
| `POST` | `/api/v1/workspaces/{wsId}/members` | Bearer (admin) | `{ email, role? }` | `{ membership? \| invitation? }` | `role` defaults to `member`. Email lowercased server-side. |
| `PATCH` | `/api/v1/workspaces/{wsId}/members/{memberId}` | Bearer (admin) | `{ role }` | `MemberInfo` | Demoting the last admin → `LAST_ADMIN`. |
| `DELETE` | `/api/v1/workspaces/{wsId}/members/{memberId}` | Bearer (admin) | — | 204 | Removing the last admin → `LAST_ADMIN`. |

```ts
interface MemberInfo {
  id: string;
  user_id: string;
  user_email: string;
  user_name: string;
  role: 'admin' | 'member';
  created_at: string;
}
```

---

#### Workspace documents

Markdown documents with automatic version history on content change.
List responses omit `content` for efficiency. Like files, handlers resolve
workspace from `X-Workspace-ID` (path `{wsId}` is ignored) — always set both.

| Method | Path | Auth | Request | Response | Notes |
| ------ | ---- | ---- | ------- | -------- | ----- |
| `GET` | `/api/v1/workspaces/{wsId}/documents` | Bearer + `X-Workspace-ID` | query `doc_type?`, `status?` | `DocumentListItem[]` | No `content` field. |
| `POST` | `/api/v1/workspaces/{wsId}/documents` | Bearer + `X-Workspace-ID` | `{ title, doc_type?, status?, content?, metadata? }` | `DocumentResponse` | |
| `GET` | `/api/v1/workspaces/{wsId}/documents/{id}` | Bearer + `X-Workspace-ID` | — | `DocumentResponse` | Includes full Markdown `content`. |
| `PATCH` | `/api/v1/workspaces/{wsId}/documents/{id}` | Bearer + `X-Workspace-ID` | partial fields + `change_summary?` | `DocumentResponse` | Content change creates a new version row. |
| `DELETE` | `/api/v1/workspaces/{wsId}/documents/{id}` | Bearer + `X-Workspace-ID` | — | 204 | Soft delete. |
| `GET` | `/api/v1/workspaces/{wsId}/documents/{id}/versions` | Bearer + `X-Workspace-ID` | — | `DocumentVersionResponse[]` | Historical snapshots. |

---

#### Embeddings

All routes nest under `/api/v1/workspaces/{wsId}/embeddings`. Workspace
from path; Bearer + membership.

**Column embeddings** (sync, pgvector on a TEXT/VARCHAR column):

| Method | Path | Auth | Request | Response | Notes |
| ------ | ---- | ---- | ------- | -------- | ----- |
| `POST` | `…/embeddings/generate` | Bearer | `{ table_name, column_name, regenerate? }` | `{ generated_count, column_added }` | DDL permission required when adding `{column}_embedding`. |
| `GET` | `…/embeddings/status?table_name=` | Bearer | query | `EmbeddingStatusResponse` | Per-column progress + model metadata. |
| `POST` | `…/embeddings/similarity-search` | Bearer | `{ table_name, column_name, query, limit? }` | `{ rows: Value[] }` | Semantic nearest-neighbor over embedded rows. |

**File embeddings** (`…/embeddings/files/*`, multimodal):

| Method | Path | Request | Response |
| ------ | ---- | ------- | -------- |
| `POST` | `…/files/embed` | `{ file_ids: UUID[] }` | `{ results: [{ file_id, status, error? }] }` |
| `GET` | `…/files/status` | — | `FileEmbeddingStatusResponse` |
| `POST` | `…/files/search` | `{ query, limit? }` | `{ files[], chunks[] }` |
| `POST` | `…/files/regenerate` | `{ file_ids: UUID[] }` | same shape as embed |

**Table row embeddings** (`…/embeddings/tables/*`, async whole-table):

| Method | Path | Request | Response |
| ------ | ---- | ------- | -------- |
| `POST` | `…/tables/embed` | `{ table_names: string[] }` | `{ results: [{ table_name, status, error? }] }` |
| `GET` | `…/tables/status` | — | `TableRowEmbeddingStatusResponse` |
| `POST` | `…/tables/search` | `{ query, limit?, table_names? }` | `{ results: [{ table_name, row_data, distance }] }` |
| `POST` | `…/tables/regenerate` | `{ table_names: string[] }` | same shape as embed |

Long-running embed/regenerate jobs return immediately; poll the matching
`/status` endpoint from your UI.

---

#### Pinned dashboard charts

Header-scoped CRUD storing a saved SQL query + chart configuration.
List returns **visible** charts only (`is_visible = true`).

| Method | Path | Auth | Request | Response | Notes |
| ------ | ---- | ---- | ------- | -------- | ----- |
| `GET` | `/api/v1/pinned-charts` | Bearer + `X-Workspace-ID` | — | `PinnedChart[]` | Ordered by `display_order`, then `created_at`. |
| `POST` | `/api/v1/pinned-charts` | Bearer + `X-Workspace-ID` | `{ title, sql_query, chart_type, description?, x_axis_column?, y_axis_columns?, display_order? }` | `PinnedChart` (201) | |
| `GET` | `/api/v1/pinned-charts/{id}` | Bearer + `X-Workspace-ID` | — | `PinnedChart` | |
| `PATCH` | `/api/v1/pinned-charts/{id}` | Bearer + `X-Workspace-ID` | partial fields incl. `is_visible?` | `PinnedChart` | Hide charts by setting `is_visible: false`. |
| `DELETE` | `/api/v1/pinned-charts/{id}` | Bearer + `X-Workspace-ID` | — | 204 | Soft delete. |

Chart SQL runs through the same workspace SQL engine when the dashboard
renders — keep logical table names ≤ 23 chars.

---

#### Other Rust APIs (inventory)

Brief index of additional endpoints you may proxy. All Bearer unless noted.
Pin workspace id per the auth rule of thumb above.

| Area | Base path | Highlights |
| ---- | --------- | ---------- |
| STFs | `/api/v1/stfs` | CRUD, `/{id}/versions`, `/{id}/describe`, `POST /instant-run`. Secrets at `/{stf_id}/secrets`. Requires `X-Workspace-ID`. |
| Effects | `/api/v1/effects` | CRUD + `/{id}/versions`. Requires `X-Workspace-ID`. |
| Policies | `/api/v1/policies` | CRUD for row-level policy rules. Requires `X-Workspace-ID`. |
| Policy groups | `/api/v1/policy-groups` | CRUD; used for DDL/editor group membership. Requires `X-Workspace-ID`. |
| API keys | `/api/v1/api-keys` | `GET` list, `POST` create (returns raw key once), `DELETE /{id}`. Session JWT only (not API keys). Requires `X-Workspace-ID`. |
| Audit logs | `/api/v1/audit-logs` | `GET` with filters (`user_id?`, `action?`, `limit?`, …). Requires `X-Workspace-ID`. |
| Redirect URIs | `/api/v1/workspaces/{id}/redirect-uris` | Admin Bearer CRUD for OAuth callback URLs (proxied to d6e-auth). |
| Workspace setup | `/api/v1/workspaces/{id}/setup/*` | Admin Bearer routes: `skills`, `title-rule`, `chat-templates`, `dashboard-enabled`, `saas-credentials`, **`prompt-rules`** (Bearer alternative to the Cookie SvelteKit `/api/workspace-prompt-rules` route). |
| SaaS binary download | `POST /api/v1/saas-proxy-download` | Same auth/credential model as `saas-proxy`; streams upstream binary into `storage_file` (100 MB cap). Body mirrors saas-proxy + optional `suggested_filename` / `metadata`. Response includes `{ id, filename, content_type, size }` on 2xx. |
| Current user | `GET /api/v1/auth/me` | `{ id, email, name }` from JWT or API key. No workspace header needed. |

There is **no** `GET /workspaces/{id}/tables` endpoint (older README mentions are stale). List tables via SQL against `information_schema` as `d6e-cloud.ts` `listTables()` does. File upload also accepts `POST …/files` with base64 JSON as an alternative to multipart.

### Workspace invitation admin endpoints

> Available on d6e instances that have the pending-invitation feature
> enabled (introduced in `feat(workspace): support pending invitations
for unregistered users`). Implementation lives in
> [`packages/api/src/routes/v1/workspace_invitation.rs`](https://github.com/d6e-ai/d6e/blob/main/packages/api/src/routes/v1/workspace_invitation.rs).

The same `POST /api/v1/workspaces/{id}/members` endpoint that has
always created memberships now creates a **pending invitation** row
instead when the invited email does not yet exist in the d6e instance.
That row is auto-consumed by the d6e auth layer on the invitee's
first JWT-authenticated request (see the
[`d6e-auth-integration`](../d6e-auth-integration/SKILL.md) skill); the
admin API below lets a custom frontend list and cancel those pending
rows in the meantime.

| Method   | Path                                                 | Auth                              | Notes                                                                                             |
| -------- | ---------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------- |
| `GET`    | `/api/v1/workspaces/{id}/invitations`                | Bearer (workspace **admin** role) | Returns `InvitationInfo[]`. Inviter name is joined server-side so the table has no N+1.           |
| `DELETE` | `/api/v1/workspaces/{id}/invitations/{invitationId}` | Bearer (workspace **admin** role) | Cancels a single pending invitation. Audit-logged as `cancel_pending_invitation`. 204 on success. |

```ts
interface InvitationInfo {
  id: string; // UUID
  workspace_id: string; // UUID
  email: string; // lowercased server-side
  role: 'admin' | 'member';
  invited_by_user_id: string | null; // null when the inviter was deleted
  invited_by_user_name: string | null;
  created_at: string; // ISO 8601
}
```

`POST /api/v1/workspaces/{id}/members` now also returns a discriminated
shape — either `{ membership: WorkspaceMember }` (when the email
matched an existing user) or `{ invitation: InvitationInfo }` (pending
case). Update the proxy to surface both branches to the UI so the
admin can render a distinct toast for each.

## Implementation Checklist

- [ ] Every public function in the d6e client takes `caller: string` as the first argument.
- [ ] `accessToken` is passed explicitly; no helper reaches into `event.cookies` or globals.
- [ ] All outbound fetches set `AbortSignal.timeout(...)`, and long-running endpoints (execute-by-intent) additionally accept an external `signal`.
- [ ] Errors normalize to `D6eClientError(message, status, upstreamBody, {timedOut, aborted})`.
- [ ] Bearer endpoints under `/api/v1/...` send `Authorization: Bearer <jwt>`. Add `X-Workspace-ID` when the route is **header-scoped** (files, documents, workflows, stfs, effects, policies, pinned-charts, api-keys, audit-logs) — path-scoped SQL/members/embeddings/setup resolve workspace from the URL.
- [ ] SQL proxy helpers take `{ sql }` only from validated server input; inject `wsId` from `getD6eWorkspaceId(caller)` into the path, never from the browser.
- [ ] SQL error responses forward `{ error, code }` so the UI can branch on `POLICY_DENIED` vs parse errors.
- [ ] File list/metadata/download helpers send `X-Workspace-ID` even though the URL already contains `{wsId}`.
- [ ] Workflow helpers always set `X-Workspace-ID`; create-job and execute-by-intent paths pin workspace differently (header vs body) — do not mix them up.
- [ ] Member admin proxies forward 403 unchanged and surface both `{ membership }` and `{ invitation }` from `POST …/members`.
- [ ] Member remove/demote handlers forward `LAST_ADMIN` error bodies so the UI can explain "cannot remove the last admin".
- [ ] Document list proxies do not expect a `content` field; fetch `GET …/documents/{id}` when the editor needs the body.
- [ ] Embedding long-running routes poll `/status` rather than blocking the HTTP response.
- [ ] Pinned-chart proxies treat list as visibility-filtered; use `PATCH is_visible: false` to hide without deleting.
- [ ] Binary download proxies (`files/{id}/download`, `saas-proxy-download`) stream through the server — never redirect the browser to `${D6E_BASE_URL}`.
- [ ] SvelteKit endpoints (`/api/chat-sessions`, `/api/workspace-prompt-rules`) use `Cookie: auth-token=<jwt>` and never `Authorization`.
- [ ] The SvelteKit route handler pins `workspaceId` from env, not from the request body.
- [ ] For Drive Sync endpoints, the proxy overrides `workspace_id` in **both** the JSON body and any query string before forwarding (the d6e route accepts it in either spot, and the browser must never choose it).
- [ ] If you expose `/sync` or `/roots POST`, the UI polls `/status` (or reads `config.last_sync_error`) before claiming success — the d6e endpoint returns `200 { status: 'started' }` before the job actually finishes.
- [ ] If you expose admin invitation management, the proxy forwards 403 / 404 from `GET/DELETE /workspaces/{id}/invitations` unchanged (so the UI can tell "not admin" from "no such invitation"), and `POST /workspaces/{id}/members` surfaces both `{ membership }` and `{ invitation }` branches to the client.
- [ ] If using the async job API, the proxy pins `workspaceId` in the create-job body (same rule as sync `execute-by-intent`).
- [ ] If using `waitUntil()` for background finalization, handle the case where the Vercel function is recycled (the d6e job still runs — the next poll or page load should pick up the result).
- [ ] Async job poll proxies (e.g. `/api/intent/d6e-job/{id}`) never expose the raw d6e endpoint URL to the browser.
- [ ] On 401/403 inside a route, the wrapper bubbles the status to the browser; do NOT call `clearSession()` here (the hook layer already manages refresh).
- [ ] Bootstrap script SHA-256-hashes the prompt body and compares against every existing rule's content before POSTing.
- [ ] Bootstrap script reads `D6E_INIT_REFRESH_TOKEN` separately from end-user cookies.
- [ ] `console.error` / `console.warn` lines carry `[d6e-client]` or `[init-workspace]` prefixes per the repo's logging convention.

## Best Practices

### Security

- Never proxy a `workspaceId` value supplied by the browser — pin it to `D6E_WORKSPACE_ID`. Even if the user's JWT happens to authorise multiple workspaces, your app should expose only the one it was configured for.
- Don't relay the `upstreamBody` verbatim to anonymous users on production. The internal helpers cap it to 500 chars in log lines for a reason; for client responses, prefer `D6eClientError.message`.
- For file uploads, enforce a max size (this app uses 10 MB) before reading the request body to avoid OOM on a malicious client streaming a multi-GB body.
- Pass `event.request.signal` down to `executeByIntent`; otherwise a user closing their browser will leave a 270s function instance hanging.

### Reliability

- Tune `executeByIntent`'s timeout to whatever the upstream LLM round-trip can plausibly take, but keep it strictly below Vercel's `maxDuration` so the function returns a clean 504 rather than being killed mid-flight. For runs that routinely exceed this, switch to the async job API.
- For non-critical writes (e.g. analytics, chat_session append), wrap the call in a `try/catch` and log on failure instead of blowing up the user-visible response. The reference `/api/intent` handler still returns the LLM result even if persistence failed; the browser can recover.
- Treat `404` on file delete as success — files might have been GC'd or already removed in a parallel tab.
- When using `waitUntil()` for async job finalization, implement retry logic for the final `chat_session` write — the Vercel function may be recycled between poll ticks. The d6e-side job result is persisted in `intent_job` regardless, so the data is not lost.

### Operational

- Surface `timedOut` / `aborted` flags on the JSON response so the client can render appropriate UI ("retry" vs "your request was cancelled").
- Keep the helper file small and focused: when you need a new endpoint, add a function next to its siblings (not in a route handler) so the next person can find and reuse it.
- Avoid `try/catch` swallowing inside the helpers — surface every failure as `D6eClientError`. Logging happens at the boundary (route handler / SSR loader) where the context is known.

## Troubleshooting

### SQL execute returns 403 with `code: "POLICY_DENIED"`

The statement parsed successfully but a workspace row-level policy blocked
it for this user. This is not an auth failure — the JWT is valid and the
user is a member. Surface the `error` string to the user and, for admin
UIs, link to the d6e console's policy editor. Preview (`/sql/preview`)
will **not** catch this because it skips runtime policy evaluation; only
execute does. Do not retry blindly — adjust the SQL, the policy, or the
caller's role/group membership.

### `POST /api/v1/workflows/{id}/execute` returns 400 "Missing X-Workspace-ID header"

Workflow routes are mounted at the top level (`/api/v1/workflows/...`), not
under `/workspaces/{id}`. The handler reads workspace exclusively from
`X-Workspace-ID`. Your proxy must set
`'X-Workspace-ID': getD6eWorkspaceId(caller)` on every workflow helper
even though you also pin `D6E_WORKSPACE_ID` in execute-by-intent bodies.
A Bearer token alone is not enough.

### SQL preview/execute returns 400 with `code: "INVALID_TABLE"` mentioning 23 characters

Logical table names are capped at **23 characters** because d6e prefixes
them with `ws_{uuid_with_underscores}_` (40 chars) inside the
`user_data` schema (PostgreSQL's 63-char identifier limit). Shorten the
name in your SQL — e.g. `expense_line_items` → `exp_line_items`. The
`transformed_sql` field in preview shows the fully prefixed name d6e will
run.

### `/api/chat-sessions` returns 401 even though `/api/intent` works

You're sending a `Authorization: Bearer` header but the d6e SvelteKit
endpoint authenticates via `locals.user` (cookie-based). Switch to
`Cookie: auth-token=<jwt>` — the JWT itself is the same value.

### Empty 400 body from `/api/v1/workspaces/{id}/files/multipart`

The d6e side returns a bare 400 when the multipart body has no `file`
part (or the part has no filename), or when the request carries no
usable workspace id — the handler takes it from the `X-Workspace-ID`
header, not the URL path. Verify the route handler calls
`getD6eWorkspaceId('/api/upload')` (which validates the UUID format),
sets the `X-Workspace-ID` header, and appends the `file` part. The
`metadata` part is optional. A `413` means the file exceeded the
server-side 1 GB cap (this app additionally enforces 10 MB client-side).

### `executeByIntent` returns 402 with "AI features are temporarily disabled"

Not an auth problem. The d6e instance soft-gates LLM usage per
workspace based on billing entitlement (past-due subscription,
exhausted credits, usage cap). The response body's `message` explains
the reason. Surface it to the user verbatim and point the workspace
admin at the instance's billing page — retrying will not help until
the entitlement recovers.

### `POST /api/v1/saas-proxy` returns 404 "No credential found"

The target provider has never been connected for this workspace. A
workspace admin must connect it on the d6e console's workspace
settings page (SaaS integrations section) first — there is no API to
do this from the custom frontend. See [SaaS API calls](#saas-api-calls-through-the-d6e-proxy).

### `D6eClientError(status=504, timedOut=true)` on every `executeByIntent`

The configured `timeoutMs` is shorter than the LLM round-trip. Bump
`DEFAULT_INTENT_TIMEOUT_MS` (currently 270s) — but stay below
`@sveltejs/adapter-vercel`'s `maxDuration: 300` so the function
returns gracefully. Alternatively, switch to the [async job
API](#async-intent-job-api) which bypasses the HTTP connection lifetime
entirely.

### `POST .../execute-by-intent/jobs` returns 429

The workspace has hit its per-workspace concurrency cap (default 3
running jobs). Either wait for an existing job to finish, cancel one
via `POST .../jobs/{id}/cancel`, or ask the instance admin to raise the
limit.

### Async job status stays `running` with stale heartbeat

The runner process was killed (e.g. container restart) mid-flight. The
d6e side detects staleness after 60s (heartbeat not updated) and will
transition the job to `failed` automatically on the next status check.
If you see this consistently, investigate the d6e instance's process
health.

### Async job status shows `cancelled` but the cancel request returned `false`

`{ cancelled: false }` means the job was not in `running` state when
the cancel request arrived — it had already finished (or was still
`queued`). Check `finishedAt` and `status` on the poll response to see
what actually happened.

### `npm run init` POSTs a duplicate rule every time

The local prompt file's trimmed content doesn't match what was stored
upstream. Common causes:

- Someone edited the rule body in the d6e admin UI; the SHA no longer
  matches. Resolve by deleting the orphan rule manually and re-running
  the script.
- An editor added a BOM or CRLF endings. Normalise the file to UTF-8
  without BOM and LF endings, then re-run.

### "rejected refresh (status=4xx)" in `npm run init`

`D6E_INIT_REFRESH_TOKEN` was rotated. Log into the d6e admin UI as
the workspace admin, copy the new `auth-refresh` cookie value from
dev tools, update `.env`, and re-run.

### `403 Forbidden` from `POST /api/workspace-prompt-rules`

The account behind the refresh token is not a workspace admin. Either
promote them or replace the env var with an admin's token.

### Aborts leak as `D6eClientError(status=499)` to the browser

This is intentional. Map `aborted === true` to a UI message like
"Request cancelled" rather than the generic error banner.

### `POST /api/v1/drive-sync/sync` returns 200 but nothing seems to happen

The route returns `{ status: 'started' }` immediately and kicks off the
actual sync on a tokio task. The success / failure result lands in
`drive_sync_config.last_synced_at` and `drive_sync_config.last_sync_error`,
which you read back through `GET /api/v1/drive-sync/status`. Wire the UI
to poll `/status` (or refresh on focus) instead of trusting the 200.

### `POST /api/v1/drive-sync/roots` returns 400 with `invalid drive_type`

`drive_type` must be one of `folder`, `shared_drive`, or `my_drive`.
The picker payload returns only folders and shared drives; encode the
user's selection as `folder` (any subfolder) or `shared_drive` (top of
a shared drive), and reserve `my_drive` for the special "everything in
My Drive" case.

### `POST /api/v1/drive-sync/read` returns 404 even though the file exists in Drive

The `drive_id` you sent is not present in the workspace's sync mirror.
Either the file lives outside any sync root, or the sync that would
have indexed it has not run yet. Trigger `/sync`, wait until
`status.node_count` updates, and retry. For files outside the sync
roots, use the underlying SaaS proxy / `d6e_download_external_file` MCP
tool instead — `/read` is intentionally limited to mirrored files.

### `GET /api/v1/workspaces/{id}/invitations` returns 403 for a workspace owner

The d6e side requires the **admin** role on
`workspace_membership`, not just membership. Confirm the user is an
admin in the workspace; the owner concept (creator) doesn't exist
separately. Promote the user through the d6e admin UI, then retry.

### `POST /api/v1/workspaces/{id}/members` returns `{ invitation: ... }` instead of `{ membership: ... }`

This is the new pending-invitation branch — the invitee has not signed
in to the d6e instance yet, so the row landed in `workspace_invitation`
instead of `workspace_membership`. Surface this to the admin (e.g.
toast "Invitation queued for first login"); the row will be
auto-promoted by `apply_pending_invitations` on the invitee's first
JWT-authenticated request without any additional work from the
frontend.

## Related Skills

- [`d6e-auth-integration`](../d6e-auth-integration/SKILL.md) — Provides the `event.locals.accessToken` that every wrapper here consumes, plus the membership probe semantics that interact with pending invitations.
- [`d6e-prompt-driven-ui`](../d6e-prompt-driven-ui/SKILL.md) — Designs the LLM contract that `executeByIntent` carries and the workspace prompt rule that `init-workspace.mjs` registers; also covers the prompt patterns that read the `drive_files` projection backed by these Drive Sync endpoints.
- External: [`d6e-saas-google-workspace`](https://github.com/d6e-ai/d6e/blob/main/packages/skills/d6e-saas-google-workspace/SKILL.md) — Lives in the `d6e` repo and documents the `drive_files` SQL projection plus the `d6e_read_drive_file` MCP tool that sit on top of the Drive Sync endpoints described here.
- Background: [Custom frontends and the d6e instance — how they relate](https://github.com/d6e-ai/d6e-custom-frontend-skills/blob/main/docs/frontend-and-instance.md) ([日本語版](https://github.com/d6e-ai/d6e-custom-frontend-skills/blob/main/docs/frontend-and-instance.ja.md)) — why every call in this skill goes through the instance's public APIs, and how the frontend relates to the instance and to Plugins.
