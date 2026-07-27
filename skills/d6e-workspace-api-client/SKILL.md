---
name: d6e-workspace-api-client
description: Builds the server-side proxy layer that lets a custom frontend talk to a d6e workspace — see references/api-catalog.md for the full endpoint inventory. Covers file upload/list/download/delete (two-step saas-proxy-download + streaming proxy), workspace SQL execute/preview, named workflow CRUD/execute, workspace member admin, execute-by-intent (sync and async job API), chat-session CRUD, workspace prompt rule registration, SaaS API calls via saas-proxy (+ binary saas-proxy-download), Google Drive sync mirror, embeddings/RAG (column, file, table row) without client provider keys, and pending-invitation admin. Use when adding a `/api/*` route that talks to d6e, when implementing file download via same-origin streaming proxy (never 302 to D6E_BASE_URL), when deploying on Vercel maxDuration/waitUntil or Cloudflare Workers CPU limits, when surfacing SQL POLICY_DENIED to the UI, when sync execute-by-intent times out and you need async jobs with poll/cancel/heartbeat, when calling freee/Google/Notion with workspace-stored credentials, or when confused whether your app needs GEMINI_API_KEY / OPENAI_API_KEY for chat or embeddings (it does not — instance AI Gateway handles provider routing).
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
- **Embeddings / RAG without client provider keys** — Bearer JWT to Rust
  embedding APIs; instance `EMBEDDING_MODEL` + AI Gateway. Do **not** add
  `GEMINI_API_KEY` to custom FE `.env`. See
  [references/llm-and-embedding-keys.md](references/llm-and-embedding-keys.md),
  [references/embeddings.md](references/embeddings.md), and
  [references/rag-recipes.md](references/rag-recipes.md).

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
- "Do I need GEMINI_API_KEY / OPENAI_API_KEY for embeddings or chat?" /
  "カスタムFEに Gemini API キーは必要？" — **No**; see
  [llm-and-embedding-keys.md](references/llm-and-embedding-keys.md)
