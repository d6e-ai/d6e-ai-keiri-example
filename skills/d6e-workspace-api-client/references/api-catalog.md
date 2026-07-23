# Workspace API catalog (master index)

Complete inventory of d6e Rust `/api/v1` endpoints and related SvelteKit BFF
routes that custom frontends typically proxy. Use this table to find the right
reference before implementing a server-side client.

**Auth legend**

| Column value | Meaning |
| ------------ | ------- |
| Bearer | `Authorization: Bearer <jwt>` or `d6e_*` API key |
| Bearer + X-WS-ID | Bearer **and** `X-Workspace-ID: <uuid>` header required |
| Bearer (path ws) | Bearer; workspace resolved from URL `{id}` (header optional, must match if sent) |
| Bearer (session) | JWT session only — API keys and scoped tokens rejected |
| Bearer (optional) | Auth optional; header still required where noted |
| Cookie | SvelteKit session — `Cookie: auth-token=<jwt>`; Bearer rejected |
| None | No auth |

Full workspace-resolution rules:
[auth-header-matrix.md](./auth-header-matrix.md).

**Important:** `GET /api/v1/workspaces/{id}/tables` **does not exist** (despite
some README mentions). List tables via SQL against `information_schema` — see
[sql.md](./sql.md).

---

## Workspaces CRUD + membership + invitations + redirect-uris

| Method | Path | Auth | Purpose | Detail |
| ------ | ---- | ---- | ------- | ------ |
| GET | `/api/v1/workspaces` | Bearer | List workspaces for caller | — |
| POST | `/api/v1/workspaces` | Bearer (session) | Create workspace | — |
| GET | `/api/v1/workspaces/{id}` | Bearer (path ws) | Get workspace; membership probe | [members-and-invitations.md](./members-and-invitations.md) |
| PATCH | `/api/v1/workspaces/{id}` | Bearer (path ws) | Update name, mcp_timeout, custom_prompt, auto_embed_* | — |
| DELETE | `/api/v1/workspaces/{id}` | Bearer (path ws) | Soft delete workspace | — |
| GET | `/api/v1/workspaces/{id}/members` | Bearer (path ws) | List members | [members-and-invitations.md](./members-and-invitations.md) |
| POST | `/api/v1/workspaces/{id}/members` | Bearer (path ws, admin) | Add member or queue invitation | [members-and-invitations.md](./members-and-invitations.md) |
| PATCH | `/api/v1/workspaces/{id}/members/{memberId}` | Bearer (path ws, admin) | Change role; `LAST_ADMIN` guard | [members-and-invitations.md](./members-and-invitations.md) |
| DELETE | `/api/v1/workspaces/{id}/members/{memberId}` | Bearer (path ws, admin) | Remove member; `LAST_ADMIN` guard | [members-and-invitations.md](./members-and-invitations.md) |
| GET | `/api/v1/workspaces/{id}/invitations` | Bearer (path ws, admin) | List pending invitations | [members-and-invitations.md](./members-and-invitations.md) |
| DELETE | `/api/v1/workspaces/{id}/invitations/{invitationId}` | Bearer (path ws, admin) | Cancel pending invitation | [members-and-invitations.md](./members-and-invitations.md) |
| GET | `/api/v1/workspaces/{id}/redirect-uris` | Bearer (path ws) | List OAuth redirect URIs | — |
| POST | `/api/v1/workspaces/{id}/redirect-uris` | Bearer (path ws) | Add redirect URI | — |
| DELETE | `/api/v1/workspaces/{id}/redirect-uris` | Bearer (path ws) | Remove redirect URI (body: `redirect_uri`) | — |

---

## SQL

| Method | Path | Auth | Purpose | Detail |
| ------ | ---- | ---- | ------- | ------ |
| POST | `/api/v1/workspaces/{id}/sql` | Bearer (path ws) | Execute SQL (policy + DDL checks) | [sql.md](./sql.md) |
| POST | `/api/v1/workspaces/{id}/sql/preview` | Bearer (path ws) | Preview SQL without policy eval | [sql.md](./sql.md) |

