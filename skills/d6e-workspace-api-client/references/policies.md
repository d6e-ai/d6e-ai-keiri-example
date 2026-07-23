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

Groups organize policies and map to workspace members. Admin UIs typically:

1. List groups
2. Assign members to groups (workspace membership UI)
3. CRUD policies per group

Exact member↔group assignment may be managed via d6e console or SQL depending
on your deployment — policies reference `policy_group_id`.

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
