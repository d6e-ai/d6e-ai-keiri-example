# SaaS proxy download — `POST /api/v1/saas-proxy-download`

Binary counterpart to `POST /api/v1/saas-proxy`. Downloads a file from an
external SaaS provider using the workspace's stored credential, persists it
to `storage_file` on upstream **2xx**, and returns metadata so step 2 of
[download-two-step.md](./download-two-step.md) can stream bytes to the browser.

The MCP tool `d6e_download_external_file` calls this endpoint internally.

## Prerequisites

- Workspace **admin** must connect the provider in the d6e console settings
  (SaaS integrations). There is no API to create credentials from a custom
  frontend.
- Caller must be a workspace **member** with **editor** permission on
  `storage_file` (same gate as multipart upload). Policy-restricted members
  receive `403 Forbidden`.

## Auth

```
Authorization: Bearer <jwt>
Content-Type: application/json
```

Pin `workspace_id` server-side to `D6E_WORKSPACE_ID`. Do not forward a
browser-supplied workspace id.

## Request body

```json
{
  "workspace_id": "<UUID>",
  "provider": "google_workspace",
  "method": "GET",
  "path": "/drive/v3/files/{fileId}?alt=media",
  "headers": {},
  "body": null,
  "suggested_filename": "invoice-2025-01.pdf",
  "metadata": { "source": "my-app", "external_id": "..." }
}
```

| Field | Required | Description |
| ----- | -------- | ----------- |
| `workspace_id` | yes | Workspace UUID — pin from env |
| `provider` | yes | Catalog id: `freee`, `google_workspace`, `notion`, `github`, `salesforce`, `box`, `moneyforward`, `chatwork`, `zendesk`, … |
| `method` | yes | `GET`, `POST`, `PUT`, `PATCH`, `DELETE` |
| `path` | yes | Appended to the provider's base URL (must start with `/`) |
| `headers` | no | Extra headers; `authorization`, `cookie`, `host`, `x-chatworktoken` are **discarded** |
| `body` | no | JSON body for non-GET requests (sent as `application/json`) |
| `suggested_filename` | no | Highest-priority filename hint when saving to storage |
| `metadata` | no | JSON stored on the resulting `storage_file` row |

Notes:

- OAuth tokens are injected and refreshed automatically from
  `saas_credential`.
- The download client follows HTTPS redirects (up to 10 hops) — required for
  Box, Google Drive, and GitHub raw URLs. The JSON proxy does **not** follow
  redirects (SSRF policy).
- `404 No credential found for provider=…` means the provider was never
  connected for this workspace.

## Response — upstream 2xx (storage row created)

HTTP 200 from d6e with JSON:

```json
{
  "status": 200,
  "headers": { "content-type": "application/pdf", "...": "..." },
  "id": "019bbac4-68a4-71d3-8928-8b32cabec841",
  "filename": "invoice-2025-01.pdf",
  "content_type": "application/pdf",
  "size": 245760,
  "created_at": "2025-01-15T10:30:00Z"
}
```

| Field | Description |
| ----- | ----------- |
| `status` | Upstream HTTP status (2xx) |
| `headers` | Filtered upstream response headers |
| `id` | New `storage_file` UUID — use in step-2 download |
| `filename` | Resolved name (see filename resolution below) |
| `content_type` | MIME type used when persisting |
| `size` | Byte length |
| `created_at` | Row creation timestamp |

Filename resolution order:

1. `suggested_filename` (caller)
2. `Content-Disposition` (`filename*` or `filename=`)
3. Last URL path segment containing a dot
4. `download-<short-uuid>`

## Response — upstream non-2xx (no storage row)

```json
{
  "status": 404,
  "headers": { "...": "..." },
  "error_body": { "error": { "code": 404, "message": "File not found" } }
}
```

`id`, `filename`, `content_type`, `size`, and `created_at` are **omitted**.
Do not call the download endpoint — surface `error_body` to the user instead.

## Wrapper example

```ts
export async function saasProxyDownload(
  caller: string,
  accessToken: string,
  payload: {
    provider: string;
    method: string;
    path: string;
    headers?: Record<string, string>;
    body?: unknown;
    suggestedFilename?: string;
    metadata?: Record<string, unknown>;
  }
): Promise<SaasProxyDownloadResponse> {
  const apiUrl = getD6eUrl(caller);
  const workspaceId = getD6eWorkspaceId(caller);

  const response = await fetch(`${apiUrl}/api/v1/saas-proxy-download`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      workspace_id: workspaceId,
      provider: payload.provider,
      method: payload.method,
      path: payload.path,
      headers: payload.headers ?? {},
      body: payload.body ?? null,
      suggested_filename: payload.suggestedFilename ?? null,
      metadata: payload.metadata ?? null
    }),
    signal: AbortSignal.timeout(120_000)
  });

  const json = await response.json();
  if (!response.ok) {
    throw new D6eClientError(
      `saasProxyDownload failed (caller=${caller}): ${response.status}`,
      response.status,
      JSON.stringify(json).slice(0, 500),
      { timedOut: false, aborted: false }
    );
  }
  return json;
}
```

After a successful response, stream the file to the browser via
[`/api/files/{id}/download`](../../../src/routes/api/files/%5BfileId%5D/download/+server.ts).

## Comparison with JSON saas-proxy

| | `saas-proxy` | `saas-proxy-download` |
| --- | --- | --- |
| Response body to caller | `{ status, headers, body }` JSON | `{ status, headers, id?, … }` or `{ error_body }` |
| Upstream body cap | 10 MB | 100 MB |
| Persists to storage | no | yes (on 2xx) |
| Follows redirects | no | yes (HTTPS only) |
| Editor permission | member | member + storage editor policy |

## Upstream reference

[d6e `packages/api/src/routes/v1/saas_proxy_download.rs`](https://github.com/d6e-ai/d6e/blob/main/packages/api/src/routes/v1/saas_proxy_download.rs)