There is **no** `GET …/tables`. Use `information_schema` via execute — see
[sql.md § Listing tables](./sql.md).

---

## Files / storage

| Method | Path | Auth | Purpose | Detail |
| ------ | ---- | ---- | ------- | ------ |
| GET | `/api/v1/workspaces/{id}/files` | Bearer + X-WS-ID | List file metadata (no bytes) | [file-storage.md](./file-storage.md) |
| POST | `/api/v1/workspaces/{id}/files` | Bearer + X-WS-ID | JSON base64 upload | [file-storage.md](./file-storage.md) |
| POST | `/api/v1/workspaces/{id}/files/multipart` | Bearer + X-WS-ID | Multipart upload | [file-storage.md](./file-storage.md) |
| GET | `/api/v1/workspaces/{id}/files/{fileId}` | Bearer + X-WS-ID | Get metadata | [file-storage.md](./file-storage.md) |
| GET | `/api/v1/workspaces/{id}/files/{fileId}/download` | Bearer + X-WS-ID | Binary stream (proxy only) | [download-two-step.md](./download-two-step.md) |
| DELETE | `/api/v1/workspaces/{id}/files/{fileId}` | Bearer + X-WS-ID | Soft delete | [file-storage.md](./file-storage.md) |

Path `{id}` is **ignored** — workspace comes from `X-Workspace-ID` only.

---

## Documents

| Method | Path | Auth | Purpose | Detail |
| ------ | ---- | ---- | ------- | ------ |
| GET | `/api/v1/workspaces/{id}/documents` | Bearer + X-WS-ID | List documents (no content) | [documents.md](./documents.md) |
| POST | `/api/v1/workspaces/{id}/documents` | Bearer + X-WS-ID | Create document | [documents.md](./documents.md) |
| GET | `/api/v1/workspaces/{id}/documents/{docId}` | Bearer + X-WS-ID | Get document with content | [documents.md](./documents.md) |
| PATCH | `/api/v1/workspaces/{id}/documents/{docId}` | Bearer + X-WS-ID | Update; content change → new version | [documents.md](./documents.md) |
| DELETE | `/api/v1/workspaces/{id}/documents/{docId}` | Bearer + X-WS-ID | Soft delete | [documents.md](./documents.md) |
| GET | `/api/v1/workspaces/{id}/documents/{docId}/versions` | Bearer + X-WS-ID | Version history | [documents.md](./documents.md) |

Header-scoped like files — see [auth-header-matrix.md](./auth-header-matrix.md).

---

## Embeddings (column / files / tables)

| Method | Path | Auth | Purpose | Detail |
| ------ | ---- | ---- | ------- | ------ |
| POST | `/api/v1/workspaces/{id}/embeddings/generate` | Bearer (path ws) | Start column embedding job | [embeddings.md](./embeddings.md) |
| GET | `/api/v1/workspaces/{id}/embeddings/status` | Bearer (path ws) | Column embedding status (`?table_name=`) | [embeddings.md](./embeddings.md) |
| POST | `/api/v1/workspaces/{id}/embeddings/similarity-search` | Bearer (path ws) | Column vector similarity search | [embeddings.md](./embeddings.md) |
| POST | `/api/v1/workspaces/{id}/embeddings/files/embed` | Bearer (path ws) | Start file embedding | [embeddings.md](./embeddings.md) |
| GET | `/api/v1/workspaces/{id}/embeddings/files/status` | Bearer (path ws) | File embedding status | [embeddings.md](./embeddings.md) |
| POST | `/api/v1/workspaces/{id}/embeddings/files/search` | Bearer (path ws) | Semantic search over files | [embeddings.md](./embeddings.md) |
| POST | `/api/v1/workspaces/{id}/embeddings/files/regenerate` | Bearer (path ws) | Regenerate file embeddings | [embeddings.md](./embeddings.md) |
| POST | `/api/v1/workspaces/{id}/embeddings/tables/embed` | Bearer (path ws) | Start table row embedding | [embeddings.md](./embeddings.md) |
| GET | `/api/v1/workspaces/{id}/embeddings/tables/status` | Bearer (path ws) | Table row embedding status | [embeddings.md](./embeddings.md) |
| POST | `/api/v1/workspaces/{id}/embeddings/tables/search` | Bearer (path ws) | Cross-table semantic search | [embeddings.md](./embeddings.md) |
| POST | `/api/v1/workspaces/{id}/embeddings/tables/regenerate` | Bearer (path ws) | Regenerate table embeddings | [embeddings.md](./embeddings.md) |

