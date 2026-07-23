# Policies and policy groups

Row-level access control for workspace SQL tables and storage operations.
Policies attach to a **policy group**; members inherit group assignments.

All routes require **`X-Workspace-ID`**. See
[auth-header-matrix.md](./auth-header-matrix.md).

Mutating routes (POST/PATCH/DELETE) require **editor permission** on the target
resource type — enforced server-side via `check_editor_permission`.

---

## Policies

| Method | Path | Purpose |
| ------ | ---- | ------- |
| `GET` | `/api/v1/policies` | List policies |
| `POST` | `/api/v1/policies` | Create policy |
| `GET` | `/api/v1/policies/{id}` | Get policy |
| `PATCH` | `/api/v1/policies/{id}` | Update policy |
| `DELETE` | `/api/v1/policies/{id}` | Soft delete |

### Auth

```
Authorization: Bearer <jwt>
X-Workspace-ID: <wsId>
Content-Type: application/json
```

### Create payload

```ts
{
  name: string;              // 1–255 chars
  policy_group_id: string;   // uuid
  mode: 'allow' | 'deny';
  table_name: string;        // logical table name (23-char max)
  operation: PolicyOperation;
  condition?: object;        // optional JSON filter
}
```

### Operations (`operation`)

| Value | Applies to |
| ----- | ---------- |
| `select` | SQL SELECT |
| `insert` | SQL INSERT |
| `update` | SQL UPDATE |
| `delete` | SQL DELETE |
| `ddl` | CREATE/ALTER/DROP TABLE |
| `storage_read` | File list/get/download |
| `storage_write` | File upload/delete |

### Modes (`mode`)

| Value | Behavior |
| ----- | -------- |
| `allow` | Permit when condition matches (or unconditionally if no condition) |
| `deny` | Block when condition matches |

SQL execute returns `403` with `POLICY_DENIED` when a deny policy blocks the
statement — preview does **not** evaluate policies. See [sql.md](./sql.md).

Storage upload/download failures with `403` often indicate `storage_write` or
`storage_read` denial — see [file-storage.md](./file-storage.md).

---

## Policy groups

| Method | Path | Purpose |
| ------ | ---- | ------- |
| `GET` | `/api/v1/policy-groups` | List groups |
| `POST` | `/api/v1/policy-groups` | Create group |
| `GET` | `/api/v1/policy-groups/{id}` | Get group |
| `PATCH` | `/api/v1/policy-groups/{id}` | Update group |
| `DELETE` | `/api/v1/policy-groups/{id}` | Soft delete |

Groups organize policies and map workspace **users** and **STFs** (workflow
automation identities) to shared permissions. Policies reference
`policy_group_id`; members inherit access when their user id or STF id appears
in the group.

### Auth

Same as policies — Bearer + `X-Workspace-ID`; editor permission required for
POST/PATCH/DELETE.

### Create payload (`POST /api/v1/policy-groups`)

```json
{
  "name": "Finance editors",
  "user_ids": ["<user-uuid>", "<user-uuid>"],
  "stf_ids": ["<stf-uuid>"]
}
```

| Field | Type | Notes |
| ----- | ---- | ----- |
| `name` | string | Group display name |
| `user_ids` | uuid[] | Workspace member user IDs with this group's permissions |
| `stf_ids` | uuid[] | STF IDs (workflow runners) included in the group |

Both arrays may be empty (group with no members yet). Response is the full
`policy_group` row including generated `id`, `workspace_id`, timestamps.

### Update payload (`PATCH /api/v1/policy-groups/{id}`)

All fields optional — omitted fields are unchanged:

```json
{
  "name": "Renamed group",
  "user_ids": ["<user-uuid>"],
  "stf_ids": []
}
```

| Field | Type | Notes |
| ----- | ---- | ----- |
| `name` | string? | New name |
| `user_ids` | uuid[]? | **Replaces** entire user membership list |
| `stf_ids` | uuid[]? | **Replaces** entire STF membership list |

PATCH sets `user_ids` / `stf_ids` atomically — send the full desired membership
arrays, not a diff. To add one user, GET the group first, append the id, then
PATCH.

### Response shape (GET list / GET one)

```json
{
  "id": "<uuid>",
  "workspace_id": "<uuid>",
  "name": "Finance editors",
  "user_ids": ["…"],
  "stf_ids": ["…"],
  "created_at": "…",
  "updated_at": "…",
  "deleted_at": null
}
```

MCP equivalents: `d6e_create_policy_group`, `d6e_update_policy_group` — see
[mcp-rest-map.md](./mcp-rest-map.md).

Admin UIs typically:

1. List groups (`GET /api/v1/policy-groups`)
2. Resolve member/STF pickers from `GET …/members` and `GET /api/v1/stfs`
3. POST/PATCH groups with `user_ids[]` / `stf_ids[]`
4. CRUD policies referencing `policy_group_id`

---

## Custom frontend guidance

Most read-only custom frontends inherit the signed-in user's policies
automatically — no special headers beyond Bearer + workspace scope.

Build admin policy editors only when your product exposes workspace governance.
Always proxy through server-side routes; never expose policy editing to
untrusted browser code without admin role checks on your BFF.

## Related

- [sql.md](./sql.md) — POLICY_DENIED on execute
- [file-storage.md](./file-storage.md) — storage_read/write gates
- [members-and-invitations.md](./members-and-invitations.md) — admin roles
- [api-catalog.md](./api-catalog.md) — master index
