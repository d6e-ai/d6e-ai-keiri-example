# Workspace embeddings API

Three embedding surfaces under `/api/v1/workspaces/{id}/embeddings/…`:

1. **Column** — vectorize a SQL table column for similarity search
2. **Files** — semantic search over uploaded storage files
3. **Tables** — row-level JSON embedding across workspace tables

All routes resolve workspace from the **path** `{id}` plus membership check.
`X-Workspace-ID` is optional; if sent it must match the path. See
[auth-header-matrix.md](./auth-header-matrix.md).

Generate/embed/regenerate endpoints start **background jobs**. Poll the
corresponding status endpoint until completion before calling search.

## Auth (all routes)

```
Authorization: Bearer <jwt>
Content-Type: application/json
```

Pin `{id}` from `getD6eWorkspaceId(caller)`.

---

## Column embeddings (`/embeddings/`)

| Method | Path | Purpose |
| ------ | ---- | ------- |
| `POST` | `…/embeddings/generate` | Start column embedding for a table |
| `GET` | `…/embeddings/status?table_name=` | Job status for table |
| `POST` | `…/embeddings/similarity-search` | Vector search on embedded column |

### Generate

```json
POST /api/v1/workspaces/{wsId}/embeddings/generate
{
  "table_name": "invoices",
  "column_name": "description"
}
```

### Status

```
GET /api/v1/workspaces/{wsId}/embeddings/status?table_name=invoices
```

Poll until status indicates completion or failure before searching.

### Similarity search

```json
POST /api/v1/workspaces/{wsId}/embeddings/similarity-search
{
  "table_name": "invoices",
  "column_name": "description",
  "query": "office supplies receipt",
  "limit": 10
}
```

Returns ranked rows with similarity scores.

---

## File embeddings (`/embeddings/files/`)

| Method | Path | Purpose |
| ------ | ---- | ------- |
| `POST` | `…/files/embed` | Start embedding for file(s) |
| `GET` | `…/files/status` | Status for all / recent file jobs |
| `POST` | `…/files/search` | Semantic search over embedded files |
| `POST` | `…/files/regenerate` | Re-embed after content change |

### Embed

```json
POST /api/v1/workspaces/{wsId}/embeddings/files/embed
{
  "file_ids": ["<uuid>", "<uuid>"]
}
```

Omit `file_ids` to embed all eligible files (workspace auto-embed settings
may also trigger embedding on upload).

### Search

```json
POST /api/v1/workspaces/{wsId}/embeddings/files/search
{
  "query": "invoice total amount",
  "limit": 5
}
```

### Regenerate

Use after replacing file content or when embeddings are stale:

```json
POST /api/v1/workspaces/{wsId}/embeddings/files/regenerate
{
  "file_ids": ["<uuid>"]
}
```

---

## Table row embeddings (`/embeddings/tables/`)

| Method | Path | Purpose |
| ------ | ---- | ------- |
| `POST` | `…/tables/embed` | Start row JSON embedding for table(s) |
| `GET` | `…/tables/status` | Embedding job status |
| `POST` | `…/tables/search` | Cross-table semantic search |
| `POST` | `…/tables/regenerate` | Re-embed table rows |

### Embed

```json
POST /api/v1/workspaces/{wsId}/embeddings/tables/embed
{
  "table_names": ["invoices", "vendors"]
}
```

Logical table names (23-char max) — rewritten to prefixed physical names
internally. See [sql.md](./sql.md).

### Search

```json
POST /api/v1/workspaces/{wsId}/embeddings/tables/search
{
  "query": "unpaid invoices over 10000",
  "limit": 10
}
```

---

## Polling pattern

Long embedding jobs return immediately with a queued/running status. Custom
frontend proxies should:

1. Call generate/embed/regenerate
2. Poll status every 2–5 s with backoff
3. Surface progress in UI
4. Call search only after status reports success

On serverless, avoid blocking a single HTTP request for the full embed — return
job id to the browser and poll from a lightweight status route.

## Workspace auto-embed settings

PATCH `/api/v1/workspaces/{id}` accepts `auto_embed_files` and related flags
that trigger embedding on upload. Pair with file upload flows in
[file-storage.md](./file-storage.md).

## Related

- [sql.md](./sql.md) — table naming, logical names
- [file-storage.md](./file-storage.md) — files referenced by file embeddings
- [api-catalog.md](./api-catalog.md) — master index