Long jobs — poll status endpoints; see [embeddings.md](./embeddings.md).

---

## Workspace setup (prompt-rules, skills, title-rule, chat-templates, dashboard, saas-credentials)

Rust Bearer routes under `/api/v1/workspaces/{id}/setup/*` — path-scoped.
See [workspace-setup.md](./workspace-setup.md).

| Method | Path suffix | Auth | Purpose |
| ------ | ----------- | ---- | ------- |
| GET/POST | `/prompt-rules` | Bearer (path ws) | List / create prompt rules |
| PATCH/DELETE | `/prompt-rules/{ruleId}` | Bearer (path ws, admin) | Update / delete rule |
| GET/POST | `/skills` | Bearer (path ws, admin) | List / create workspace skills |
| GET/PATCH/DELETE | `/skills/{skillId}` | Bearer (path ws, admin) | Skill CRUD |
| GET/PUT/DELETE | `/title-rule` | Bearer (path ws, admin) | Chat title naming rule |
| GET/POST | `/chat-templates` | Bearer (path ws, admin) | List / create templates |
| GET/PATCH/DELETE | `/chat-templates/{templateId}` | Bearer (path ws, admin) | Template CRUD |
| POST | `/chat-templates/{templateId}/activate` | Bearer (path ws, admin) | Activate one template |
| POST | `/chat-templates/deactivate` | Bearer (path ws, admin) | Deactivate all templates |
| GET/PUT | `/dashboard-enabled` | Bearer (path ws, admin) | Dashboard visibility toggle |
| GET | `/saas-credentials` | Bearer (path ws) | List connected providers (non-secret metadata) |

The d6e console UI also exposes equivalent features via Cookie BFF routes
(`/api/workspace-prompt-rules`, `/api/workspaces/{id}/chat-templates`, …).
Custom frontends may use Rust setup API (Bearer), Cookie BFF proxies, or their
own DB — see [console-bff-catalog.md](./console-bff-catalog.md) and
[workspace-setup.md](./workspace-setup.md).

---

## Workflows (+ execute)

| Method | Path | Auth | Purpose | Detail |
| ------ | ---- | ---- | ------- | ------ |
| GET | `/api/v1/workflows` | Bearer + X-WS-ID | List workflows | [workflows.md](./workflows.md) |
| POST | `/api/v1/workflows` | Bearer + X-WS-ID | Create workflow | [workflows.md](./workflows.md) |
| GET | `/api/v1/workflows/{id}` | Bearer + X-WS-ID | Get workflow | [workflows.md](./workflows.md) |
| PATCH | `/api/v1/workflows/{id}` | Bearer + X-WS-ID | Update workflow | [workflows.md](./workflows.md) |
| DELETE | `/api/v1/workflows/{id}` | Bearer + X-WS-ID | Soft delete | [workflows.md](./workflows.md) |
| POST | `/api/v1/workflows/{id}/execute` | Bearer (optional) + X-WS-ID | Run workflow with JSON input | [workflows.md](./workflows.md) |

No `GET /tables`-style name lookup — list and match by `name` in your proxy
(expense-check pattern). See [workflows.md](./workflows.md).

---

## STFs (+ versions, secrets, instant-run, describe)

