# Pinned charts

Dashboard saved charts: each row stores a SQL query and chart configuration.
Data is fetched dynamically by re-running `sql_query` — not cached snapshot rows.

All routes require **`X-Workspace-ID`**. Workspace is resolved from the header
only. See [auth-header-matrix.md](./auth-header-matrix.md).

## Endpoints

| Method | Path | Body | Response |
| ------ | ---- | ---- | -------- |
| `GET` | `/api/v1/pinned-charts` | — | `PinnedChart[]` (visible only) |
| `POST` | `/api/v1/pinned-charts` | create payload | `PinnedChart` |
| `GET` | `/api/v1/pinned-charts/{id}` | — | `PinnedChart` |
| `PATCH` | `/api/v1/pinned-charts/{id}` | partial update | `PinnedChart` |
| `DELETE` | `/api/v1/pinned-charts/{id}` | — | 204 (soft delete) |

### Auth

```
Authorization: Bearer <jwt>
X-Workspace-ID: <wsId>
Content-Type: application/json
```

## Types

```ts
type ChartType = 'bar' | 'line' | 'pie' | 'table' | 'number' | /* … */;

interface PinnedChart {
  id: string;
  workspace_id: string;
  title: string;
  description?: string | null;
  sql_query: string;
  chart_type: ChartType;
  x_axis_column?: string | null;
  y_axis_columns?: string[] | null;
  display_order?: number;
  is_visible: boolean;
  created_at: string;
  updated_at: string;
}
```

## Create

```json
POST /api/v1/pinned-charts
{
  "title": "Monthly spend",
  "description": "Sum by category",
  "sql_query": "SELECT category, SUM(amount) AS total FROM expense_line_items GROUP BY category",
  "chart_type": "bar",
  "x_axis_column": "category",
  "y_axis_columns": ["total"],
  "display_order": 0
}
```

`sql_query` uses **logical table names** — rewritten to prefixed physical names
at execute time. See [sql.md](./sql.md).

## List — visible only

`GET /api/v1/pinned-charts` filters `is_visible = true` and excludes soft-deleted
rows. Hidden charts (`is_visible: false`) are omitted from the list but remain
addressable by id via GET/PATCH.

Ordering: `display_order` ascending, then `created_at` descending.

## Update

PATCH accepts any subset of create fields plus `is_visible` to show/hide without
deleting.

## Execute chart data

The pinned chart API stores configuration only. To render chart data in a custom
frontend:

1. Fetch chart definition via GET
2. Run `sql_query` through your SQL proxy (`POST …/sql`)
3. Map rows to your chart library using `chart_type`, `x_axis_column`, and
   `y_axis_columns`

Respect SQL policies — denied queries return `POLICY_DENIED`. See [sql.md](./sql.md).

## Custom frontend: Rust Bearer, not Cookie BFF

```text
┌─────────────────────────────────────────────────────────────┐
│ Custom FE dashboards → POST /api/v1/pinned-charts (Bearer)  │
│                      + X-Workspace-ID                       │
│                      + SQL via POST …/sql (policy-aware)    │
├─────────────────────────────────────────────────────────────┤
│ d6e console BI UI  → Cookie BFF /api/workspaces/{id}/       │
│                      pinned-charts (frontend DB, per-user)    │
└─────────────────────────────────────────────────────────────┘
```

The Cookie BFF and Rust API are **different backends**:

| Surface | Path | Storage | Policies on chart SQL |
| ------- | ---- | ------- | --------------------- |
| **Rust (use this)** | `/api/v1/pinned-charts` | Workspace API | Yes — via `POST …/sql` |
| **Console BFF** | `/api/workspaces/{id}/pinned-charts` | Frontend Postgres | No — local per-user charts |

Custom frontends must use **Rust Bearer + `X-Workspace-ID`**, then re-run
`sql_query` through your SQL proxy. Do not call the Cookie BFF pinned-chart
routes unless you intentionally share the console's local DB semantics.

See [console-bff-catalog.md](./console-bff-catalog.md) § Pinned charts.

## Related

- [sql.md](./sql.md) — query execution, table naming
- [api-catalog.md](./api-catalog.md) — master index
