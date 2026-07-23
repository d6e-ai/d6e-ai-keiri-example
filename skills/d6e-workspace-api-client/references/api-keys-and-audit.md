# API keys and audit logs

User-scoped API key management and workspace audit log queries.

---

## API keys

Long-lived `d6e_*` keys for scripts and local AI tooling. Keys authenticate as
`Authorization: Bearer d6e_…` on most `/api/v1` routes — see
[auth-header-matrix.md](./auth-header-matrix.md).

**Session-only:** these management routes reject API keys and scoped JWTs.

| Method | Path | Auth | Purpose |
| ------ | ---- | ---- | ------- |
| `GET` | `/api/v1/api-keys` | Bearer (session only) | List caller's keys |
| `POST` | `/api/v1/api-keys` | Bearer (session only) | Create key |
| `DELETE` | `/api/v1/api-keys/{id}` | Bearer (session only) | Revoke key |

### Auth

```
Authorization: Bearer <jwt>    # human session JWT — not d6e_* API key
Content-Type: application/json
```

Server checks:

- `auth.require_session()` — must be a browser/session token
- `auth.reject_scoped_token()` — workspace-scoped JWTs cannot manage keys

### Create

```json
POST /api/v1/api-keys
{
  "name": "local dev script",
  "expires_at": "2027-01-01T00:00:00Z"   /* optional */
}
```

**Response (201):**

```json
{
  "id": "<uuid>",
  "key": "d6e_019b…"    /* shown ONCE — store securely */
}
```

The raw key is never returned again. List returns metadata only (id, name,
created_at, expires_at).

### Delete

```
DELETE /api/v1/api-keys/{id}
```

Soft-deletes the key. Existing requests with the old key fail on next use.

### Custom frontend note

Most dedicated frontends do **not** expose API key CRUD to end users. Keys are
created in the d6e console or via admin tooling. Document here so integrators
do not attempt key management with a `d6e_*` bearer and hit 403.

Workspace **creation** (`POST /api/v1/workspaces`) is also session-only with
the same scoped-token rejection.

---

## Audit logs

Workspace-scoped activity trail for admin dashboards and compliance UIs.

| Method | Path | Auth | Purpose |
| ------ | ---- | ---- | ------- |
| `GET` | `/api/v1/audit-logs` | Bearer + X-WS-ID | List filtered entries |

### Auth

```
Authorization: Bearer <jwt>
X-Workspace-ID: <wsId>
```

### Query parameters

| Param | Type | Purpose |
| ----- | ---- | ------- |
| `user_id` | uuid | Filter by acting user |
| `action` | string | Exact match, or prefix with `*` (e.g. `execute_sql*`) |
| `resource_type` | string | e.g. `workflow`, `storage_file`, `api_key` |
| `resource_id` | uuid | Specific resource |
| `limit` | number | Default 100, max 1000 |
| `offset` | number | Pagination offset |

Example:

```
GET /api/v1/audit-logs?action=execute_sql*&limit=50
X-Workspace-ID: <wsId>
Authorization: Bearer <jwt>
```

### Response entry

```ts
interface AuditLogEntry {
  id: string;
  user_id: string;
  workspace_id?: string | null;
  api_key_id?: string | null;
  action: string;
  resource_type: string;
  resource_id?: string | null;
  details?: object | null;
  created_at: string;
}
```

SQL operations log actions like `execute_sql_select`, `execute_sql_insert`, etc.
Use the `execute_sql*` prefix filter to audit all SQL activity.

### Custom frontend proxy

Pin `X-Workspace-ID` from env. Forward query params from admin UI but validate
`limit` ≤ 1000 server-side to prevent abuse.

## Related

- [auth-header-matrix.md](./auth-header-matrix.md) — API key vs session matrix
- [sql.md](./sql.md) — SQL audit action names
- [api-catalog.md](./api-catalog.md) — master index