| Method | Path | Auth | Purpose | Detail |
| ------ | ---- | ---- | ------- | ------ |
| GET | `/api/v1/stfs` | Bearer + X-WS-ID | List STFs | [stfs-and-effects.md](./stfs-and-effects.md) |
| POST | `/api/v1/stfs` | Bearer + X-WS-ID | Create STF + initial version | [stfs-and-effects.md](./stfs-and-effects.md) |
| GET | `/api/v1/stfs/{id}` | Bearer + X-WS-ID | Get STF | [stfs-and-effects.md](./stfs-and-effects.md) |
| PATCH | `/api/v1/stfs/{id}` | Bearer + X-WS-ID | Update metadata | [stfs-and-effects.md](./stfs-and-effects.md) |
| DELETE | `/api/v1/stfs/{id}` | Bearer + X-WS-ID | Soft delete | [stfs-and-effects.md](./stfs-and-effects.md) |
| GET | `/api/v1/stfs/{id}/versions` | Bearer + X-WS-ID | List versions | [stfs-and-effects.md](./stfs-and-effects.md) |
| POST | `/api/v1/stfs/{id}/versions` | Bearer + X-WS-ID | Create new version | [stfs-and-effects.md](./stfs-and-effects.md) |
| POST | `/api/v1/stfs/{id}/describe` | Bearer + X-WS-ID | Infer input/output schema | [stfs-and-effects.md](./stfs-and-effects.md) |
| POST | `/api/v1/stfs/instant-run` | Bearer + X-WS-ID | Run STF without workflow | [stfs-and-effects.md](./stfs-and-effects.md) |
| GET | `/api/v1/stfs/{stfId}/secrets` | Bearer + X-WS-ID | List secret key names | [stfs-and-effects.md](./stfs-and-effects.md) |
| POST | `/api/v1/stfs/{stfId}/secrets` | Bearer + X-WS-ID | Upsert secret value | [stfs-and-effects.md](./stfs-and-effects.md) |
| DELETE | `/api/v1/stfs/{stfId}/secrets/{envKey}` | Bearer + X-WS-ID | Delete secret | [stfs-and-effects.md](./stfs-and-effects.md) |
| GET | `/api/v1/stf-libraries` | Bearer | List shared STF libraries | [stfs-and-effects.md](./stfs-and-effects.md) |
| GET | `/api/v1/stf-libraries/{name}/types` | Bearer | TypeScript type definitions | [stfs-and-effects.md](./stfs-and-effects.md) |

---

## Effects (+ versions)

| Method | Path | Auth | Purpose | Detail |
| ------ | ---- | ---- | ------- | ------ |
| GET | `/api/v1/effects` | Bearer + X-WS-ID | List effects | [stfs-and-effects.md](./stfs-and-effects.md) |
| POST | `/api/v1/effects` | Bearer + X-WS-ID | Create effect + initial version | [stfs-and-effects.md](./stfs-and-effects.md) |
| GET | `/api/v1/effects/{id}` | Bearer + X-WS-ID | Get effect | [stfs-and-effects.md](./stfs-and-effects.md) |
| PATCH | `/api/v1/effects/{id}` | Bearer + X-WS-ID | Update metadata | [stfs-and-effects.md](./stfs-and-effects.md) |
| DELETE | `/api/v1/effects/{id}` | Bearer + X-WS-ID | Soft delete | [stfs-and-effects.md](./stfs-and-effects.md) |
| GET | `/api/v1/effects/{id}/versions` | Bearer + X-WS-ID | List versions | [stfs-and-effects.md](./stfs-and-effects.md) |
| POST | `/api/v1/effects/{id}/versions` | Bearer + X-WS-ID | Create new version | [stfs-and-effects.md](./stfs-and-effects.md) |

---

## Policies + policy-groups

