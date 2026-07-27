# Workspace file storage API

CRUD for `storage_file` rows scoped to a workspace. Files can be referenced
in `execute-by-intent` `inputFileRefs[]`, SaaS proxy `file_id`, and LLM MCP
tools (`d6e_view_image`, `d6e_extract_file_text`).

**Critical:** all routes under `/api/v1/workspaces/{wsId}/files/...` resolve
workspace from the **`X-Workspace-ID` header**, not the path `{wsId}`. The
handler ignores the path workspace segment. Always send both Bearer and
`X-Workspace-ID`.

## Endpoints

| Method | Path | Body | Response |
| ------ | ---- | ---- | -------- |
| `GET` | `…/files` | — | `FileMetadata[]` (no byte content) |
| `GET` | `…/files/{fileId}` | — | `FileMetadata` |
| `GET` | `…/files/{fileId}/download` | — | binary stream |
| `POST` | `…/files/multipart` | `multipart/form-data`: `file` + optional `metadata` | `UploadResponse` |
| `POST` | `…/files` | JSON base64 upload (alternative) | `UploadResponse` |
| `DELETE` | `…/files/{fileId}` | — | 204 |

### Auth (all routes)

```
Authorization: Bearer <jwt>
X-Workspace-ID: <wsId>
```

Upload and saas-proxy-download also require **editor** permission on
`storage_file` (policy-gated).

## Types

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

interface UploadResponse {
  id: string;
  filename: string;
  content_type: string;
  size: number;
  created_at: string;
}
```

## Multipart upload

```
POST /api/v1/workspaces/{wsId}/files/multipart
Content-Type: multipart/form-data

file:     <binary>   (required; must have filename)
metadata: {"source":"my-app"}   (optional JSON string)
```

**Metadata parsing:** if the `metadata` part is present but not valid JSON,
d6e **silently sets metadata to `null`** — no 400. Validate JSON in your
proxy if you need strict behaviour.

**Common 400 causes:**

- Missing `file` part or empty filename
- Missing / invalid `X-Workspace-ID`
- Invalid base64 (JSON upload path only)

**413:** file exceeds 1 GB server cap.

This repo enforces **10 MB** in [`src/routes/api/upload/+server.ts`](../../../src/routes/api/upload/+server.ts) before forwarding.

## JSON upload (base64 alternative)

```
POST /api/v1/workspaces/{wsId}/files
Content-Type: application/json

{
  "filename": "report.pdf",
  "content_type": "application/pdf",
  "content": "<base64>",
  "metadata": { "source": "my-app" }
}
```

Prefer multipart for browser uploads — base64 expands size ~33%.

## Auto-embed on upload

When the workspace has **`auto_embed_files`** enabled (Workspace Settings →
Auto-Embedding), successful uploads queue background file embedding
(`maybe_auto_embed_file` in
[`storage_file.rs`](https://github.com/d6e-ai/d6e/blob/main/packages/api/src/routes/v1/storage_file.rs)).

Requirements (all must be true):

- Workspace flag `auto_embed_files = true`
- Instance embedding config present
- Multimodal embedding client available (`gemini-embedding-2*` class)

Embedding is **fire-and-forget** — the upload response returns before vectors
are ready. Poll `GET …/embeddings/files/status` or search after completion.
See [embeddings.md](./embeddings.md).

## List and metadata

`GET …/files` runs a lightweight query excluding the BYTEA column (up to
1 GB per row). Safe for file-picker UIs.

`GET …/files/{fileId}` returns 404 when the row is soft-deleted or belongs
to another workspace (header mismatch).

## Download

```
GET /api/v1/workspaces/{wsId}/files/{fileId}/download
Authorization: Bearer <jwt>
X-Workspace-ID: <wsId>
Accept: application/pdf          ← optional; forwarded by your proxy
```

Returns `Content-Type`, `Content-Disposition: attachment; filename="…"`,
and `Content-Length`. Max file size **1 GB**.

The browser must **not** call this URL directly. Stream through a same-origin
proxy — see [download-two-step.md](./download-two-step.md).

## Delete

`DELETE …/files/{fileId}` soft-deletes the row. Treat **404 as success** in
your wrapper — the file may already be gone (parallel tab, GC, prior cleanup).

This repo: [`deleteFile()`](../../../src/lib/server/d6e-client.ts) and
[`DELETE /api/upload/{fileId}`](../../../src/routes/api/upload/%5BfileId%5D/+server.ts).

## Wrapper sketch

```ts
export async function listFiles(
  caller: string,
  accessToken: string
): Promise<FileMetadata[]> {
  const apiUrl = getD6eUrl(caller);
  const workspaceId = getD6eWorkspaceId(caller);

  const response = await fetch(
    `${apiUrl}/api/v1/workspaces/${workspaceId}/files`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'X-Workspace-ID': workspaceId
      },
      signal: AbortSignal.timeout(30_000)
    }
  );
  // … parse JSON or throw D6eClientError
}
```

## Size limits

See [size-limits.md](./size-limits.md) for the 10 MB / 100 MB / 1 GB matrix.

## Upstream reference

[d6e `packages/api/src/routes/v1/storage_file.rs`](https://github.com/d6e-ai/d6e/blob/main/packages/api/src/routes/v1/storage_file.rs)
