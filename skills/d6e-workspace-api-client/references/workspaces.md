# Workspaces CRUD

Create, read, update, and soft-delete workspaces via Rust `/api/v1/workspaces`.
Workspace is resolved from the **path** `{id}` plus membership. `X-Workspace-ID`
is optional; if sent it must match the path.

See [auth-header-matrix.md](./auth-header-matrix.md).

Implementation:
[`packages/api/src/routes/v1/workspace.rs`](https://github.com/d6e-ai/d6e/blob/main/packages/api/src/routes/v1/workspace.rs)

---

## Auth

```
Authorization: Bearer <jwt>
Content-Type: application/json
```

| Operation | Membership |
| --------- | ---------- |
| `GET /api/v1/workspaces` | Any authenticated user (lists caller's workspaces) |
| `POST /api/v1/workspaces` | Session JWT only — **scoped tokens and API keys rejected** |
| `GET /api/v1/workspaces/{id}` | Any member |
| `PATCH /api/v1/workspaces/{id}` | **Admin** |
| `DELETE /api/v1/workspaces/{id}` | **Admin** — soft delete (`deleted_at` set) |

Scoped workspace tokens list only their bound workspace when the user is still a
member.

---

## GET `/api/v1/workspaces`

Returns workspaces the caller belongs to (non-deleted), newest `created_at`
first.

```json
[
  {
    "id": "018e…",
    "name": "Acme Corp",
    "ddl_policy_group_id": null,
    "workflow_editor_policy_group_id": null,
    "policy_editor_policy_group_id": null,
    "mcp_timeout_ms": 300000,
    "custom_prompt": null,
    "auto_embed_files": false,
    "auto_embed_tables": false,
    "created_at": "2025-06-01T00:00:00Z",
    "updated_at": "2025-06-01T00:00:00Z",
    "deleted_at": null
  }
]
```

Field names are **snake_case** (Rust serialization).

---

## POST `/api/v1/workspaces`

Create workspace. Creator is added as **admin**.

**Request**

```json
{ "name": "New workspace" }
```

`name`: 1–255 characters.

**Response:** `201` — full workspace object (same shape as GET item). Defaults:
`mcp_timeout_ms` = 300000, `auto_embed_files` / `auto_embed_tables` = false,
policy group ids = null.

---

## GET `/api/v1/workspaces/{id}`

Membership probe for custom frontend `/auth/callback` — returns workspace row or
`403` / `404`.

---

## PATCH `/api/v1/workspaces/{id}`

Partial update. **Admin only.** All body fields optional.

**Request**

```json
{
  "name": "Renamed workspace",
  "ddl_policy_group_id": "018f…",
  "workflow_editor_policy_group_id": null,
  "policy_editor_policy_group_id": null,
  "mcp_timeout_ms": 600000,
  "custom_prompt": "# Agent context\nUse formal tone.",
  "auto_embed_files": true,
  "auto_embed_tables": false
}
```

| Field | Type | Notes |
| ----- | ---- | ----- |
| `name` | string | Display name |
| `ddl_policy_group_id` | uuid \| null | Policy group allowed to run DDL; `null` = admin-only DDL |
| `workflow_editor_policy_group_id` | uuid \| null | Who can edit workflows; `null` = any member |
| `policy_editor_policy_group_id` | uuid \| null | Who can edit policies; `null` = any member |
| `mcp_timeout_ms` | number | 30000–3600000 (30 s – 1 h); default 300000 |
| `custom_prompt` | string \| null | Single Markdown blob for agent context; max 50 000 chars; `null` clears |
| `auto_embed_files` | boolean | Auto-embed on file upload |
| `auto_embed_tables` | boolean | Auto re-embed table rows on INSERT/UPDATE |

Set a policy group field to JSON `null` to clear it (`Option<Option<Uuid>>` in
Rust).

**Response:** `200` — updated workspace row.

`400` when `mcp_timeout_ms` or `custom_prompt` length is invalid.

### `custom_prompt` vs prompt-rules

| Mechanism | API | Purpose |
| --------- | --- | ------- |
| `custom_prompt` | This PATCH field | **Legacy single blob** on `workspace` table — one Markdown string |
| Prompt rules | `…/setup/prompt-rules` or Cookie `/api/workspace-prompt-rules` | **Ordered segments** injected into chat; admin can add/reorder/delete |

Prefer prompt rules for new admin UX. `custom_prompt` remains for backward
compatibility and automation scripts. See
[workspace-setup.md § Prompt rules](./workspace-setup.md#prompt-rules).

---

## DELETE `/api/v1/workspaces/{id}`

Soft delete. **Admin only.** Response: `204 No Content`.

---

## Cookie BFF — partial PATCH

The d6e console exposes a **subset** of PATCH fields via Cookie proxy:

```
PATCH /api/workspaces/{workspaceId}
Cookie: auth-token=<jwt>
```

**Body** (all optional): `name`, `mcp_timeout_ms`, `custom_prompt`,
`auto_embed_files`, `auto_embed_tables` — same validation as Rust.

**Not exposed on Cookie BFF:** `ddl_policy_group_id`,
`workflow_editor_policy_group_id`, `policy_editor_policy_group_id`. Use Rust
Bearer PATCH for policy group assignment.

Implementation:
[`packages/frontend/src/routes/api/workspaces/[workspaceId]/+server.ts`](https://github.com/d6e-ai/d6e/blob/main/packages/frontend/src/routes/api/workspaces/%5BworkspaceId%5D/+server.ts)

There is no Cookie BFF for `GET/POST/DELETE` workspace list/create/delete —
use Rust Bearer from server proxies.

---

## Related

| Document | Topic |
| -------- | ----- |
| [members-and-invitations.md](./members-and-invitations.md) | Members under `…/workspaces/{id}/members` |
| [redirect-uris.md](./redirect-uris.md) | OAuth callbacks under `…/redirect-uris` |
| [workspace-setup.md](./workspace-setup.md) | `…/setup/*` configuration |
| [memories-mcp-settings.md](./memories-mcp-settings.md) | Per-user `mcpTimeoutMs` (distinct from workspace `mcp_timeout_ms`) |
| [console-bff-catalog.md](./console-bff-catalog.md) | Cookie vs Rust |