| Method | Path | Auth | Purpose | Detail |
| ------ | ---- | ---- | ------- | ------ |
| GET | `/api/v1/policies` | Bearer + X-WS-ID | List policies | [policies.md](./policies.md) |
| POST | `/api/v1/policies` | Bearer + X-WS-ID | Create policy (editor perm) | [policies.md](./policies.md) |
| GET | `/api/v1/policies/{id}` | Bearer + X-WS-ID | Get policy | [policies.md](./policies.md) |
| PATCH | `/api/v1/policies/{id}` | Bearer + X-WS-ID | Update policy | [policies.md](./policies.md) |
| DELETE | `/api/v1/policies/{id}` | Bearer + X-WS-ID | Soft delete | [policies.md](./policies.md) |
| GET | `/api/v1/policy-groups` | Bearer + X-WS-ID | List policy groups | [policies.md](./policies.md) |
| POST | `/api/v1/policy-groups` | Bearer + X-WS-ID | Create group | [policies.md](./policies.md) |
| GET | `/api/v1/policy-groups/{id}` | Bearer + X-WS-ID | Get group | [policies.md](./policies.md) |
| PATCH | `/api/v1/policy-groups/{id}` | Bearer + X-WS-ID | Update group | [policies.md](./policies.md) |
| DELETE | `/api/v1/policy-groups/{id}` | Bearer + X-WS-ID | Soft delete | [policies.md](./policies.md) |

---

## Pinned charts

| Method | Path | Auth | Purpose | Detail |
| ------ | ---- | ---- | ------- | ------ |
| GET | `/api/v1/pinned-charts` | Bearer + X-WS-ID | List visible charts | [pinned-charts.md](./pinned-charts.md) |
| POST | `/api/v1/pinned-charts` | Bearer + X-WS-ID | Create chart | [pinned-charts.md](./pinned-charts.md) |
| GET | `/api/v1/pinned-charts/{id}` | Bearer + X-WS-ID | Get chart | [pinned-charts.md](./pinned-charts.md) |
| PATCH | `/api/v1/pinned-charts/{id}` | Bearer + X-WS-ID | Update chart | [pinned-charts.md](./pinned-charts.md) |
| DELETE | `/api/v1/pinned-charts/{id}` | Bearer + X-WS-ID | Soft delete | [pinned-charts.md](./pinned-charts.md) |

---

## API keys

| Method | Path | Auth | Purpose | Detail |
| ------ | ---- | ---- | ------- | ------ |
| GET | `/api/v1/api-keys` | Bearer (session) | List caller's API keys | [api-keys-and-audit.md](./api-keys-and-audit.md) |
| POST | `/api/v1/api-keys` | Bearer (session) | Create key (raw key returned once) | [api-keys-and-audit.md](./api-keys-and-audit.md) |
| DELETE | `/api/v1/api-keys/{id}` | Bearer (session) | Revoke key | [api-keys-and-audit.md](./api-keys-and-audit.md) |

Scoped JWT and API keys **cannot** manage API keys. See
[api-keys-and-audit.md](./api-keys-and-audit.md).

---

## Audit logs

| Method | Path | Auth | Purpose | Detail |
| ------ | ---- | ---- | ------- | ------ |
| GET | `/api/v1/audit-logs` | Bearer + X-WS-ID | List audit entries (filtered) | [api-keys-and-audit.md](./api-keys-and-audit.md) |

Query filters: `user_id`, `action`, `resource_type`, `resource_id`, `limit`,
`offset`. Action supports `execute_sql*` prefix match with trailing `*`.

---

## Drive sync

| Method | Path | Auth | Purpose | Detail |
| ------ | ---- | ---- | ------- | ------ |
| GET | `/api/v1/drive-sync/status?workspace_id=` | Bearer | Sync status + roots + node_count | [drive-sync.md](./drive-sync.md) |
| GET | `/api/v1/drive-sync/config?workspace_id=` | Bearer | Config + roots | [drive-sync.md](./drive-sync.md) |
| PUT | `/api/v1/drive-sync/config` | Bearer | Update config (body: `workspace_id`) | [drive-sync.md](./drive-sync.md) |
| GET | `/api/v1/drive-sync/roots?workspace_id=` | Bearer | List sync roots | [drive-sync.md](./drive-sync.md) |
| POST | `/api/v1/drive-sync/roots` | Bearer | Add root (body: `workspace_id`) | [drive-sync.md](./drive-sync.md) |
| DELETE | `/api/v1/drive-sync/roots/{rootId}?workspace_id=` | Bearer | Remove root | [drive-sync.md](./drive-sync.md) |
| POST | `/api/v1/drive-sync/sync` | Bearer | Trigger background sync | [drive-sync.md](./drive-sync.md) |
| POST | `/api/v1/drive-sync/materialize` | Bearer | Copy Drive file bytes to storage | [drive-sync.md](./drive-sync.md) |
| POST | `/api/v1/drive-sync/read` | Bearer | Read Drive file content | [drive-sync.md](./drive-sync.md) |
| GET | `/api/v1/drive-sync/picker?workspace_id=&parent=&shared_drives=` | Bearer | Folder picker entries | [drive-sync.md](./drive-sync.md) |

