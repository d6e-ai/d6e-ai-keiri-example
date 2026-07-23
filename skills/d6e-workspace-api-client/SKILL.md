---
name: d6e-workspace-api-client
description: Builds the server-side proxy layer that lets a custom frontend talk to a d6e workspace — file upload/list/download/delete (two-step saas-proxy-download + streaming proxy), workspace SQL execute/preview, named workflow CRUD/execute, workspace member admin, execute-by-intent (sync and async job API), chat-session CRUD, workspace prompt rule registration, SaaS API calls via saas-proxy (+ binary saas-proxy-download), Google Drive sync mirror, and pending-invitation admin. Use when adding a `/api/*` route that talks to d6e, when implementing file download via same-origin streaming proxy (never 302 to D6E_BASE_URL), when deploying on Vercel maxDuration/waitUntil or Cloudflare Workers CPU limits, when surfacing SQL POLICY_DENIED to the UI, when sync execute-by-intent times out and you need async jobs with poll/cancel/heartbeat, or when calling freee/Google/Notion with workspace-stored credentials.
---

# d6e Workspace API Client

## Overview

Server-side glue between a custom frontend and a d6e workspace:

- **Browser never calls d6e directly** — every request goes through a
  same-origin `/api/*` proxy; JWT stays in HTTP-only cookies.
- **Fetch wrapper conventions** in `src/lib/server/d6e-client.ts` — explicit
  `caller`, explicit `accessToken`, `D6eClientError`, combined
  `AbortSignal` for timeout + caller cancellation.
- **Bearer vs Cookie split** — Rust API uses `Authorization: Bearer`; SvelteKit
  surfaces (`/api/chat-sessions`, `/api/workspace-prompt-rules`) require
  `Cookie: auth-token=<jwt>`.
- **Workspace ID server-pinned** from `D6E_WORKSPACE_ID` — the browser never
  chooses the workspace.
- **Two-step downloads** — `saas-proxy-download` (JSON metadata) then
  `GET …/files/{id}/download` streamed through your proxy. See
  [references/download-two-step.md](references/download-two-step.md).
- **Async intent jobs** for long LLM runs on Vercel / Cloudflare — see
  [references/async-intent-jobs.md](references/async-intent-jobs.md) and
  [references/platform-timeouts.md](references/platform-timeouts.md).

