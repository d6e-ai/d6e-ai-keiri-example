# Two-step file download flow

External SaaS binaries and workspace `storage_file` rows share the same
**metadata-then-stream** pattern. The browser never calls d6e directly — it
hits a same-origin proxy that attaches Bearer auth server-side.

## Why two steps?

1. **Step 1 (JSON)** — resolve or ingest the file and get a stable
   `storage_file` UUID plus metadata.
2. **Step 2 (binary stream)** — fetch bytes with Bearer + `X-Workspace-ID`
   and relay them to the browser without exposing `${D6E_BASE_URL}`.

Do **not** 302-redirect the browser to `${D6E_BASE_URL}/api/v1/.../download`.
The JWT lives in an HTTP-only cookie; client-side JavaScript cannot attach
`Authorization: Bearer`. A redirect would either fail auth or leak the
upstream URL pattern.

## Flow A — file already in workspace storage

Use when you already have a `fileId` from upload, `saas-proxy-download`,
Drive Sync `/read`, or an LLM `files[]` output.

```
Browser  GET /api/files/{fileId}/download
    →  App proxy (reads access token from cookie / locals)
    →  GET ${D6E_BASE_URL}/api/v1/workspaces/{wsId}/files/{fileId}/download
         Authorization: Bearer <jwt>
         X-Workspace-ID: <wsId>          ← required; path {wsId} is ignored
         Accept: application/pdf         ← optional; upstream may ignore
    ←  binary stream (Content-Type, Content-Disposition, Content-Length)
    ←  App streams upstream.body to browser
```

The d6e handler resolves workspace exclusively from `X-Workspace-ID`
(`auth.workspace_id()`), not from the URL path segment.

## Flow B — download from external SaaS into storage, then stream

Use when server code (or a UI action) must pull a binary from freee / Google
Drive / Box / GitHub / etc. with the workspace's stored credential.

```
Server   POST ${D6E_BASE_URL}/api/v1/saas-proxy-download
             Authorization: Bearer <jwt>
             { workspace_id, provider, method, path, headers?, body?,
               suggested_filename?, metadata? }
         ←  2xx: { status, headers, id, filename, content_type, size, created_at }
         ←  non-2xx upstream: { status, headers, error_body }  (no storage row)

Browser  GET /api/files/{id}/download     ← same proxy as Flow A
```

On upstream **2xx**, d6e persists bytes to `storage_file` (100 MB cap) and
returns the new `id`. On upstream **non-2xx**, the JSON body includes
`error_body` and **no** `id` — do not attempt step 2.

See [saas-proxy-download.md](./saas-proxy-download.md) for the full request
schema and [size-limits.md](./size-limits.md) for cap comparison.

## Size caps (summary)

| Layer | Cap | Notes |
| ----- | --- | ----- |
| `POST /api/v1/saas-proxy` (JSON) | 10 MB response body | Use for API JSON, not PDFs |
| `POST /api/v1/saas-proxy-download` | 100 MB upstream body | Persisted to `storage_file` on 2xx |
| `storage_file` upload / download | 1 GB | PostgreSQL BYTEA practical limit |
| This example app upload proxy | 10 MB | Client-side guard before buffering |

## SvelteKit streaming proxy (official d6e console)

Canonical implementation in the d6e repo:

[`packages/frontend/src/routes/api/workspaces/[workspaceId]/files/[fileId]/download/+server.ts`](https://github.com/d6e-ai/d6e/blob/main/packages/frontend/src/routes/api/workspaces/%5BworkspaceId%5D/files/%5BfileId%5D/download/+server.ts)

Essence — cookie → Bearer, stream `upstream.body`, forward content headers:

```ts
import type { RequestHandler } from '@sveltejs/kit';
import { accessTokenCookieName } from '$lib/server/auth';
import { env } from '$env/dynamic/private';

const apiBase = () => env.D6E_API_URL || 'http://api:8080';

export const GET: RequestHandler = async ({ params, cookies, request }) => {
  const token = cookies.get(accessTokenCookieName);
  if (!token) return new Response('Unauthorized', { status: 401 });

  const { workspaceId, fileId } = params;
  if (!workspaceId || !fileId) {
    return new Response('Workspace ID and file ID are required', { status: 400 });
  }

  const upstreamUrl =
    `${apiBase()}/api/v1/workspaces/${workspaceId}/files/${fileId}/download`;

  const accept = request.headers.get('Accept');
  const upstreamHeaders: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'X-Workspace-ID': workspaceId
  };
  if (accept) upstreamHeaders.Accept = accept;

  const upstream = await fetch(upstreamUrl, { headers: upstreamHeaders });

  if (!upstream.ok) {
    const errText = await upstream.text();
    return new Response(errText || 'Download failed', { status: upstream.status });
  }

  const outHeaders = new Headers();
  for (const name of ['content-type', 'content-disposition', 'content-length']) {
    const v = upstream.headers.get(name);
    if (v) outHeaders.set(name, v);
  }

  if (!upstream.body) {
    return new Response('Empty response from storage API', { status: 502 });
  }

  return new Response(upstream.body, { status: 200, headers: outHeaders });
};
```

## This repo's example route

[`src/routes/api/files/[fileId]/download/+server.ts`](../../../src/routes/api/files/%5BfileId%5D/download/+server.ts)
pins `D6E_WORKSPACE_ID` from env (the browser never supplies workspace id)
and reads the token via `requireAccessToken()` instead of reading the cookie
directly.

Browser usage:

```html
<a href="/api/files/{fileId}/download" download>Download PDF</a>
```

Or fetch from client code against the same-origin URL — never against
`${D6E_BASE_URL}`.

## Proxy checklist

- [ ] Never redirect (302) the browser to `${D6E_BASE_URL}`.
- [ ] Always set `Authorization: Bearer` and `X-Workspace-ID` on step 2.
- [ ] Stream `upstream.body` — do not `await upstream.arrayBuffer()` for
      large files unless you accept OOM risk on Cloudflare Workers / Vercel.
- [ ] Forward `Content-Type`, `Content-Disposition`, and `Content-Length`
      when present.
- [ ] Validate `fileId` as UUID before forwarding.
- [ ] On upstream error, return upstream status + body text; do not mask as
      500 unless the fetch itself failed.

## Platform timeouts

Large downloads may exceed serverless CPU/wall-clock limits if you buffer
the entire body. See [platform-timeouts.md](./platform-timeouts.md).