`workspace_id` is in query (GET) or JSON body (writes) — **not** in the path.
Pin server-side from `D6E_WORKSPACE_ID`.

---

## SaaS proxy + saas-proxy-download

| Method | Path | Auth | Purpose | Detail |
| ------ | ---- | ---- | ------- | ------ |
| POST | `/api/v1/saas-proxy` | Bearer | JSON SaaS API proxy (10 MB cap) | [saas-proxy.md](./saas-proxy.md) |
| POST | `/api/v1/saas-proxy-download` | Bearer | Download external file → storage | [saas-proxy-download.md](./saas-proxy-download.md) |

Both require `workspace_id` in JSON body. Binary delivery uses the two-step
pattern — [download-two-step.md](./download-two-step.md).

Connect providers via Cookie BFF before calling — [saas-oauth-bff.md](./saas-oauth-bff.md).

---

## SaaS OAuth + credentials (Cookie BFF)

Full OAuth/PAT connect flow on the d6e instance. Stores encrypted tokens in
`frontend.saas_credential` (same table Rust saas-proxy reads).

| Method | Path | Auth | Purpose | Detail |
| ------ | ---- | ---- | ------- | ------ |
| GET | `/api/saas-auth/providers` | Cookie | List configured OAuth providers | [saas-oauth-bff.md](./saas-oauth-bff.md) |
| GET | `/api/saas-auth/{provider}/authorize?workspaceId=` | Cookie | Start OAuth redirect | [saas-oauth-bff.md](./saas-oauth-bff.md) |
| GET | `/api/saas-auth/{provider}/callback` | Cookie | OAuth callback + token storage | [saas-oauth-bff.md](./saas-oauth-bff.md) |
| POST | `/api/saas-auth/{provider}/token` | Cookie | Save PAT/API token providers | [saas-oauth-bff.md](./saas-oauth-bff.md) |
| GET | `/api/saas-credentials?workspaceId=` | Cookie | List credentials (metadata) | [saas-oauth-bff.md](./saas-oauth-bff.md) |
| GET | `/api/workspaces/{id}/saas-credentials` | Cookie | Same list (path workspace) | [saas-oauth-bff.md](./saas-oauth-bff.md) |
| PATCH | `/api/saas-credentials/{id}` | Cookie | Enable/disable credential | [saas-oauth-bff.md](./saas-oauth-bff.md) |
| DELETE | `/api/saas-credentials/{id}` | Cookie | Delete credential + linked MCP servers | [saas-oauth-bff.md](./saas-oauth-bff.md) |

Rust list-only equivalent: `GET …/setup/saas-credentials` (Bearer).

---

## Chat streaming (Cookie BFF)

| Method | Path | Auth | Purpose | Detail |
| ------ | ---- | ---- | ------- | ------ |
| POST | `/api/chat` | Cookie | UIMessage stream + MCP tools + SQL HITL | [chat-streaming.md](./chat-streaming.md) |

Related: `/api/chat-sessions/*`, `/api/chat-sessions/generate-title` — see
[console-bff-catalog.md](./console-bff-catalog.md).

---

## WebSocket (Rust)

| Method | Path | Auth | Purpose | Detail |
| ------ | ---- | ---- | ------- | ------ |
| GET | `/ws` | Bearer + `X-Workspace-ID` | RowInserted/Updated/Deleted events | [websocket.md](./websocket.md) |

Not under `/api/v1`. No Cookie transport.