Canonical d6e console wrappers:
[`packages/frontend/src/lib/server/d6e-cloud.ts`](https://gitlab.com/cauchye/d6e-ai/d6e/-/blob/main/packages/frontend/src/lib/server/d6e-cloud.ts).

## When to Use

- "Add a new endpoint that talks to d6e" / "サーバ側で d6e API を叩く層を作りたい"
- "How do I upload or download files?" / "SaaS から PDF を取り込んで表示したい"
- "Why does `/api/chat-sessions` 401 when Bearer works elsewhere?"
- "Run or preview workspace SQL" / "POLICY_DENIED を UI に出したい"
- "execute-by-intent times out on Vercel" / "非同期ジョブ API を使いたい"
- "Call freee / Google with workspace credentials" / "SaaS 連携 API をサーバから"
- "Build admin members / Drive Sync / invitation UI"
- "Deploy on Cloudflare Workers — what patterns avoid CPU timeout?"

## Core Concepts

### Browser never calls d6e directly

Each `/api/*` route:

1. Reads `event.locals.accessToken` (see
   [`d6e-auth-integration`](../d6e-auth-integration/SKILL.md)).
2. Pins `D6E_WORKSPACE_ID` from env.
3. Forwards via `src/lib/server/d6e-client.ts`.
4. Relays upstream status + normalized errors to the browser.

**Never** 302-redirect the browser to `${D6E_BASE_URL}` for downloads or
API calls.

### Authentication header matrix

Workspace resolution varies by route shape (path vs header vs body). Full
table: [references/auth-header-matrix.md](references/auth-header-matrix.md).

Quick rule of thumb:

| Route shape | Workspace from | `X-Workspace-ID` |
| ----------- | -------------- | ---------------- |
| `…/workspaces/{id}/sql`, `/members`, `/embeddings` | Path | Optional |
| `…/workspaces/{id}/files/…`, `/documents/…` | **Header** (path ignored) | **Required** |
| `/workflows`, `/stfs`, `/pinned-charts`, … | Header | **Required** |
| `/saas-proxy`, `/saas-proxy-download`, `/drive-sync/*` | Body/query (pin server-side) | Not used |
| `/api/chat-sessions`, `/workspace-prompt-rules` | Cookie `auth-token` | N/A |

### Fetch wrapper conventions

```ts
export async function uploadFile(
  caller: string,
  accessToken: string,
  payload: { /* … */ }
): Promise<UploadFileResult>;
```

- `caller` first — logs like `[d6e-client] uploadFile failed (caller=/api/upload)`.
- `accessToken` explicit — never read cookies inside helpers.
- Errors → `D6eClientError(message, status, upstreamBody, { timedOut, aborted })`.
- `AbortSignal.timeout(...)` on every outbound fetch; long routes also accept
  `event.request.signal`.

### Workspace ID is server-pinned

```ts
const workspaceId = getD6eWorkspaceId(caller); // from D6E_WORKSPACE_ID
```

Inject into paths, headers, or bodies as required — never trust the browser.

### Idempotent prompt rule registration

`scripts/init-workspace.mjs` SHA-256-hashes trimmed prompt content, compares
against existing rules via `GET /api/workspace-prompt-rules`, and skips POST on
match. Uses `D6E_INIT_REFRESH_TOKEN` (admin refresh — not end-user cookie).

## Quick Start

Minimal upload proxy (full pattern in
[`src/routes/api/upload/+server.ts`](../../src/routes/api/upload/+server.ts)):

```ts
// src/lib/server/env.ts
export function getD6eUrl(caller: string): string {
  return requireEnv('D6E_BASE_URL', caller).replace(/\/+$/, '');
}
export function getD6eWorkspaceId(caller: string): string {
  return requireEnv('D6E_WORKSPACE_ID', caller);
}
```

```ts
// src/routes/api/upload/+server.ts (essence)
export const POST: RequestHandler = async (event) => {
  const accessToken = requireAccessToken(event, '/api/upload');
  const file = /* parse multipart */;
  const uploaded = await uploadFile('/api/upload', accessToken, {
    filename: file.name,
    contentType: file.type,
    content: Buffer.from(await file.arrayBuffer()),
    signal: event.request.signal
  });
  return json({ fileId: uploaded.id, filename: uploaded.filename, … });
};
```

File download proxy (this repo):
[`src/routes/api/files/[fileId]/download/+server.ts`](../../src/routes/api/files/%5BfileId%5D/download/+server.ts).

## Reference

Detailed guides (read before implementing):

| Document | Contents |
| -------- | -------- |
| [references/download-two-step.md](references/download-two-step.md) | **Critical** — saas-proxy-download → storage id → streaming GET proxy; no 302 |
| [references/saas-proxy-download.md](references/saas-proxy-download.md) | Full request/response schema, editor permission, `suggested_filename`, metadata |
| [references/file-storage.md](references/file-storage.md) | List/get/multipart/JSON upload/delete/download; `X-Workspace-ID`; silent null metadata |
| [references/platform-timeouts.md](references/platform-timeouts.md) | Vercel `maxDuration`/`waitUntil` vs Cloudflare ~30s CPU; streaming patterns |
| [references/sql.md](references/sql.md) | Execute/preview, `uuidv7()`, 23-char tables, `POLICY_DENIED`, no GET /tables |
| [references/auth-header-matrix.md](references/auth-header-matrix.md) | Path vs header workspace resolution; full endpoint table |
| [references/size-limits.md](references/size-limits.md) | 10 MB JSON proxy / 100 MB download / 1 GB storage; app upload caps |
| [references/async-intent-jobs.md](references/async-intent-jobs.md) | Create/poll/cancel, heartbeat, concurrency, guardrails |

Also documented in this skill (no separate reference file):

- **Drive Sync** — `/api/v1/drive-sync/*`; pin `workspace_id` in body/query.
  Upstream: [`drive_sync.rs`](https://github.com/d6e-ai/d6e/blob/main/packages/api/src/routes/v1/drive_sync.rs).
- **SaaS JSON proxy** — `POST /api/v1/saas-proxy`; 10 MB cap. Prerequisite:
  connect provider in d6e console settings.
- **Workspace data APIs** — documents, embeddings, pinned charts, STFs, effects,
  policies, members, invitations. Inventory in
  [`d6e-cloud.ts`](https://gitlab.com/cauchye/d6e-ai/d6e/-/blob/main/packages/frontend/src/lib/server/d6e-cloud.ts).
- **Chat sessions** — Cookie auth CRUD; title conventions in
  [`src/lib/journal-title.ts`](../../src/lib/journal-title.ts).
- **Integration doc** — [docs/d6e-api-integration.md](../../docs/d6e-api-integration.md).

### `src/lib/server/d6e-client.ts` API (this repo)

| Function | Auth | Purpose |
| -------- | ---- | ------- |
| `uploadFile` | Bearer + `X-Workspace-ID` | Multipart upload → `{ id, … }` |
| `deleteFile` | Bearer + `X-Workspace-ID` | Best-effort delete (404 = ok) |
| `executeByIntent` | Bearer | Sync NL workflow; default 270s timeout |
| `createAsyncIntentJob` | Bearer | Returns `{ jobId }` immediately |
| `getAsyncIntentJobStatus` | Bearer | Poll status / toolTrace / result |
| `cancelAsyncIntentJob` | Bearer | Cooperative cancel |
| `verifyWorkspaceMembership` | Bearer | Allow-list probe for `/auth/callback` |
| `listChatSessions` / CRUD | Cookie | Chat persistence |

### `D6eClientError`

Non-standard `499` for client abort; `504` + `timedOut` for wrapper timeout.
Surface `timedOut` / `aborted` in JSON responses for UI branching.

### Route handler template

```ts
const CALLER_TAG = '/api/<your-route>';

export const POST: RequestHandler = async (event) => {
  const accessToken = requireAccessToken(event, CALLER_TAG);
  try {
    // call d6e-client helper with signal: event.request.signal
  } catch (err) {
    if (err instanceof D6eClientError) {
      return json({ error: err.message, timedOut: err.timedOut, aborted: err.aborted },
        { status: err.status });
    }
    return json({ error: String(err) }, { status: 500 });
  }
};
```

## Implementation Checklist

- [ ] Every d6e-client function takes `caller: string` first; `accessToken` explicit.
- [ ] All fetches use `AbortSignal.timeout(...)`; long routes accept external `signal`.
- [ ] Errors normalize to `D6eClientError`.
- [ ] Header-scoped routes send `X-Workspace-ID` from env (files, workflows, …).
- [ ] SQL proxy injects `{wsId}` from env into path; forward `{ error, code }`.
- [ ] Binary downloads stream through server — **never** 302 to `${D6E_BASE_URL}`.
- [ ] `saas-proxy-download` on 2xx → stream via `/api/files/{id}/download`.
- [ ] Cookie routes use `Cookie: auth-token=<jwt>`, never Bearer.
- [ ] Async job proxies never expose raw d6e job URLs to the browser.
- [ ] Drive Sync / saas-proxy bodies overwrite `workspace_id` server-side.
- [ ] Upload enforces app-side size cap before buffering (see size-limits ref).
- [ ] Bootstrap script SHA-256 idempotency; separate `D6E_INIT_REFRESH_TOKEN`.
- [ ] Logs use `[d6e-client]` / `[init-workspace]` prefixes.

## Troubleshooting

| Symptom | Likely cause | Details |
| ------- | ------------ | ------- |
| `/api/chat-sessions` 401, Bearer works elsewhere | Wrong auth transport | [auth-header-matrix.md](references/auth-header-matrix.md) |
| File multipart 400 empty body | Missing `X-Workspace-ID` or `file` part | [file-storage.md](references/file-storage.md) |
| SQL 403 `POLICY_DENIED` | Row policy blocked execute | [sql.md](references/sql.md) — preview won't catch this |
| SQL 400 `INVALID_TABLE` / 23 chars | Logical name too long | [sql.md](references/sql.md) |
| Workflow execute 400 missing header | No `X-Workspace-ID` | [auth-header-matrix.md](references/auth-header-matrix.md) |
| `executeByIntent` 402 | Billing / entitlement gate | Surface message; admin fixes billing |
| `executeByIntent` 504 timedOut | Wrapper shorter than LLM run | Lower timeout or use [async jobs](references/async-intent-jobs.md) |
| Async job 429 | 3 concurrent jobs / workspace | Wait or cancel |
| `saas-proxy` 404 credential | Provider not connected in console | Connect in d6e settings first |
| Download fails in browser | Called d6e URL directly | [download-two-step.md](references/download-two-step.md) |
| OOM on serverless download | Buffered full body | Stream + [platform-timeouts.md](references/platform-timeouts.md) |
| Drive `/sync` 200 but no data | Background job | Poll `/status` |
| `npm run init` duplicate rules | SHA mismatch | Normalize UTF-8/LF; delete orphan rule |
| Aborts as 499 | Intentional | Map `aborted` to "Request cancelled" UI |

## Related Skills

- [`d6e-auth-integration`](../d6e-auth-integration/SKILL.md) — OAuth, cookies,
  `event.locals.accessToken`, membership probe.
- [`d6e-prompt-driven-ui`](../d6e-prompt-driven-ui/SKILL.md) — LLM contract,
  prompt rules, journal parsing.
- External: [`d6e-saas-google-workspace`](https://github.com/d6e-ai/d6e/blob/main/packages/skills/d6e-saas-google-workspace/SKILL.md) —
  `drive_files` projection + MCP tools.
- Background: [Custom frontends and the d6e instance](../../docs/frontend-and-instance.md)
  ([日本語版](../../docs/frontend-and-instance.ja.md)).
