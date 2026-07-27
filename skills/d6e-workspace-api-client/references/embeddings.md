# Workspace embeddings API

> **No Gemini key in your app.** Custom frontends never send `GEMINI_API_KEY`,
> `GOOGLE_API_KEY`, or `OPENAI_API_KEY` for embeddings. The d6e instance calls
> the Vercel AI Gateway with operator-configured `EMBEDDING_MODEL`. Your proxy
> only forwards Bearer JWT. Full role matrix:
> [llm-and-embedding-keys.md](./llm-and-embedding-keys.md).

Three embedding surfaces under `/api/v1/workspaces/{id}/embeddings/…`:

1. **Column** — vectorize a SQL table column for similarity search (**sync**
   generate)
2. **Files** — semantic search over uploaded storage files (**async** jobs)
3. **Tables** — row-level JSON embedding across workspace tables (**async**
   jobs)

RAG walkthroughs (upload → embed → poll → search → LLM):
[rag-recipes.md](./rag-recipes.md).

All routes resolve workspace from the **path** `{id}` plus membership check.
`X-Workspace-ID` is optional; if sent it must match the path. See
[auth-header-matrix.md](./auth-header-matrix.md).

## Auth (all routes)

```
Authorization: Bearer <jwt>
Content-Type: application/json
```

Pin `{id}` from `getD6eWorkspaceId(caller)`.

---

## Sync vs async

| Surface | Trigger | Completion | Response hint |
| ------- | ------- | ---------- | ------------- |
| Column `POST …/generate` | Single request runs embed loop | **Synchronous** | `generated_count`, `column_added` |
| Files `POST …/files/embed` | Queues background tasks | **Async** — poll `GET …/files/status` | Per-file `status` in embed response |
| Tables `POST …/tables/embed` | Spawns background worker | **Async** — poll `GET …/tables/status` | Per-table `status` in embed response |

Do not call search until embeddings are `completed` (files/tables) or
`generated_count` reflects your data (column). On serverless, return job state
to the browser and poll from a lightweight status route.

---

## Permissions

| Operation | Column | Files | Table rows |
| --------- | ------ | ----- | ---------- |
| Generate / embed / regenerate | Member + **DDL** (`DDL_FORBIDDEN`) | Member + **storage editor** | Member + **DDL** |
| Status / search | Member (policies apply to row counts / search) | Member | Member |

File embed/regenerate checks `WorkspaceResource::StorageFile` editor policy.
Column and table row embed check DDL permission because they alter schema or
`embedding_config`.

---

## Status values

### File embeddings (`file_embedding.status`)

| Status | Meaning |
| ------ | ------- |
| `pending` | Queued; background task not yet claimed |
| `processing` | Worker claimed the job |
| `completed` | Vector(s) stored; searchable |
| `failed` | Error in `error_message` |
| `skipped` | Intentionally skipped (e.g. unsupported MIME, oversized inline payload) |

`GET …/files/status` also reports `model_outdated` / `dimensions_outdated` when
instance `EMBEDDING_MODEL` changed. Stale `pending`/`processing` (> 30 min) is
reported as `failed` in the GET response (side-effect-free).

### Table row embeddings (`embedding_config.status`, `source_column = __row_json`)

| Status | Meaning |
| ------ | ------- |
| `pending` | Job claimed slot, worker starting |
| `processing` | Rows being embedded |
| `completed` | Row embeddings ready |
| `failed` | Error in `error_message` |

`GET …/tables/status` includes `total_rows`, `embedded_rows`, `pending_rows`,
`has_index`, and outdated flags per table.

### Column embeddings (`GET …/embeddings/status`)

Returns per-column `total`, `embedded`, `pending` counts from
`embedding_config` — not the same enum as file rows. Use after generate if you
need to confirm pending rows under row policies.

---

## Workspace auto-embed settings

`PATCH /api/v1/workspaces/{id}` (Bearer, path-scoped) accepts:

