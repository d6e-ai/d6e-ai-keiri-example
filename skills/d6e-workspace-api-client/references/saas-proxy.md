# SaaS JSON proxy — `POST /api/v1/saas-proxy`

Server-side HTTP proxy to external SaaS APIs using workspace-stored OAuth
credentials. The LLM and browser never see raw tokens — only this endpoint
(resolved server-side) attaches auth headers.

Contrast with [saas-proxy-download.md](./saas-proxy-download.md) for binary
downloads that persist to storage, and [download-two-step.md](./download-two-step.md)
for streaming bytes to the browser.

## Prerequisites

- Workspace admin must connect the provider in d6e console (SaaS integrations).
  No API to create credentials from a custom frontend.
- Caller must be a workspace **member**.
- Provider string must match a connected credential (e.g. `google_workspace`,
  `freee`, `notion`).

List connected providers:

```
GET /api/v1/workspaces/{id}/setup/saas-credentials
```

See [workspace-setup.md](./workspace-setup.md).

## Auth

```
Authorization: Bearer <jwt>
Content-Type: application/json
```

Pin `workspace_id` in the JSON body to `D6E_WORKSPACE_ID`. Do not forward a
browser-supplied workspace id. See [auth-header-matrix.md](./auth-header-matrix.md).

## Request body

```json
{
  "workspace_id": "<UUID>",
  "provider": "google_workspace",
  "method": "GET",
  "path": "/drive/v3/files?q=mimeType='application/pdf'",
  "headers": {},
  "body": null,
  "file_id": null
}
```

| Field | Purpose |
| ----- | ------- |
| `workspace_id` | Target workspace (server-pinned) |
| `provider` | SaaS credential provider id |
| `method` | `GET`, `POST`, `PUT`, `PATCH`, or `DELETE` |
| `path` | Provider-relative path (not full URL) |
| `headers` | Extra headers — **cannot** override `Authorization`, `Cookie`, `Host` |
| `body` | JSON request body for POST/PUT/PATCH |
| `file_id` | Optional storage file id — see below |

### `file_id` — multipart upload from storage

When uploading binary from workspace storage to an external API:

| Pattern | Behavior |
| ------- | -------- |
| `file_id` only | Sends raw file bytes as body with stored content type |
| `file_id` + `body` | Multipart/related: JSON metadata + binary file |

Reference a file uploaded via [file-storage.md](./file-storage.md).

## Response

```json
{
  "status": 200,
  "headers": { "content-type": "application/json" },
  "body": { /* parsed JSON when content-type is JSON */ }
}
```

Non-JSON upstream bodies are returned as structured JSON wrappers or string
content depending on content-type — inspect `status` before using `body`.

## Size limit

**10 MB maximum response body** (`MAX_RESPONSE_BODY_SIZE`). Larger responses
return an error. For binary downloads, use
[saas-proxy-download.md](./saas-proxy-download.md) instead (100 MB cap, persists
to storage).

See [size-limits.md](./size-limits.md).

## Credential injection

The proxy:

1. Loads encrypted credential for `(workspace_id, provider)`
2. Refreshes OAuth token if expired (with row lock)
3. Sets provider-appropriate auth headers
4. Forwards the HTTP request
5. Strips sensitive response headers (`Set-Cookie`, `Server`, …)

Callers cannot inject `Authorization` — protected header list prevents token
exfiltration or override.

## Common errors

| Status | Cause |
| ------ | ----- |
| 404 | No credential for provider — connect in console first |
| 403 | Not a workspace member |
| 413 / 400 | Response or request body exceeds limit |
| 502 | Upstream SaaS error (check `status` in response body) |

## saas-proxy vs saas-proxy-download

| | `saas-proxy` | `saas-proxy-download` |
| --- | ------------ | --------------------- |
| Response | JSON metadata + parsed body | `{ storage_file_id, filename, … }` on 2xx |
| Size cap | 10 MB | 100 MB |
| Persists file | No | Yes — creates `storage_file` row |
| Browser delivery | Parse JSON in proxy | [download-two-step.md](./download-two-step.md) stream |
| Editor permission | Member | Member + **storage editor** policy |

## Example — list Drive files

```ts
const res = await fetch(`${getD6eUrl(caller)}/api/v1/saas-proxy`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    workspace_id: getD6eWorkspaceId(caller),
    provider: 'google_workspace',
    method: 'GET',
    path: "/drive/v3/files?pageSize=10&fields=files(id,name,mimeType)",
    headers: {},
    body: null
  }),
  signal: AbortSignal.timeout(30_000)
});
```

## Related

- [saas-proxy-download.md](./saas-proxy-download.md) — binary download path
- [drive-sync.md](./drive-sync.md) — mirrored Drive vs live API calls
- [size-limits.md](./size-limits.md) — caps table
- [api-catalog.md](./api-catalog.md) — master index
