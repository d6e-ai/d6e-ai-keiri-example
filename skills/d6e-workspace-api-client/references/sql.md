# Workspace SQL — execute and preview

Raw SQL against the workspace's `user_data` schema. Logical table names in
your query are rewritten to
`user_data.ws_{uuid_with_underscores}_{logical_name}`.

There is **no** `GET /api/v1/workspaces/{id}/tables` endpoint. List tables
via SQL against `information_schema` (see d6e console
`d6e-cloud.ts` `listTables()`).

## Endpoints

| Method | Path | Request | Response |
| ------ | ---- | ------- | -------- |
| `POST` | `/api/v1/workspaces/{wsId}/sql` | `{ "sql": "<statement>" }` | `{ rows? }` or `{ affected_rows?, executed_sql? }` |
| `POST` | `/api/v1/workspaces/{wsId}/sql/preview` | `{ "sql": "<statement>" }` | preview object (see below) |

### Auth

```
Authorization: Bearer <jwt>
Content-Type: application/json
```

Workspace is resolved from the **path** `{wsId}` plus membership check.
`X-Workspace-ID` is optional; if sent it must match the path.

Pin `{wsId}` from `getD6eWorkspaceId(caller)` — never from the browser body.

## Table naming rules

| Rule | Detail |
| ---- | ------ |
| Logical name max length | **23 characters** |
| Prefix | `ws_{uuid_with_underscores}_` (40 chars) |
| PostgreSQL limit | 63 chars total → 40 + 23 = 63 |
| Example | `expense_line_items` (20) ✓; `expense_line_item_records` (24) ✗ |

Preview responses include `transformed_sql` showing the fully prefixed name.

## Primary keys — use `uuidv7()`

```sql
CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  amount NUMERIC NOT NULL,
  status TEXT NOT NULL
);
```

**Do not use `gen_random_uuid()`.** d6e requires time-ordered UUIDv7 for
B-tree index locality. MCP and API enforce this convention.

## Execute response

**SELECT:**

```json
{
  "rows": [{ "id": "...", "amount": 1200 }],
  "executed_sql": "SELECT … FROM user_data.ws_019b…_invoices …"
}
```

**INSERT / UPDATE / DELETE / DDL:**

```json
{
  "affected_rows": 3,
  "executed_sql": "UPDATE …"
}
```

Single statement only. Multiple statements in one request are rejected.

## Preview response

```json
{
  "proposal_id": "…",
  "original_sql": "UPDATE invoices SET status = 'paid' WHERE id = '…'",
  "transformed_sql": "UPDATE user_data.ws_019b…_invoices SET …",
  "operation": "UPDATE",
  "affected_tables": ["invoices"],
  "requires_approval": true
}
```

| Field | Meaning |
| ----- | ------- |
| `requires_approval` | `false` only for SELECT |
| Policy evaluation | **Not run on preview** — only on execute |

Use preview for human-in-the-loop approval UIs. Do not assume a successful
preview means the user is allowed to run the statement at runtime.

## Error responses

```json
{
  "error": "Policy denied: …",
  "code": "POLICY_DENIED"
}
```

| Code | Meaning |
| ---- | ------- |
| `POLICY_DENIED` | Row-level policy blocked execute (403) — **not** an auth failure |
| `DDL_FORBIDDEN` | User lacks admin / `ddl_policy_group` for DDL |
| `PARSE_ERROR` | SQL syntax rejected |
| `INVALID_TABLE` | Logical name > 23 chars or invalid identifier |
| `EXECUTION_ERROR` | Runtime DB error |
| `FORBIDDEN` | Not a workspace member |
| `WORKSPACE_SCOPE_VIOLATION` | Token scoped to a different workspace |

Forward `{ error, code }` verbatim so the UI can branch on
`POLICY_DENIED` vs parse errors.

## Behaviour notes

- `CREATE TABLE` adds system columns including `deleted_at`.
- `DELETE` becomes soft delete when `deleted_at` exists on the table.
- DDL requires workspace **admin** or membership in the DDL policy group.
- DML requires appropriate row-level policies for the caller.

## Example — preview then execute

```bash
# Preview (no policy evaluation)
curl -sS -X POST "${D6E_BASE_URL}/api/v1/workspaces/${WS_ID}/sql/preview" \
  -H "Authorization: Bearer ${JWT}" \
  -H "Content-Type: application/json" \
  -d '{"sql":"UPDATE invoices SET status = '\''paid'\'' WHERE id = '\''…'\''"}'

# Execute (policies enforced)
curl -sS -X POST "${D6E_BASE_URL}/api/v1/workspaces/${WS_ID}/sql" \
  -H "Authorization: Bearer ${JWT}" \
  -H "Content-Type: application/json" \
  -d '{"sql":"UPDATE invoices SET status = '\''paid'\'' WHERE id = '\''…'\''"}'
```

## Proxy checklist

- [ ] SQL string comes from validated server input only — never raw browser text without sanitization.
- [ ] `{wsId}` in path from `getD6eWorkspaceId(caller)`.
- [ ] Surface `POLICY_DENIED` distinctly from 401/403 membership errors.
- [ ] Do not retry `POLICY_DENIED` blindly — fix SQL, policy, or role.

## Upstream reference

[d6e `packages/api/src/routes/v1/sql.rs`](https://github.com/d6e-ai/d6e/blob/main/packages/api/src/routes/v1/sql.rs)