| Field | Effect |
| ----- | ------ |
| `auto_embed_files` | After upload / saas-proxy-download, queue file embed when multimodal model configured |
| `auto_embed_tables` | On SQL INSERT/UPDATE, re-embed rows for tables with existing row embedding config |

Both default `false`. File auto-embed requires `gemini-embedding-2*` multimodal
model on the instance. Table auto-embed only applies to tables already set up
via `POST …/tables/embed`.

Pair `auto_embed_files` with upload flows in [file-storage.md](./file-storage.md).

---

## Column embeddings (`/embeddings/`)

| Method | Path | Purpose |
| ------ | ---- | ------- |
| `POST` | `…/embeddings/generate` | Embed text column (**sync**) |
| `GET` | `…/embeddings/status?table_name=` | Column counts / config |
| `POST` | `…/embeddings/similarity-search` | Vector search on embedded column |

### Generate (synchronous)

```json
POST /api/v1/workspaces/{wsId}/embeddings/generate
{
  "table_name": "invoices",
  "column_name": "description"
}
```

**Response:**

```json
{
  "generated_count": 42,
  "column_added": true
}
```

Adds `{column}_embedding` vector column when missing, then embeds rows the
caller can UPDATE under policy. Re-call generate to fill pending rows.

### Status

```
GET /api/v1/workspaces/{wsId}/embeddings/status?table_name=invoices
```

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
| `POST` | `…/files/embed` | Start embedding for file(s) (**async**) |
| `GET` | `…/files/status` | Status for all embedded files |
| `POST` | `…/files/search` | Semantic search over embedded files |
| `POST` | `…/files/regenerate` | Re-embed after content change |

### Embed

```json
POST /api/v1/workspaces/{wsId}/embeddings/files/embed
{
  "file_ids": ["<uuid>", "<uuid>"]
}
```

**`file_ids` is required and must not be empty** (`400 EMPTY_FILE_IDS`). Maximum
50 IDs per request. There is no "embed all files" omit shortcut — list files via
`GET …/files` and pass explicit IDs (or enable `auto_embed_files` on upload).

Requires multimodal embedding model on instance; otherwise `503
MODEL_NOT_MULTIMODAL`.

### Search

```json
POST /api/v1/workspaces/{wsId}/embeddings/files/search
{
  "query": "invoice total amount",
  "limit": 5
}
```

Query embedding failures return `502 EMBEDDING_API_ERROR`.

### Regenerate

Use after replacing file content or when embeddings are stale:

```json
POST /api/v1/workspaces/{wsId}/embeddings/files/regenerate
{
  "file_ids": ["<uuid>"]
}
```

Same `file_ids` rules as embed.

---

## Table row embeddings (`/embeddings/tables/`)

| Method | Path | Purpose |
| ------ | ---- | ------- |
| `POST` | `…/tables/embed` | Start row JSON embedding (**async**) |
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

## Operator errors (instance configuration)

| HTTP | Code | When |
| ---- | ---- | ---- |
| 503 | `EMBEDDING_NOT_CONFIGURED` | Missing `EMBEDDING_MODEL` or gateway credentials on instance |
| 503 | `MODEL_NOT_MULTIMODAL` | File embed when model is not `gemini-embedding-2*` |
| 502 | `EMBEDDING_API_ERROR` | Gateway/upstream embedding API failure |

Custom frontend developers fix these on the **instance** — see
[llm-and-embedding-keys.md](./llm-and-embedding-keys.md).

---

## Polling pattern (files and tables)

1. Call `embed` or `regenerate`
2. Poll status every 2–5 s with backoff
3. Surface progress in UI (`processing`, row counts, errors)
4. Call search only after `completed` (or acceptable partial state for column)

---

## Related

- [llm-and-embedding-keys.md](./llm-and-embedding-keys.md) — **no client provider keys**
- [rag-recipes.md](./rag-recipes.md) — file / table / column RAG recipes
- [sql.md](./sql.md) — table naming, logical names
- [file-storage.md](./file-storage.md) — files referenced by file embeddings
- [policies.md](./policies.md) — DDL and storage editor policies
- [api-catalog.md](./api-catalog.md) — master index
