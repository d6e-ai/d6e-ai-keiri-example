# Memories, MCP servers, workspace settings, verify

Per-user workspace preferences, MCP server registry, memory CRUD, and LLM
response verification. All routes live on the **d6e instance** SvelteKit app
(Cookie session), not under `/api/v1`.

These settings control [chat-streaming.md](./chat-streaming.md) behavior
(`sqlApprovalMode`, `memoryEnabled`, `mcpTimeoutMs`, verification flags).

---

## Auth (all routes)

```
Cookie: auth-token=<jwt>
```

Requires `locals.user`. Bearer rejected.

Custom frontends proxy same-origin with session cookie to `D6E_BASE_URL`.

---

## `GET/POST /api/mcp-servers`

Workspace-scoped external MCP server registry (`frontend.mcp_server` table).
Chat loads enabled servers alongside the built-in d6e MCP server.

### `GET /api/mcp-servers?workspaceId=<uuid>`

Response array:

```json
{
  "id": "<uuid>",
  "workspaceId": "<uuid>",
  "name": "my-mcp",
  "url": "https://example.com/mcp",
  "enabled": true,
  "saasCredentialId": null,
  "createdAt": "…",
  "updatedAt": "…"
}
```

Headers/secrets stored in DB are **not** returned on list (only on create response).

### `POST /api/mcp-servers`

Body:

```json
{
  "workspaceId": "<uuid>",
  "name": "my-mcp",
  "url": "https://example.com/mcp",
  "headers": { "Authorization": "Bearer …" },
  "enabled": true
}
```

201 with created row.

### `PATCH/DELETE /api/mcp-servers/{id}`

| Method | Body (PATCH) |
| ------ | ------------ |
| PATCH | `{ name?, url?, headers?, enabled? }` |
| DELETE | — → `{ success: true }` |

Deleting a SaaS credential (`DELETE /api/saas-credentials/{id}`) also removes
linked MCP server rows.

**No Rust REST equivalent** — MCP server config is frontend-DB only. Agents
access external tools only via chat / execute-by-intent.