---

## Workspace skills BFF + public skill fetch

| Method | Path | Auth | Purpose | Detail |
| ------ | ---- | ---- | ------- | ------ |
| GET/POST | `/api/workspaces/{id}/skills` | Cookie (admin writes) | List / create skills | [workspace-skills-bff.md](./workspace-skills-bff.md) |
| GET/PATCH/DELETE | `/api/workspaces/{id}/skills/{skillId}` | Cookie (admin) | Skill CRUD | [workspace-skills-bff.md](./workspace-skills-bff.md) |
| POST | `/api/workspaces/{id}/skills/discover` | Cookie (admin) | Preview remote repo skills | [workspace-skills-bff.md](./workspace-skills-bff.md) |
| POST | `/api/workspaces/{id}/skills/upload` | Cookie (admin) | Install from file | [workspace-skills-bff.md](./workspace-skills-bff.md) |
| POST | `/api/workspaces/{id}/skills/install` | Cookie (admin) | Install from URL | [workspace-skills-bff.md](./workspace-skills-bff.md) |
| GET | `/api/v1/skills/{name}?workspaceId=` | None | Merged skill markdown | [workspace-skills-bff.md](./workspace-skills-bff.md) |
| GET | `/api/v1/skills/{name}/files/{path}?workspaceId=` | None | Skill reference file | [workspace-skills-bff.md](./workspace-skills-bff.md) |

Rust metadata twin: `…/setup/skills/*` — [workspace-setup.md](./workspace-setup.md).

---

## MCP servers, memories, workspace settings, verify (Cookie BFF)

| Method | Path | Auth | Purpose | Detail |
| ------ | ---- | ---- | ------- | ------ |
| GET/POST | `/api/mcp-servers` | Cookie | List / register external MCP servers | [memories-mcp-settings.md](./memories-mcp-settings.md) |
| PATCH/DELETE | `/api/mcp-servers/{id}` | Cookie | Update / delete MCP server | [memories-mcp-settings.md](./memories-mcp-settings.md) |
| GET/PATCH/DELETE | `/api/memories` | Cookie | User memory CRUD | [memories-mcp-settings.md](./memories-mcp-settings.md) |
| GET/PATCH | `/api/workspace-settings/{workspaceId}` | Cookie | sqlApprovalMode, memoryEnabled, etc. | [memories-mcp-settings.md](./memories-mcp-settings.md) |
| POST | `/api/verify` | Cookie | LLM hallucination / tool-integrity check | [memories-mcp-settings.md](./memories-mcp-settings.md) |

---

## MCP tools ↔ REST map

No HTTP MCP endpoint for custom frontends. See
[mcp-rest-map.md](./mcp-rest-map.md) for tool-to-REST mapping and chat /
execute-by-intent access paths.

---

## Console BFF dual-route catalog

Full Cookie vs Rust `/api/v1` comparison (sql, files, pinned-charts,
chat-templates, title-rule, dashboard, redirect-uris, embeddings, transcribe,
table-column-order, …):
[console-bff-catalog.md](./console-bff-catalog.md).

---

## Auth (me, token)

| Method | Path | Auth | Purpose | Detail |
| ------ | ---- | ---- | ------- | ------ |
| GET | `/api/v1/auth/me` | Bearer | Current user profile | [auth-header-matrix.md](./auth-header-matrix.md) |
| POST | `/api/v1/auth/token` | None | OAuth token exchange (refresh) | [auth-header-matrix.md](./auth-header-matrix.md) |

---

## SvelteKit Cookie surfaces (chat-sessions, workspace-prompt-rules, chat)

These routes live on the **d6e instance** SvelteKit app, not under `/api/v1`.
See [console-bff-catalog.md](./console-bff-catalog.md) for the full dual-route
inventory.

