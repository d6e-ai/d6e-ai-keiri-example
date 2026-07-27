# Workspace documents API

CRUD for Markdown documents scoped to a workspace. Supports co-authoring and
internal comms workflows. Content changes on PATCH automatically create a new
version row.

**Critical:** all routes under `/api/v1/workspaces/{wsId}/documents/...` resolve
workspace from the **`X-Workspace-ID` header**, not the path `{wsId}`. The
handler ignores the path workspace segment. Always send both Bearer and
`X-Workspace-ID`. See [auth-header-matrix.md](./auth-header-matrix.md).

## Endpoints

| Method | Path | Body | Response |
| ------ | ---- | ---- | -------- |
| `GET` | `…/documents` | query: `doc_type?`, `status?` | `DocumentListItem[]` (no content) |
| `POST` | `…/documents` | create payload | `DocumentResponse` |
| `GET` | `…/documents/{docId}` | — | `DocumentResponse` (includes content) |
| `PATCH` | `…/documents/{docId}` | partial update | `DocumentResponse` |
| `DELETE` | `…/documents/{docId}` | — | 204 |
| `GET` | `…/documents/{docId}/versions` | — | version history array |

### Auth (all routes)

```
Authorization: Bearer <jwt>
X-Workspace-ID: <wsId>
Content-Type: application/json
```

Pin `{wsId}` from `getD6eWorkspaceId(caller)` — never from the browser.

## Types

**List item** (GET collection — content omitted for efficiency):

```ts
interface DocumentListItem {
  id: string;
  workspace_id: string;
  title: string;
  doc_type: string;
  status: string;
  metadata?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}
```

**Full document** (GET one, POST, PATCH):

```ts
interface DocumentResponse {
  id: string;
  workspace_id: string;
  title: string;
  doc_type: string;
  status: string;
  content: string;           // Markdown text only
  metadata?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}
```

## Create

```json
POST /api/v1/workspaces/{wsId}/documents
{
  "title": "Q1 planning notes",
  "doc_type": "memo",
  "status": "draft",
  "content": "# Heading\n\nBody text.",
  "metadata": { "author": "ops" }
}
```

## Update and versioning

PATCH accepts partial fields (`title`, `doc_type`, `status`, `content`,
`metadata`). When `content` changes, the API snapshots the previous content into
`document_version` before applying the update.

List versions:

```
GET /api/v1/workspaces/{wsId}/documents/{docId}/versions
X-Workspace-ID: <wsId>
```

Each version entry includes historical content and timestamps for rollback UI.

## List filters

Optional query parameters on GET collection:

| Param | Purpose |
| ----- | ------- |
| `doc_type` | Filter by document type string |
| `status` | Filter by status string (e.g. `draft`, `published`) |

## Limitations

- Content is **Markdown text only** — no binary attachments on the document row.
  Attach files via [file-storage.md](./file-storage.md) and reference ids in
  `metadata`.
- Soft delete — DELETE sets `deleted_at`; deleted docs are excluded from list.

## Common mistakes

| Symptom | Cause | Fix |
| ------- | ----- | --- |
| 400 empty body on list | Missing `X-Workspace-ID` | Set header from env |
| 403 | Not a workspace member, or scoped JWT `d6e_workspace_id` ≠ `X-Workspace-ID` | Verify membership; pin header from env — documents do **not** use storage/document editor policies |
| List missing `content` | By design | GET single doc for full body |

## Related

- [file-storage.md](./file-storage.md) — binary attachments
- [billing-entitlement.md](./billing-entitlement.md) — 402 LLM soft gate (not document policy)
- [api-catalog.md](./api-catalog.md) — master index
