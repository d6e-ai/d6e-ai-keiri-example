# Size limits

Caps at each layer of the d6e stack. Enforce **stricter app-side limits**
than upstream allows to avoid OOM on serverless proxies.

## Summary table

| Layer | Limit | Applies to |
| ----- | ----- | ---------- |
| JSON SaaS proxy | **10 MB** upstream response body | `POST /api/v1/saas-proxy` |
| SaaS binary download proxy | **100 MB** upstream body | `POST /api/v1/saas-proxy-download` |
| Workspace file storage | **1 GB** per file | upload, download, BYTEA column |
| This example app upload | **10 MB** | [`/api/upload`](../../../src/routes/api/upload/+server.ts) |
| Workspace prompt rule | **50,000 characters** | `POST /api/workspace-prompt-rules` |
| Async intent tool trace | **100 entries** | poll response `toolTrace` array |

## JSON SaaS proxy — 10 MB

`POST /api/v1/saas-proxy` buffers the upstream response into JSON
`{ status, headers, body }`. Bodies larger than 10 MB are truncated or
rejected.

**Use for:** REST JSON APIs (freee deals, Notion pages, GitHub metadata).

**Do not use for:** PDFs, Excel, images, Drive `alt=media` downloads.

→ Use [`saas-proxy-download`](./saas-proxy-download.md) instead (100 MB).

## SaaS proxy download — 100 MB

`POST /api/v1/saas-proxy-download` streams the upstream body with a
**100 MB cap** before persisting to `storage_file`.

Chosen to fit real binaries (PDF, XLSX, images) while staying well below
the 1 GB storage cap so a misbehaving upstream cannot exhaust workspace DB
memory.

On upstream 2xx, bytes are stored; on non-2xx, nothing is persisted
(see [download-two-step.md](./download-two-step.md)).

## Workspace file storage — 1 GB

`POST …/files/multipart`, JSON upload, and
`GET …/files/{id}/download` share a **1 GB** per-file limit
(PostgreSQL BYTEA practical bound).

Your proxy should:

- Reject uploads above your app cap **before** reading the full body.
- Stream downloads without buffering the entire file when possible.
- Size `AbortSignal.timeout` for large downloads (see
  [platform-timeouts.md](./platform-timeouts.md)).

## App-side upload caps

This repo enforces **10 MB** client-side:

```ts
const MAX_FILE_BYTES = 10 * 1024 * 1024; // src/routes/api/upload/+server.ts
```

Rationale:

- Receipt photos for AI journal flows are small.
- Serverless memory is limited (especially Cloudflare Workers ~128 MB).
- Malicious clients could stream multi-GB bodies and OOM the function before
  d6e returns 413.

Adjust per product needs, but stay below your hosting platform's body limit
and memory budget.

## SQL and table names

Not a byte limit — logical table names must be **≤ 23 characters** because
the workspace prefix consumes 40 of PostgreSQL's 63-char identifier limit.
See [sql.md](./sql.md).

## Quick decision guide

| User action | Endpoint | Effective cap |
| ----------- | -------- | ------------- |
| Upload receipt in this app | `/api/upload` → multipart | 10 MB (app) / 1 GB (d6e) |
| Pull PDF from Google Drive | saas-proxy-download | 100 MB |
| Call freee JSON API | saas-proxy | 10 MB response |
| Download stored file | files/{id}/download | 1 GB |
| LLM returns file in intent | storage from MCP | 1 GB storage |