| Method | Path | Auth | Purpose | Detail |
| ------ | ---- | ---- | ------- | ------ |
| POST | `/api/chat` | Cookie | UIMessage LLM stream + MCP | [chat-streaming.md](./chat-streaming.md) |
| GET | `/api/chat-sessions?workspaceId=` | Cookie | List chat sessions | [auth-header-matrix.md](./auth-header-matrix.md) |
| POST | `/api/chat-sessions` | Cookie | Create session | — |
| GET/PATCH/DELETE | `/api/chat-sessions/{id}` | Cookie | Session CRUD | — |
| POST | `/api/chat-sessions/generate-title` | Cookie | AI title generation | [console-bff-catalog.md](./console-bff-catalog.md) |
| GET | `/api/workspace-prompt-rules?workspaceId=` | Cookie (admin) | List prompt rules | [workspace-setup.md](./workspace-setup.md) |
| POST | `/api/workspace-prompt-rules` | Cookie (admin) | Create prompt rule | [workspace-setup.md](./workspace-setup.md) |
| PATCH/DELETE | `/api/workspace-prompt-rules/{ruleId}` | Cookie (admin) | Update / delete rule | [workspace-setup.md](./workspace-setup.md) |

**Bearer is rejected** on Cookie routes. Alternative for prompt rules:
`GET/POST …/workspaces/{id}/setup/prompt-rules` with Bearer — see
[workspace-setup.md](./workspace-setup.md).

---

## execute-by-intent sync + async jobs (not under `/api/v1`)

Critical for NL-driven automation from custom frontends. Paths are on the d6e
instance root, not `/api/v1`.

| Method | Path | Auth | Purpose | Detail |
| ------ | ---- | ---- | ------- | ------ |
| POST | `/api/workflows/execute-by-intent` | Bearer | Sync NL task (long-running) | [async-intent-jobs.md](./async-intent-jobs.md) |
| POST | `/api/workflows/execute-by-intent/jobs` | Bearer | Create async job → `{ jobId }` | [async-intent-jobs.md](./async-intent-jobs.md) |
| GET | `/api/workflows/execute-by-intent/jobs/{id}` | Bearer | Poll status / toolTrace / result | [async-intent-jobs.md](./async-intent-jobs.md) |
| POST | `/api/workflows/execute-by-intent/jobs/{id}/cancel` | Bearer | Cooperative cancel | [async-intent-jobs.md](./async-intent-jobs.md) |

Create pins `workspaceId` in JSON body. Poll/cancel use job id only.
Platform timeout guidance: [platform-timeouts.md](./platform-timeouts.md).

---

## Related deep references (existing)

| Document | Topic |
| -------- | ----- |
| [saas-oauth-bff.md](./saas-oauth-bff.md) | **OAuth/PAT connect** — Cookie BFF; fixes "console only" myth |
| [chat-streaming.md](./chat-streaming.md) | **POST /api/chat** — UIMessage stream, MCP, SQL HITL, memory, compaction |
| [mcp-rest-map.md](./mcp-rest-map.md) | MCP tools ↔ REST equivalents; MCP-only tools |
| [websocket.md](./websocket.md) | **GET /ws** — Bearer real-time row events |
| [workspace-skills-bff.md](./workspace-skills-bff.md) | Skills discover/upload/install BFF + public skill fetch |
| [memories-mcp-settings.md](./memories-mcp-settings.md) | MCP servers, memories, workspace-settings, verify |
| [console-bff-catalog.md](./console-bff-catalog.md) | **Master BFF table** — Cookie vs Rust dual routes |
| [download-two-step.md](./download-two-step.md) | Storage download streaming proxy |
| [saas-proxy-download.md](./saas-proxy-download.md) | External file → storage metadata |
| [file-storage.md](./file-storage.md) | Upload/list/delete |
| [sql.md](./sql.md) | Execute/preview, POLICY_DENIED, no GET /tables |
| [auth-header-matrix.md](./auth-header-matrix.md) | Full auth + workspace resolution |
| [size-limits.md](./size-limits.md) | 10 MB / 100 MB / 1 GB caps |
| [platform-timeouts.md](./platform-timeouts.md) | Vercel / Cloudflare limits |
| [async-intent-jobs.md](./async-intent-jobs.md) | Job lifecycle, heartbeat, 429 concurrency |