- "Build RAG over uploaded files or SQL tables" — [rag-recipes.md](references/rag-recipes.md)
- "Persist chat history / list sessions / generate titles" — [chat-sessions.md](references/chat-sessions.md)

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
| [references/api-catalog.md](references/api-catalog.md) | **Master index** — every useful `/api/v1` + BFF endpoint; auth column; detail links |
| [references/workspaces.md](references/workspaces.md) | Workspace CRUD — PATCH policy groups, custom_prompt, auto_embed, Cookie subset |
| [references/redirect-uris.md](references/redirect-uris.md) | OAuth redirect URI admin — Rust Bearer + Cookie BFF |
| [references/chat-sessions.md](references/chat-sessions.md) | Chat session CRUD, UIMessage persistence, generate-title, 409 guard |
| [references/transcribe.md](references/transcribe.md) | Whisper `GET/POST /api/transcribe` — Cookie, 25 MB, instance OPENAI_API_KEY |
| [references/console-bff-catalog.md](references/console-bff-catalog.md) | Cookie BFF vs Rust dual routes — sql, files, chat, settings, … |
| [references/saas-oauth-bff.md](references/saas-oauth-bff.md) | SaaS OAuth/PAT connect — Cookie BFF (custom FE can drive connect) |
| [references/chat-streaming.md](references/chat-streaming.md) | POST /api/chat UIMessage stream — MCP, SQL HITL, memory, compaction |
| [references/mcp-rest-map.md](references/mcp-rest-map.md) | MCP tools ↔ REST; MCP-only tools; chat vs execute-by-intent |
| [references/websocket.md](references/websocket.md) | GET /ws Bearer — RowInserted/Updated/Deleted |
| [references/workspace-skills-bff.md](references/workspace-skills-bff.md) | Skills discover/upload/install BFF + public skill markdown pull |
| [references/memories-mcp-settings.md](references/memories-mcp-settings.md) | MCP servers, memories, workspace-settings, POST /api/verify |
| [references/auth-header-matrix.md](references/auth-header-matrix.md) | Path vs header workspace resolution; Cookie vs Bearer |
| [../d6e-auth-integration/references/custom-frontend-auth-decision-tree.md](../d6e-auth-integration/references/custom-frontend-auth-decision-tree.md) | Auth decision tree — Cookie BFF vs `d6e_*` key; never browser API keys |
| [references/download-two-step.md](references/download-two-step.md) | **Critical** — saas-proxy-download → storage id → streaming GET proxy; no 302 |
| [references/saas-proxy-download.md](references/saas-proxy-download.md) | Full request/response schema, editor permission, `suggested_filename`, metadata |
| [references/saas-proxy.md](references/saas-proxy.md) | JSON SaaS proxy, 10 MB cap, `file_id` multipart, vs saas-proxy-download |
| [references/file-storage.md](references/file-storage.md) | List/get/multipart/JSON upload/delete/download; `X-Workspace-ID`; silent null metadata |
| [references/documents.md](references/documents.md) | Document CRUD + versions; header-scoped; list omits content |
| [references/sql.md](references/sql.md) | Execute/preview, `uuidv7()`, 23-char tables, `POLICY_DENIED`, no GET /tables |
| [references/llm-and-embedding-keys.md](references/llm-and-embedding-keys.md) | **No client provider keys** — gateway, env by role, embedding errors |
| [references/embeddings.md](references/embeddings.md) | Column / file / table embeddings; sync vs async; status; permissions |
| [references/rag-recipes.md](references/rag-recipes.md) | File / table / column RAG — upload, embed, poll, search, LLM |
| [references/workflows.md](references/workflows.md) | Workflow CRUD + execute; list-by-name pattern; Docker STF 120s tip |
| [references/workflow-step-schemas.md](references/workflow-step-schemas.md) | `input_steps` / `stf_steps` / `effect_steps` JSON shapes |
| [references/billing-entitlement.md](references/billing-entitlement.md) | 402 LLM soft gate — UI handling; entitlement is service JWT only |
| [references/stfs-and-effects.md](references/stfs-and-effects.md) | STFs, versions, secrets, instant-run, describe; Effects + versions |
| [references/policies.md](references/policies.md) | Policies + policy-groups CRUD; operations/modes; editor permission |
| [references/pinned-charts.md](references/pinned-charts.md) | Dashboard charts; `sql_query` + `chart_type`; visible-only list |
| [references/members-and-invitations.md](references/members-and-invitations.md) | Members CRUD; `LAST_ADMIN`; discriminated POST; invitation admin |
| [references/workspace-setup.md](references/workspace-setup.md) | `/setup/*` Bearer routes — prompt-rules, skills, templates, dashboard, saas-credentials |
| [references/api-keys-and-audit.md](references/api-keys-and-audit.md) | API keys (session-only); audit-logs GET with filters |
| [references/drive-sync.md](references/drive-sync.md) | Drive sync config/roots/sync/status/materialize/read/picker |
| [references/platform-timeouts.md](references/platform-timeouts.md) | Vercel `maxDuration`/`waitUntil` vs Cloudflare ~30s CPU; streaming patterns |
| [references/size-limits.md](references/size-limits.md) | 10 MB JSON proxy / 100 MB download / 1 GB storage; app upload caps |
| [references/async-intent-jobs.md](references/async-intent-jobs.md) | Create/poll/cancel, heartbeat, concurrency, guardrails |

Also documented in this skill:

- **Chat streaming** — `POST /api/chat` UIMessage MCP agent (Cookie); see
  [chat-streaming.md](references/chat-streaming.md). Not interchangeable with
  execute-by-intent.
- **SaaS OAuth connect** — Cookie BFF `/api/saas-auth/*` — custom frontends
  can drive connect via same-origin proxy; see
  [saas-oauth-bff.md](references/saas-oauth-bff.md).
- **Chat sessions** — Cookie auth CRUD; title conventions in
  [`src/lib/journal-title.ts`](../../src/lib/journal-title.ts). Full API:
  [chat-sessions.md](references/chat-sessions.md). Cookie vs Bearer:
  [auth-header-matrix.md](references/auth-header-matrix.md) and
  [api-catalog.md § SvelteKit Cookie surfaces](references/api-catalog.md).
- **Integration doc** — [docs/d6e-api-integration.md](../../docs/d6e-api-integration.md).
- **Canonical console wrappers** —
  [`d6e-cloud.ts`](https://gitlab.com/cauchye/d6e-ai/d6e/-/blob/main/packages/frontend/src/lib/server/d6e-cloud.ts)
  (implementation reference; prefer [api-catalog.md](references/api-catalog.md) for discovery).

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
| `saas-proxy` 404 credential | Provider not connected | Connect via [saas-oauth-bff.md](references/saas-oauth-bff.md) |
| `503 EMBEDDING_NOT_CONFIGURED` | Instance missing embedding env | Operator fixes `EMBEDDING_MODEL` + gateway — [llm-and-embedding-keys.md](references/llm-and-embedding-keys.md) |
| `400 EMPTY_FILE_IDS` on file embed | Empty or missing `file_ids` | List files; pass explicit IDs — [embeddings.md](references/embeddings.md) |
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
