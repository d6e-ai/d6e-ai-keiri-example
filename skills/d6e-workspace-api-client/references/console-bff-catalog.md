# Console Cookie BFF catalog — dual routes vs Rust `/api/v1`

Master table of d6e instance **SvelteKit Cookie BFF** routes and their Rust
`/api/v1` equivalents (where they exist). Custom frontends proxy Cookie routes
with `Cookie: auth-token=<jwt>`; server-side automation uses Bearer on Rust.

**Legend**

| Auth | Meaning |
| ---- | ------- |
| Cookie | `Cookie: auth-token=<jwt>` on d6e instance |
| Bearer | `Authorization: Bearer <jwt\|d6e_*>` |
| Bearer + X-WS-ID | Bearer plus `X-Workspace-ID` header |
| Bearer (path ws) | Workspace from URL `{id}` |
| None | No auth |

Implementation index:
[`packages/frontend/src/routes/api/`](https://gitlab.com/cauchye/d6e-ai/d6e/-/tree/main/packages/frontend/src/routes/api)

---

## SQL

| Feature | Cookie BFF | Rust `/api/v1` | Notes |
| ------- | ---------- | -------------- | ----- |
| Execute SQL | `POST /api/workspaces/{id}/sql` | `POST /api/v1/workspaces/{id}/sql` | BFF forwards to Rust via `executeSql` |
| Preview SQL | — | `POST …/sql/preview` | Rust only |

Both use Cookie vs Bearer respectively. Path workspace resolution on Rust.
See [sql.md](./sql.md).

---

## Files

| Feature | Cookie BFF | Rust `/api/v1` | Notes |
| ------- | ---------- | -------------- | ----- |
| JSON upload (chat) | `POST /api/workspaces/{id}/files/upload` | `POST …/files` | BFF: base64 JSON; Rust: Bearer + **X-WS-ID** |
| Multipart upload | — | `POST …/files/multipart` | Rust only |
| List / get / delete | — (console uses Rust via server) | `GET/DELETE …/files[/{fileId}]` | Header-scoped |
| Download stream | `GET /api/workspaces/{id}/files/{fileId}/download` | `GET …/files/{fileId}/download` | BFF proxies Rust stream |

See [file-storage.md](./file-storage.md), [download-two-step.md](./download-two-step.md).

---

## Pinned charts

| Feature | Cookie BFF | Rust `/api/v1` | Notes |
| ------- | ---------- | -------------- | ----- |
| List / CRUD | `GET/POST /api/workspaces/{id}/pinned-charts` | `GET/POST /api/v1/pinned-charts` | **Different backends**: BFF uses frontend DB (per-user charts); Rust uses workspace API with policies |
| Item CRUD | `GET/PATCH/DELETE …/pinned-charts/{chartId}` | `GET/PATCH/DELETE /api/v1/pinned-charts/{id}` | Rust requires **X-WS-ID** |

Custom frontends typically use **Rust** pinned charts (Bearer) for policy-aware
dashboard data. Console BI UI uses BFF local DB.

See [pinned-charts.md](./pinned-charts.md).

---

## Chat templates

| Feature | Cookie BFF | Rust `/api/v1` | Notes |
| ------- | ---------- | -------------- | ----- |
| List / create | `GET/POST /api/workspaces/{id}/chat-templates` | `GET/POST …/setup/chat-templates` | Admin; same feature |
| Get / update / delete | `GET/PATCH/DELETE …/chat-templates/{templateId}` | Same under `…/setup/chat-templates/{id}` | |
| Activate | `POST …/chat-templates/{id}/activate` | `POST …/setup/chat-templates/{id}/activate` | |
| Deactivate all | `POST …/chat-templates/deactivate` | `POST …/setup/chat-templates/deactivate` | |

See [workspace-setup.md](./workspace-setup.md).

---

## Title rule

| Feature | Cookie BFF | Rust `/api/v1` | Notes |
| ------- | ---------- | -------------- | ----- |
| Get | `GET /api/workspaces/{id}/title-rule` | `GET …/setup/title-rule` | Admin |
| Upsert | `PUT /api/workspaces/{id}/title-rule` `{ content }` | `PUT …/setup/title-rule` | Empty content deletes |
| Delete | `DELETE /api/workspaces/{id}/title-rule` | `DELETE …/setup/title-rule` | |

Consumed by `POST /api/chat-sessions/generate-title`.

---

## Dashboard enabled

| Feature | Cookie BFF | Rust `/api/v1` | Notes |
| ------- | ---------- | -------------- | ----- |
| Get | `GET /api/workspaces/{id}/dashboard-enabled` | `GET …/setup/dashboard-enabled` | Admin |
| Set | `PUT /api/workspaces/{id}/dashboard-enabled` `{ enabled }` | `PUT …/setup/dashboard-enabled` | |

---

## Redirect URIs

| Feature | Cookie BFF | Rust `/api/v1` | Notes |
| ------- | ---------- | -------------- | ----- |
| List | `GET /api/workspaces/{id}/redirect-uris` | `GET …/redirect-uris` | Admin; BFF proxies Rust |
| Add | `POST …/redirect-uris` | `POST …/redirect-uris` | |
| Remove | `DELETE …/redirect-uris` | `DELETE …/redirect-uris` body `{ redirect_uri }` | |

---

## Embeddings (column generate)

| Feature | Cookie BFF | Rust `/api/v1` | Notes |
| ------- | ---------- | -------------- | ----- |
| Generate column embeddings | `POST /api/embeddings/generate` `{ workspaceId, tableName, columnName, regenerate? }` | `POST …/embeddings/generate` | BFF proxies Rust |
| Status / search / file / table embed | — | Full `/embeddings/*` tree | Rust only |

See [embeddings.md](./embeddings.md).

---

## Chat sessions + title

| Feature | Cookie BFF | Rust `/api/v1` | Notes |
| ------- | ---------- | -------------- | ----- |
| Session CRUD | `GET/POST /api/chat-sessions`, `GET/PATCH/DELETE /api/chat-sessions/{id}` | **None** | Frontend DB only |
| Generate title | `POST /api/chat-sessions/generate-title` | **None** | LLM; requires `workspaceId` |
| Chat stream | `POST /api/chat` | **None** | [chat-streaming.md](./chat-streaming.md) |

---

## Default models

| Feature | Cookie BFF | Rust `/api/v1` | Notes |
| ------- | ---------- | -------------- | ----- |
| Get / set / reset | `GET/PUT/DELETE /api/workspaces/{id}/default-models` | **None** | Frontend DB; admin only |

Chat UI reads defaults server-side — members do not call this route directly.

---

## Transcribe (Whisper)

| Feature | Cookie BFF | Rust `/api/v1` | Notes |
| ------- | ---------- | -------------- | ----- |
| Availability | `GET /api/transcribe` → `{ available }` | **None** | Requires `OPENAI_API_KEY` on instance |
| Transcribe audio | `POST /api/transcribe` multipart audio | **None** | Max 25 MB |

---

## Table column order (UI preference)

| Feature | Cookie BFF | Rust `/api/v1` | Notes |
| ------- | ---------- | -------------- | ----- |
| Get order | `GET /api/table-column-order/{workspaceId}/{tableName}` | **None** | Per-user preference |
| Save | `PUT …/table-column-order/…` | **None** | |
| Reset | `DELETE …/table-column-order/…` | **None** | |

---

## Prompt rules

| Feature | Cookie BFF | Rust `/api/v1` | Notes |
| ------- | ---------- | -------------- | ----- |
| CRUD | `/api/workspace-prompt-rules[/{ruleId}]` | `…/setup/prompt-rules[/{ruleId}]` | Cookie admin vs Bearer |

---

## SaaS OAuth + credentials

| Feature | Cookie BFF | Rust `/api/v1` | Notes |
| ------- | ---------- | -------------- | ----- |
| OAuth connect | `/api/saas-auth/*` | **None** | Full flow — [saas-oauth-bff.md](./saas-oauth-bff.md) |
| Credential CRUD | `/api/saas-credentials*` | List only: `GET …/setup/saas-credentials` | |
| SaaS JSON proxy | — | `POST /api/v1/saas-proxy` | Bearer after connect |

---

## Skills, MCP, memories, settings

| Feature | Cookie BFF | Rust `/api/v1` | Notes |
| ------- | ---------- | -------------- | ----- |
| Skills admin | `/api/workspaces/{id}/skills/*` | `…/setup/skills/*` | [workspace-skills-bff.md](./workspace-skills-bff.md) |
| Skill markdown pull | `GET /api/v1/skills/{name}?workspaceId=` (**None** auth) | — | Public fetch |
| MCP servers | `/api/mcp-servers*` | **None** | [memories-mcp-settings.md](./memories-mcp-settings.md) |
| Memories | `/api/memories` | **None** | |
| User workspace settings | `/api/workspace-settings/{workspaceId}` | **None** | |
| Verify LLM response | `POST /api/verify` | **None** | |

---

## execute-by-intent (not dual — Bearer only)

| Route | Auth |
| ----- | ---- |
| `POST /api/workflows/execute-by-intent` | Bearer |
| `POST/GET …/execute-by-intent/jobs*` | Bearer |

Not Cookie routes. See [async-intent-jobs.md](./async-intent-jobs.md).

---

## WebSocket (Rust only)

| Route | Auth |
| ----- | ---- |
| `GET /ws` | Bearer + `X-Workspace-ID` |

See [websocket.md](./websocket.md). No Cookie BFF twin.

---

## Choosing Cookie vs Bearer

| Use Cookie BFF when | Use Rust Bearer when |
| ------------------- | -------------------- |
| Driving OAuth connect flow | Server proxy with pinned workspace |
| Chat / chat-sessions / verify | SQL, files, workflows, saas-proxy |
| User session UI settings (memories, column order) | Automation scripts, custom FE `/api/*` proxies |
| Provisioning via d6e instance admin UI | Policy-aware CRUD with `X-Workspace-ID` |

Many Cookie routes are thin proxies to Rust (`sql`, `redirect-uris`,
`embeddings/generate`, `files/download`). Others use frontend PostgreSQL only
(`chat-sessions`, `pinned-charts` BFF, `mcp-servers`, `memories`).

---

## Related

- [auth-header-matrix.md](./auth-header-matrix.md) — header resolution rules
- [api-catalog.md](./api-catalog.md) — master Rust index
- [saas-oauth-bff.md](./saas-oauth-bff.md)
- [chat-streaming.md](./chat-streaming.md)
- [workspace-setup.md](./workspace-setup.md)