Implementation:
[`packages/frontend/src/routes/api/mcp-servers/`](https://gitlab.com/cauchye/d6e-ai/d6e/-/tree/main/packages/frontend/src/routes/api/mcp-servers)

---

## `GET/PATCH/DELETE /api/memories`

Per-user, per-workspace memory store. Injected into chat system prompt when
`memoryEnabled` is true.

Implementation:
[`packages/frontend/src/routes/api/memories/+server.ts`](https://gitlab.com/cauchye/d6e-ai/d6e/-/blob/main/packages/frontend/src/routes/api/memories/+server.ts)

All operations scoped to authenticated user — cannot read other users' memories.

### `GET /api/memories?workspaceId=<uuid>`

Returns array of `{ id, content, … }` for the caller in that workspace.

### `PATCH /api/memories`

Body: `{ id, content, workspaceId }`

Updates memory text. 409 on duplicate content (unique constraint).

### `DELETE /api/memories`

Single delete — JSON body: `{ id, workspaceId }`

Bulk delete — query: `DELETE /api/memories?workspaceId=<uuid>&all=true`

Response: `{ deleted: count }` for bulk; `{ success: true }` for single.

Chat also **auto-extracts** memories post-turn (`extractAndSaveMemories`) —
no REST endpoint for extraction; chat-only.

**No Rust REST equivalent.**

---

## `GET/PATCH /api/workspace-settings/{workspaceId}`

Per-user settings for a workspace (not workspace-global admin config).

Implementation:
[`packages/frontend/src/routes/api/workspace-settings/[workspaceId]/+server.ts`](https://gitlab.com/cauchye/d6e-ai/d6e/-/blob/main/packages/frontend/src/routes/api/workspace-settings/%5BworkspaceId%5D/+server.ts)

### GET response shape

```json
{
  "userId": "<uuid>",
  "workspaceId": "<uuid>",
  "workspaceMode": "simple",
  "hallucinationVerificationEnabled": false,
  "verificationProvider": "anthropic",
  "verificationModel": "claude-haiku-4-5",
  "mcpTimeoutMs": 300000,
  "sqlApprovalMode": "write_only",
  "memoryEnabled": true,
  "memoryLimit": 100,
  "createdAt": "…",
  "updatedAt": "…"
}
```

Defaults applied when no row exists (`getUserWorkspaceSettingsOrDefault`).

### PATCH body (all fields optional)

| Field | Type | Validation |
| ----- | ---- | ---------- |
| `workspaceMode` | `"simple"` \| `"bi"` | |
| `hallucinationVerificationEnabled` | boolean | Enables post-response verify UI |
| `verificationProvider` | `openai`, `anthropic`, `google`, `xai`, `meta`, `ollama`, `lmstudio` | |
| `verificationModel` | string | Non-empty |
| `mcpTimeoutMs` | number | 30000–3600000 |
| `sqlApprovalMode` | `all`, `write_only`, `ddl_only`, `none` | Chat SQL HITL — [chat-streaming.md](./chat-streaming.md) |
| `memoryEnabled` | boolean | |
| `memoryLimit` | number | 10–200 |

Returns full settings object after update.

**No Rust REST equivalent** — distinct from workspace admin fields on
`PATCH /api/v1/workspaces/{id}` (`custom_prompt`, `mcp_timeout`, etc.).

---

## `POST /api/verify`

LLM-based hallucination / tool-integrity check on a conversation turn.

Implementation:
[`packages/frontend/src/routes/api/verify/+server.ts`](https://gitlab.com/cauchye/d6e-ai/d6e/-/blob/main/packages/frontend/src/routes/api/verify/+server.ts)

### Request

```json
{
  "userPrompt": "User's original question",
  "conversationMessages": [
    { "type": "user", "content": "…" },
    { "type": "ai", "content": "…", "toolCalls": [{ "name": "d6e_sql", "args": {} }] },
    { "type": "tool_result", "toolName": "d6e_sql", "content": "…" }
  ],
  "provider": "google",
  "model": "gemini-…",
  "language": "en",
  "workspaceId": "<uuid>"
}
```

| Field | Required |
| ----- | -------- |
| `userPrompt` | Yes |
| `conversationMessages` | Yes — non-empty |
| `workspaceId` | Yes — entitlement gate |
| `provider`, `model`, `language` | Optional |

### Response

```json
{
  "status": "verified",
  "confidence": 95,
  "summary": "One-line result",
  "details": "Longer explanation"
}
```

`status`: `verified` | `warning` | `error`

402 `llm_soft_gated` when workspace billing blocks LLM (same as chat).

Short conversations (< 100 chars) return immediate `verified` / 100 confidence.

Used when `hallucinationVerificationEnabled` is true in workspace settings.

**No Rust REST equivalent.**

---

## Settings ↔ chat behavior matrix

| Setting | Affects |
| ------- | ------- |
| `sqlApprovalMode` | Which `d6e_sql` calls require user approval in chat |
| `memoryEnabled` / `memoryLimit` | System prompt memory section + extraction |
| `mcpTimeoutMs` | MCP tool execution timeout in chat |
| `hallucinationVerificationEnabled` | Whether UI calls `/api/verify` |
| `verificationProvider` / `verificationModel` | Verify LLM selection |
| `workspaceMode` | Console UI layout (`simple` vs `bi`) |

---

## Related

- [chat-streaming.md](./chat-streaming.md) — consumer of these settings
- [mcp-rest-map.md](./mcp-rest-map.md) — MCP-only vs REST
- [saas-oauth-bff.md](./saas-oauth-bff.md) — SaaS credentials (separate from MCP servers)
- [console-bff-catalog.md](./console-bff-catalog.md) — full BFF catalog
- [api-catalog.md](./api-catalog.md) — master index
