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

Alternative to the SvelteKit Cookie route `/api/workspace-prompt-rules`.

| Method | Path | Auth | Purpose |
| ------ | ---- | ---- | ------- |
| `GET` | `…/setup/prompt-rules` | Bearer (member) | List rules (ordered) |
| `POST` | `…/setup/prompt-rules` | Bearer (admin) | Create rule |
| `PATCH` | `…/setup/prompt-rules/{ruleId}` | Bearer (admin) | Update content/sort |
| `DELETE` | `…/setup/prompt-rules/{ruleId}` | Bearer (admin) | Delete rule |

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

Skill file content and install-from-GitHub flows in the d6e console use
additional SvelteKit BFF routes (`/api/workspaces/{id}/skills/upload`, etc.).
Custom frontends typically ship skills via repo bootstrap scripts rather than
runtime upload.

---

## Title rule

Chat session auto-title naming convention:

| Method | Path | Purpose |
| ------ | ---- | ------- |
| `GET` | `…/setup/title-rule` | Get current rule (or null) |
| `PUT` | `…/setup/title-rule` | Upsert rule |
| `DELETE` | `…/setup/title-rule` | Remove rule |

---

## Chat templates

| Method | Path | Purpose |
| ------ | ---- | ------- |
| `GET` | `…/setup/chat-templates` | List templates |
| `POST` | `…/setup/chat-templates` | Create template |
| `GET` | `…/setup/chat-templates/{templateId}` | Get template |
| `PATCH` | `…/setup/chat-templates/{templateId}` | Update template |
| `DELETE` | `…/setup/chat-templates/{templateId}` | Delete template |
| `POST` | `…/setup/chat-templates/{templateId}/activate` | Set as active template |
| `POST` | `…/setup/chat-templates/deactivate` | Deactivate all templates |

Only one template may be active at a time. Activate/deactivate are admin-only.

---

## Dashboard enabled

| Method | Path | Purpose |
| ------ | ---- | ------- |
| `GET` | `…/setup/dashboard-enabled` | `{ "enabled": boolean }` |
| `PUT` | `…/setup/dashboard-enabled` | Toggle dashboard tab visibility |

---

## SaaS credentials (non-secret metadata)

| Method | Path | Purpose |
| ------ | ---- | ------- |
| `GET` | `…/setup/saas-credentials` | List connected providers |

Returns provider id, connection status, and metadata — **never** raw OAuth
tokens or refresh secrets. Connecting providers requires the d6e console OAuth
flow; there is no API to inject credentials from a custom frontend.

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
- [saas-proxy.md](./saas-proxy.md) — calling external APIs with stored creds
- [api-catalog.md](./api-catalog.md) — master index
