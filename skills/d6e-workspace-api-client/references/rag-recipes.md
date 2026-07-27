# RAG recipes — embeddings without client provider keys

These recipes assume a **custom frontend** that proxies d6e with Bearer JWT
only. You do **not** call Google Gemini or OpenAI embedding APIs from your app.
The instance embeds via Vercel AI Gateway (`EMBEDDING_MODEL` on the operator's
side). See [llm-and-embedding-keys.md](./llm-and-embedding-keys.md).

Prerequisites for every recipe:

1. Instance operator configured `EMBEDDING_MODEL` + gateway credentials.
2. Your server pins `D6E_WORKSPACE_ID` and forwards `Authorization: Bearer`.
3. Poll async jobs before search (files and table rows).

---

## Recipe 1 — File RAG (PDFs, images, documents)

**Goal:** Upload a document, embed it, search by natural language, pass hits to
chat or execute-by-intent.

### Steps

1. **Upload** — `POST /api/v1/workspaces/{id}/files/multipart` with
   `X-Workspace-ID` ([file-storage.md](./file-storage.md)). Save `fileId`.
2. **Embed** — `POST …/embeddings/files/embed` with non-empty `file_ids`:

   ```json
   { "file_ids": ["<fileId>"] }
   ```

   Returns per-file status immediately (`pending` / `processing` / …); work
   continues in background.
3. **Poll** — `GET …/embeddings/files/status` every 2–5 s until target file
   `status` is `completed` (or `failed` / `skipped`).
4. **Search** — `POST …/embeddings/files/search`:

   ```json
   { "query": "total amount on invoice", "limit": 5 }
   ```

5. **Pass to LLM** — build context from search hits (filename, chunk labels,
   scores) and either:
   - `POST /api/chat` with that context in the user message or system prompt
     ([chat-streaming.md](./chat-streaming.md)), or
   - `POST /api/workflows/execute-by-intent` with `message` describing the task
     plus `inputFileRefs` if the model should see the file bytes
     ([async-intent-jobs.md](./async-intent-jobs.md)).

### Optional automation

`PATCH /api/v1/workspaces/{id}` with `auto_embed_files: true` queues embedding
on upload when the instance uses a multimodal model (`gemini-embedding-2*`).

### Permissions

- Embed / regenerate: storage **editor** policy on `storage_file`.
- Status / search: workspace **member**.

---

## Recipe 2 — Table row RAG (structured data as JSON)

**Goal:** Embed each row of a workspace table as JSON, search across tables,
use results in NL workflows.

### Steps

1. **Table exists** — create via SQL execute ([sql.md](./sql.md)); logical name
   ≤ 23 characters.
2. **Embed rows** — `POST …/embeddings/tables/embed`:

   ```json
   { "table_names": ["invoices"] }
   ```

   First call for a table creates `embedding_config` and starts a background job.
3. **Poll** — `GET …/embeddings/tables/status` until table `status` is
   `completed` (or `failed`). Watch `embedded_rows` vs `total_rows`.
4. **Search** — `POST …/embeddings/tables/search`:

   ```json
   { "query": "unpaid invoices over 10000", "limit": 10 }
   ```

5. **Pass to LLM** — inject top row JSON into execute-by-intent `message` or
   chat user turn. Row embedding uses workspace default SNS model on the
   instance — you do not pass `provider` / `model`.

### Optional automation

`PATCH …/workspaces/{id}` with `auto_embed_tables: true` re-embeds on INSERT/UPDATE
for tables that already have row embedding config.

### Permissions

- Embed / regenerate: **DDL** permission (schema / `embedding_config` changes).
- Status / search: workspace **member**.

---

## Recipe 3 — Column similarity (text column vectors)

**Goal:** Add a vector column to an existing text column, run similarity search
on row text, feed matches to an agent.

### Steps

1. **Generate (synchronous)** — `POST …/embeddings/generate`:

   ```json
   { "table_name": "invoices", "column_name": "description" }
   ```

   Response includes `generated_count` and `column_added` when the handler
   finishes — **no separate poll step** for the embed pass itself.
2. **Status (optional)** — `GET …/embeddings/status?table_name=invoices` for
   `total` / `embedded` / `pending` counts if you run generate again or use
   policies that leave rows pending.
3. **Search** — `POST …/embeddings/similarity-search`:

   ```json
   {
     "table_name": "invoices",
     "column_name": "description",
     "query": "office supplies",
     "limit": 10
   }
   ```

4. **Pass to LLM** — format returned rows + similarity scores into the prompt
   for `/api/chat` or execute-by-intent.

### Permissions

- Generate: workspace **member** + **DDL** (adds `{column}_embedding` column).
- Status / similarity-search: workspace **member** (row visibility via policies).

---

## Sync vs async summary

| Surface | Generate/embed behavior | Poll before search? |
| ------- | ----------------------- | ------------------- |
| Column `POST …/embeddings/generate` | **Sync** — returns `generated_count` | Only if partial pending rows remain |
| Files `POST …/files/embed` | **Async** background | Yes — `GET …/files/status` |
| Tables `POST …/tables/embed` | **Async** background | Yes — `GET …/tables/status` |

---

## Error handling checklist

| Symptom | Likely cause | Action |
| ------- | ------------ | ------ |
| 503 `EMBEDDING_NOT_CONFIGURED` | Operator env | Ask operator; not a FE key issue |
| 503 `MODEL_NOT_MULTIMODAL` | File embed without `gemini-embedding-2*` | Operator changes `EMBEDDING_MODEL` |
| 400 `EMPTY_FILE_IDS` | Missing or empty `file_ids` | List files first; pass explicit IDs |
| 502 `EMBEDDING_API_ERROR` | Gateway/upstream failure | Retry; check instance logs |
| 403 `DDL_FORBIDDEN` | Member lacks DDL for column/table embed | Use admin or adjust policies |
| 403 on file embed | Not storage editor | Check [policies.md](./policies.md) |

---

## Related

- [llm-and-embedding-keys.md](./llm-and-embedding-keys.md) — env vars by role
- [embeddings.md](./embeddings.md) — endpoint reference
- [chat-streaming.md](./chat-streaming.md) — conversational RAG with MCP
- [async-intent-jobs.md](./async-intent-jobs.md) — batch NL with file refs
