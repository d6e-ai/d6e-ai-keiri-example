# Workspace skills — Cookie BFF and public skill fetch

Agent Skills (markdown instruction packs for chat MCP context) are managed
through two parallel surfaces:

1. **Cookie BFF** — full CRUD, discover, upload, install (d6e instance
   PostgreSQL `frontend.workspace_skill`)
2. **Rust setup API** — Bearer metadata CRUD on `/api/v1/workspaces/{id}/setup/skills`
3. **Public skill pull** — unauthenticated markdown fetch for agent `fetch` tool

Chat loads merged skills via `generateSkillsSystemPrompt` — see
[chat-streaming.md](./chat-streaming.md).

---

## Cookie BFF — `/api/workspaces/{workspaceId}/skills/*`

Auth: `Cookie: auth-token=<jwt>`. Admin required for mutations (via
`verifyWorkspaceAdmin`).

Implementation:
[`packages/frontend/src/routes/api/workspaces/[workspaceId]/skills/`](https://gitlab.com/cauchye/d6e-ai/d6e/-/tree/main/packages/frontend/src/routes/api/workspaces/%5BworkspaceId%5D/skills)

### `GET /api/workspaces/{id}/skills`

List workspace skills (admin).

Response: array of skill records (`id`, `name`, `description`, `enabled`,
`source`, `createdAt`, …).

### `POST /api/workspaces/{id}/skills`

Create skill from raw markdown (admin).

Body:

```json
{
  "name": "my-skill",
  "description": "Short description for skill picker",
  "content": "# Skill body\n…",
  "enabled": true
}
```

Validation: `validateSkillName`, `validateSkillDescription`, non-empty content.
409 if name duplicate.

### `GET/PATCH/DELETE /api/workspaces/{id}/skills/{skillId}`

| Method | Body (PATCH) | Notes |
| ------ | ------------ | ----- |
| GET | — | Full skill including `content` |
| PATCH | `{ name?, description?, content?, enabled? }` | Partial update |
| DELETE | — | Removes skill + associated files |

### `POST /api/workspaces/{id}/skills/discover`

Preview skills in a remote repo without installing (admin).

Body: `{ url, accessToken? }` — GitHub/GitLab URL; optional private repo token.

Response: `{ skills: […] }` parsed skill metadata.

### `POST /api/workspaces/{id}/skills/upload`

Install from uploaded file (admin). `multipart/form-data` with `file` field.

Accepts `.md`, `.zip`, or `.skill` archives.

Response: `{ skill: {…}, warnings: [] }` — 201.

### `POST /api/workspaces/{id}/skills/install`

Install from URL (admin).

Body: `{ url, accessToken?, skillMdUrl? }`

Response: `{ skill: {…}, warnings: [] }` — 201.

---

## Contrast with Rust `GET …/setup/skills`

| Capability | Cookie BFF | Rust `/api/v1/workspaces/{id}/setup/skills` |
| ---------- | ---------- | --------------------------------------------- |
| Auth | Cookie (admin for writes) | Bearer (admin for writes) |
| List | `GET …/skills` | `GET …/setup/skills` |
| Create metadata | `POST …/skills` (with content) | `POST …/setup/skills` |
| Get / update / delete | `GET/PATCH/DELETE …/skills/{skillId}` | `GET/PATCH/DELETE …/setup/skills/{skillId}` |
| Discover / upload / install | BFF-only routes above | **Not available** on Rust |
| Skill reference files | Stored in frontend DB; served via `/api/v1/skills/{name}/files/…` | Metadata only on Rust side |
| Chat integration | Primary path — skills loaded from frontend DB | Alternate metadata store |

Both may exist in the same deployment. Prefer **one** source of truth for your
app. Bootstrap scripts often use Rust Bearer setup API or POST to BFF depending
on whether the custom frontend proxies the d6e instance.

---

## Public skill markdown pull (no auth)

Used by chat `fetch` tool and external agents to retrieve merged skill content.

### `GET /api/v1/skills/{name}?workspaceId=<uuid>`

| | |
| --- | --- |
| Auth | **None** |
| Query | `workspaceId` required |
| Response | `text/markdown` — merged skill body |
| Errors | 400 missing workspaceId; 404 unknown skill |

Implementation:
[`packages/frontend/src/routes/api/v1/skills/[name]/+server.ts`](https://gitlab.com/cauchye/d6e-ai/d6e/-/blob/main/packages/frontend/src/routes/api/v1/skills/%5Bname%5D/+server.ts)

**Security note:** Anyone who knows `workspaceId` + skill name can fetch
markdown. Do not embed secrets in skill content.

### `GET /api/v1/skills/{name}/files/{...path}?workspaceId=<uuid>`

| | |
| --- | --- |
| Auth | **None** |
| Query | `workspaceId` required |
| Response | `text/plain` reference file content |
| Errors | 404 if path not found |

Serves auxiliary reference files bundled with uploaded/installed skills.

---

## Custom frontend guidance

| Goal | Route |
| ---- | ----- |
| Admin skill library UI | Proxy Cookie BFF `…/skills/*` |
| CI bootstrap skill registration | Rust `POST …/setup/skills` (Bearer) or BFF POST |
| Install from GitHub in UI | `POST …/skills/install` or `…/discover` then install |
| Agent reads skill at runtime | Handled by chat — or `GET /api/v1/skills/{name}?workspaceId=` |

Skills affect chat system prompt, not execute-by-intent directly (unless the
intent agent loads MCP which includes skill-aware fetch).

---

## Related

- [chat-streaming.md](./chat-streaming.md) — how skills enter chat context
- [workspace-setup.md](./workspace-setup.md) — Rust setup API overview
- [console-bff-catalog.md](./console-bff-catalog.md) — BFF vs Rust table
- [mcp-rest-map.md](./mcp-rest-map.md) — `d6e_list_workspace_skills` mapping
- [api-catalog.md](./api-catalog.md) — master index
