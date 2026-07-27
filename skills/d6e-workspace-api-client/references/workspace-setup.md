# Workspace setup API

Bearer routes under `/api/v1/workspaces/{id}/setup/*` for configuring workspace
behavior: prompt rules, skills, chat templates, title rules, dashboard toggle,
and SaaS credential metadata.

Workspace is resolved from the **path** `{id}` plus membership (admin for
mutations). `X-Workspace-ID` is optional; if sent it must match the path.
See [auth-header-matrix.md](./auth-header-matrix.md).

## Auth

```
Authorization: Bearer <jwt>
Content-Type: application/json
```

Pin `{id}` from `getD6eWorkspaceId(caller)`.

---

## Prompt rules

Ordered Markdown segments injected into the chat agent system prompt. **Not**
the same as workspace `custom_prompt` (single legacy blob on
`PATCH /api/v1/workspaces/{id}`) — see
[workspaces.md § custom_prompt vs prompt-rules](./workspaces.md#custom_prompt-vs-prompt-rules).

Alternative to the SvelteKit Cookie route `/api/workspace-prompt-rules`.

| Method | Path | Auth | Purpose |
| ------ | ---- | ---- | ------- |
| `GET` | `…/setup/prompt-rules` | Bearer (member) | List rules (ordered) |
| `POST` | `…/setup/prompt-rules` | Bearer (admin) | Create rule |
| `PATCH` | `…/setup/prompt-rules/{ruleId}` | Bearer (admin) | Update content/sort |
| `DELETE` | `…/setup/prompt-rules/{ruleId}` | Bearer (admin) | Delete rule |

### Rust Bearer — examples

**List** `GET …/setup/prompt-rules`

```json
[
  {
    "id": "018f…",
    "workspace_id": "018e…",
    "content": "Always respond in Japanese.",
    "sort_order": 0,
    "created_at": "2026-01-01T00:00:00Z",
    "updated_at": "2026-01-01T00:00:00Z"
  }
]
```

**Create** `POST …/setup/prompt-rules`

```json
{ "content": "Cite SQL table names in backticks." }
```

Response `201` — created rule row. Content trimmed; max 50 000 chars; empty → `400`.

**Update** `PATCH …/setup/prompt-rules/{ruleId}`

```json
{ "content": "Updated text", "sort_order": 1 }
```

### Cookie BFF — examples

Admin only on all mutating routes. Query/body uses **camelCase**.

**List** `GET /api/workspace-prompt-rules?workspaceId={id}`

```json
[
  {
    "id": "018f…",
    "workspaceId": "018e…",
    "content": "Always respond in Japanese.",
    "sortOrder": 0,
    "createdAt": "…",
    "updatedAt": "…"
  }
]
```

**Create** `POST /api/workspace-prompt-rules`

```json
{ "workspaceId": "018e…", "content": "Cite SQL table names in backticks." }
```

**Cookie vs Bearer:** the d6e console UI uses `Cookie: auth-token=<jwt>` on
`/api/workspace-prompt-rules`. Custom frontends may use either:

- Rust setup API (this section) — Bearer, good for server-side init scripts
- Cookie BFF — only when proxying through the d6e instance SvelteKit app

Idempotent registration pattern (SHA-256 hash compare before POST) is described
in the skill's Core Concepts section.

---

## Skills

| Method | Path | Auth | Purpose |
| ------ | ---- | ---- | ------- |
| `GET` | `…/setup/skills` | Bearer (admin) | List workspace skills |
| `POST` | `…/setup/skills` | Bearer (admin) | Create skill metadata |
| `GET` | `…/setup/skills/{skillId}` | Bearer (admin) | Get skill |
| `PATCH` | `…/setup/skills/{skillId}` | Bearer (admin) | Update skill |
| `DELETE` | `…/setup/skills/{skillId}` | Bearer (admin) | Delete skill |

Skill file content, discover, upload, and install-from-GitHub flows use
additional Cookie BFF routes under `/api/workspaces/{id}/skills/*`. Custom
frontends may proxy those routes or use this Rust metadata API — see
[workspace-skills-bff.md](./workspace-skills-bff.md).

---

## Title rule

Chat session auto-title naming convention (consumed by
`POST /api/chat-sessions/generate-title` — see [chat-sessions.md](./chat-sessions.md)):

| Method | Path | Auth (Rust) | Purpose |
| ------ | ---- | ----------- | ------- |
| `GET` | `…/setup/title-rule` | Bearer (member) | Get current rule or `null` |
| `PUT` | `…/setup/title-rule` | Bearer (admin) | Upsert rule |
| `DELETE` | `…/setup/title-rule` | Bearer (admin) | Remove rule |

### Rust Bearer — examples

**Get** — `null` when unset:

```json
{
  "workspace_id": "018e…",
  "content": "Use a short noun phrase, max 6 words, in Japanese.",
  "created_at": "…",
  "updated_at": "…"
}
```

**Upsert** `PUT …/setup/title-rule`

```json
{ "content": "Use a short noun phrase, max 6 words." }
```

Empty / whitespace-only `content` deletes the rule (response `null`). Max 2000
chars.

### Cookie BFF

`GET/PUT/DELETE /api/workspaces/{workspaceId}/title-rule` — **admin only** for
all methods (stricter than Rust GET).

```json
PUT /api/workspaces/{workspaceId}/title-rule
{ "content": "Use a short noun phrase." }
```

---


## Chat templates

QuickChat landing screen customization. Admin for mutations.

| Method | Path | Purpose |
| ------ | ---- | ------- |
| `GET` | `…/setup/chat-templates` | List templates |
| `POST` | `…/setup/chat-templates` | Create template |
| `GET` | `…/setup/chat-templates/{templateId}` | Get template |
| `PATCH` | `…/setup/chat-templates/{templateId}` | Update template |
| `DELETE` | `…/setup/chat-templates/{templateId}` | Delete template |
| `POST` | `…/setup/chat-templates/{templateId}/activate` | Set as active template |
| `POST` | `…/setup/chat-templates/deactivate` | Deactivate all templates |

Cookie BFF twin: `/api/workspaces/{workspaceId}/chat-templates[/{templateId}]`
(same feature; camelCase JSON on BFF).

Only one template may be active at a time. Activate/deactivate are admin-only.

### Create payload (Rust — snake_case)

Minimal example; many optional branding fields exist (`icon`, `hero_layout`,
`quick_actions`, …):

```json
POST …/setup/chat-templates
{
  "name": "expense-review",
  "title": "Expense review",
  "upload_card_title": "Upload receipt",
  "send_instruction": "Describe what to check",
  "is_active": false
}
```

Response `201` — full template row with `id`, `workspace_id`, timestamps.

### Cookie BFF create (camelCase)

```json
POST /api/workspaces/{workspaceId}/chat-templates
{
  "name": "expense-review",
  "title": "Expense review",
  "uploadCardTitle": "Upload receipt",
  "sendInstruction": "Describe what to check",
  "isActive": false
}
```

---

## Dashboard enabled

Controls whether the BI-style dashboard is the workspace top page vs chat template
/ agent screen.

| Method | Path | Auth (Rust) | Purpose |
| ------ | ---- | ----------- | ------- |
| `GET` | `…/setup/dashboard-enabled` | Bearer (member) | Read setting (auto-creates default row) |
| `PUT` | `…/setup/dashboard-enabled` | Bearer (admin) | Set `enabled` |

### Rust Bearer — examples

**Get**

```json
{
  "workspace_id": "018e…",
  "dashboard_enabled": true,
  "created_at": "…",
  "updated_at": "…"
}
```

**Set** `PUT …/setup/dashboard-enabled`

```json
{ "enabled": false }
```

### Cookie BFF

`GET/PUT /api/workspaces/{workspaceId}/dashboard-enabled` — **admin only** for
both (stricter than Rust GET).

```json
PUT /api/workspaces/{workspaceId}/dashboard-enabled
{ "enabled": true }
```

Response uses camelCase (`dashboardEnabled`, `workspaceId`, …).

---

## SaaS credentials (non-secret metadata)

| Method | Path | Purpose |
| ------ | ---- | ------- |
| `GET` | `…/setup/saas-credentials` | List connected providers |

Returns provider id, connection status, and metadata — **never** raw OAuth
tokens or refresh secrets. **List only on Rust** — connecting, enabling,
disabling, and deleting credentials uses Cookie BFF routes documented in
[saas-oauth-bff.md](./saas-oauth-bff.md). Custom frontends can drive the full
OAuth/PAT flow by proxying those routes (same-origin with `auth-token` cookie).

Use listed providers to validate [saas-proxy.md](./saas-proxy.md) calls
(`provider` field must match a connected credential).

---

## Dual implementation note

The d6e console maintains parallel **SvelteKit Cookie BFF** routes under
`/api/workspaces/{id}/…` backed by the local `frontend` PostgreSQL schema.
The Rust setup API documented here is the canonical surface for MCP tools,
client-rs, and custom frontend **server proxies** calling `D6E_BASE_URL`
directly.

Pick one path per feature in your app — do not assume rows sync automatically
between BFF DB and Rust API unless your deployment explicitly bridges them.

## Related

- [auth-header-matrix.md](./auth-header-matrix.md) — Cookie vs Bearer routes
- [workspaces.md](./workspaces.md) — `custom_prompt` vs prompt-rules
- [chat-sessions.md](./chat-sessions.md) — title rule consumer
- [saas-proxy.md](./saas-proxy.md) — calling external APIs with stored creds
- [api-catalog.md](./api-catalog.md) — master index
