---
name: d6e-workspace-api-client
description: Builds the server-side proxy layer that lets a custom frontend talk to a d6e workspace — file upload, file delete, workflow execution via `execute-by-intent`, chat-session CRUD, workspace prompt rule registration, and workspace membership probes. Use when adding a new `/api/*` route that talks to d6e, when designing a fetch wrapper that needs to surface timeouts/aborts cleanly, when seeing 401 on `/api/chat-sessions`, or when writing a bootstrap script that registers workspace prompt rules idempotently.
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

## When to Use

Apply this skill when the user says:

- "Add a new endpoint that talks to d6e"
- "How do I upload files to a d6e workspace from my app?"
- "Why does `/api/chat-sessions` give me 401 when Bearer works elsewhere?"
- "Wrap the d6e API with timeouts and abort handling"
- "Make `npm run init` idempotent"
- "Proxy `execute-by-intent` from my SvelteKit/Next.js backend"
- "サーバ側で d6e API を叩く層を作りたい"
- "Where do I plumb the workspace ID through?"

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

| Endpoint                                                         | Auth                                                     | Notes                                                         |
| ---------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------- |
| `POST ${D6E_BASE_URL}/api/v1/workspaces/{wsId}/files/multipart`  | `Authorization: Bearer <jwt>` + `X-Workspace-ID: <wsId>` | `multipart/form-data` body with `file` + `metadata` fields    |
| `DELETE ${D6E_BASE_URL}/api/v1/workspaces/{wsId}/files/{fileId}` | `Authorization: Bearer <jwt>` + `X-Workspace-ID: <wsId>` | 404 is treated as success (already gone)                      |
| `GET ${D6E_BASE_URL}/api/v1/workspaces/{wsId}`                   | `Authorization: Bearer <jwt>`                            | Workspace membership probe (returns 200/403/404)              |
| `POST ${D6E_BASE_URL}/api/workflows/execute-by-intent`           | `Authorization: Bearer <jwt>`                            | Body contains `workspaceId` — set server-side                 |
| `POST ${D6E_BASE_URL}/api/v1/auth/token`                         | none (refresh token in body)                             | Stage 2 / refresh — see auth skill                            |
| `* ${D6E_BASE_URL}/api/chat-sessions[/...]`                      | `Cookie: auth-token=<jwt>`                               | Bearer is rejected; the SvelteKit handler reads `locals.user` |
| `POST ${D6E_BASE_URL}/api/workspace-prompt-rules`                | `Cookie: auth-token=<jwt>`                               | Requires admin role on the workspace                          |
| `GET ${D6E_BASE_URL}/api/workspace-prompt-rules?workspaceId=…`   | `Cookie: auth-token=<jwt>`                               | Used for idempotent rule registration                         |

The Bearer JWT and the `auth-token` cookie value are the **same**
string — only the transport differs.

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
| `executeByIntent(caller, accessToken, body, options?)`                     | Bearer                    | Runs the natural-language workflow. Body is `{ message, inputFileRefs? }`; the wrapper injects `workspaceId`. Supports `timeoutMs` (default 270s, below Vercel's 300s cap) and `signal`. |
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

## Implementation Checklist

- [ ] Every public function in the d6e client takes `caller: string` as the first argument.
- [ ] `accessToken` is passed explicitly; no helper reaches into `event.cookies` or globals.
- [ ] All outbound fetches set `AbortSignal.timeout(...)`, and long-running endpoints (execute-by-intent) additionally accept an external `signal`.
- [ ] Errors normalize to `D6eClientError(message, status, upstreamBody, {timedOut, aborted})`.
- [ ] Bearer endpoints under `/api/v1/...` send both `Authorization: Bearer <jwt>` and `X-Workspace-ID: <wsId>` when the path includes a workspace.
- [ ] SvelteKit endpoints (`/api/chat-sessions`, `/api/workspace-prompt-rules`) use `Cookie: auth-token=<jwt>` and never `Authorization`.
- [ ] The SvelteKit route handler pins `workspaceId` from env, not from the request body.
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

- Tune `executeByIntent`'s timeout to whatever the upstream LLM round-trip can plausibly take, but keep it strictly below Vercel's `maxDuration` so the function returns a clean 504 rather than being killed mid-flight.
- For non-critical writes (e.g. analytics, chat_session append), wrap the call in a `try/catch` and log on failure instead of blowing up the user-visible response. The reference `/api/intent` handler still returns the LLM result even if persistence failed; the browser can recover.
- Treat `404` on file delete as success — files might have been GC'd or already removed in a parallel tab.

### Operational

- Surface `timedOut` / `aborted` flags on the JSON response so the client can render appropriate UI ("retry" vs "your request was cancelled").
- Keep the helper file small and focused: when you need a new endpoint, add a function next to its siblings (not in a route handler) so the next person can find and reuse it.
- Avoid `try/catch` swallowing inside the helpers — surface every failure as `D6eClientError`. Logging happens at the boundary (route handler / SSR loader) where the context is known.

## Troubleshooting

### `/api/chat-sessions` returns 401 even though `/api/intent` works

You're sending a `Authorization: Bearer` header but the d6e SvelteKit
endpoint authenticates via `locals.user` (cookie-based). Switch to
`Cookie: auth-token=<jwt>` — the JWT itself is the same value.

### Empty 400 body from `/api/v1/workspaces/{id}/files/multipart`

`workspaceId` in the URL is not a UUID, or the multipart body is
missing the `metadata` field. Verify the route handler is calling
`getD6eWorkspaceId('/api/upload')` (which validates the UUID format)
and appending both `file` and `metadata` parts.

### `D6eClientError(status=504, timedOut=true)` on every `executeByIntent`

The configured `timeoutMs` is shorter than the LLM round-trip. Bump
`DEFAULT_INTENT_TIMEOUT_MS` (currently 270s) — but stay below
`@sveltejs/adapter-vercel`'s `maxDuration: 300` so the function
returns gracefully.

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

## Related Skills

- [`d6e-auth-integration`](../d6e-auth-integration/SKILL.md) — Provides the `event.locals.accessToken` that every wrapper here consumes.
- [`d6e-prompt-driven-ui`](../d6e-prompt-driven-ui/SKILL.md) — Designs the LLM contract that `executeByIntent` carries and the workspace prompt rule that `init-workspace.mjs` registers.
