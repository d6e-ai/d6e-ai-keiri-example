# Authentication header matrix

How to attach credentials when proxying d6e from a custom frontend. The JWT
string is identical whether sent as Bearer or `auth-token` cookie — only the
**transport** differs. Cookie bridge pattern:
[cookie-transport-bridge.md](../../d6e-auth-integration/references/cookie-transport-bridge.md).

## Workspace resolution rule of thumb

| Route shape | Workspace resolved from | `X-Workspace-ID` |
| ----------- | ----------------------- | ---------------- |
| `/api/v1/workspaces/{id}/sql`, `/members`, `/invitations`, `/embeddings`, `/setup/*` | Path `{id}` + membership | Optional; must match if sent |
| `/api/v1/workspaces/{id}/files/…`, `/documents/…` | **Header only** (path `{id}` ignored) | **Required** |
| Top-level `/workflows`, `/stfs`, `/effects`, `/policies`, `/policy-groups`, `/pinned-charts`, `/api-keys`, `/audit-logs` | Header only | **Required** |
| `/api/v1/saas-proxy`, `/api/v1/saas-proxy-download`, `/api/v1/drive-sync/*` | Body or query `workspace_id` (pin server-side) | Not used |
| `/api/workflows/execute-by-intent`, `/api/workflows/execute-by-intent/jobs*` | Body `workspaceId` on create; query `workspaceId` on GET `/jobs/limits` | Not used on poll/cancel |
| `/api/chat-sessions`, `/api/workspace-prompt-rules` | Cookie session (`locals.user`) | N/A |

## Full endpoint table

| Endpoint | Auth | Notes |
| -------- | ---- | ----- |
| `POST …/workspaces/{wsId}/files/multipart` | Bearer + `X-Workspace-ID` | `file` + optional `metadata` parts |
| `POST …/workspaces/{wsId}/files` | Bearer + `X-Workspace-ID` | JSON base64 upload |
| `GET …/workspaces/{wsId}/files` | Bearer + `X-Workspace-ID` | List metadata |
| `GET …/workspaces/{wsId}/files/{fileId}` | Bearer + `X-Workspace-ID` | Metadata by id |
| `GET …/workspaces/{wsId}/files/{fileId}/download` | Bearer + `X-Workspace-ID` | Binary stream — proxy only |
| `DELETE …/workspaces/{wsId}/files/{fileId}` | Bearer + `X-Workspace-ID` | 404 = success |
| `POST …/workspaces/{wsId}/sql` | Bearer | Workspace from path |
| `POST …/workspaces/{wsId}/sql/preview` | Bearer | Preview skips policy eval |
| `GET/POST/PATCH/DELETE …/workflows[/{id}[/execute]]` | Bearer + `X-Workspace-ID` | Missing header → 400 |
| `GET …/workspaces/{wsId}/members` | Bearer | Any member |
| `POST/PATCH/DELETE …/members[/{memberId}]` | Bearer (admin) | `LAST_ADMIN` guard |
| `GET …/workspaces/{wsId}` | Bearer | Membership probe |
| `GET/DELETE …/workspaces/{wsId}/invitations[/{id}]` | Bearer (admin) | Pending invite admin |
| `POST /api/workflows/execute-by-intent` | Bearer | Body `workspaceId` server-pinned |
| `* /api/workflows/execute-by-intent/jobs[/{id}[/cancel]]` | Bearer | Create pins `workspaceId` in body |
| `GET /api/workflows/execute-by-intent/jobs/limits` | Bearer | Query `workspaceId`; `{ maxConcurrentJobs, runningCount }` |
| `POST /api/v1/auth/token` | none | Refresh token in JSON body |
| `* /api/v1/drive-sync/*` | Bearer | `workspace_id` in body or query |
| `POST /api/v1/saas-proxy` | Bearer | `workspace_id` in body |
| `POST /api/v1/saas-proxy-download` | Bearer | `workspace_id` in body |
| `* /api/chat-sessions[/…]` | `Cookie: auth-token=<jwt>` | Bearer rejected |
| `POST/GET /api/workspace-prompt-rules` | `Cookie: auth-token=<jwt>` | Admin for POST |

## Common mistakes

| Symptom | Cause | Fix |
| ------- | ----- | --- |
| 401 on `/api/chat-sessions`, Bearer works elsewhere | Sent `Authorization: Bearer` | Use `Cookie: auth-token=<jwt>` |
| 400 "Missing X-Workspace-ID" on workflow execute | Bearer only | Add `X-Workspace-ID` header |
| 400 on file multipart | Missing header | Set `X-Workspace-ID`; path ws id is ignored |
| 403 on file upload | Policy denies storage editor | Check workspace policies |
| execute-by-intent works, workflow execute fails | Different workspace pinning | Header vs body — see table above |

## API keys (local dev / scripts)

Long-lived API keys (`d6e_…`, created in d6e console → API Keys) work
everywhere the table says `Authorization: Bearer <jwt>`.

Cookie-transport routes (`/api/chat-sessions`, `/api/workspace-prompt-rules`)
still require the real session cookie.

See [local-ai-development.md](https://github.com/d6e-ai/d6e-plugin-skills/blob/main/docs/local-ai-development.md).

## Server-side pinning

Never forward a `workspaceId` / `workspace_id` from the browser. Read
`D6E_WORKSPACE_ID` via `getD6eWorkspaceId(caller)` and overwrite before
every upstream call.
