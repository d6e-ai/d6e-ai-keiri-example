# Workflows — CRUD and execute

Named automation graphs combining input steps, STF steps, and Effect steps.
Custom frontends typically list workflows, resolve one by name, and execute it
with a JSON input payload.

All routes require **`X-Workspace-ID`** from `getD6eWorkspaceId(caller)`.
Missing header → `400 Missing X-Workspace-ID header`. See
[auth-header-matrix.md](./auth-header-matrix.md).

## Endpoints

| Method | Path | Body | Response |
| ------ | ---- | ---- | -------- |
| `GET` | `/api/v1/workflows` | — | `Workflow[]` |
| `POST` | `/api/v1/workflows` | create payload | `Workflow` |
| `GET` | `/api/v1/workflows/{id}` | — | `Workflow` |
| `PATCH` | `/api/v1/workflows/{id}` | partial update | `Workflow` |
| `DELETE` | `/api/v1/workflows/{id}` | — | 204 |
| `POST` | `/api/v1/workflows/{id}/execute` | JSON input (workflow `$input`) | last step output JSON |

### Auth (CRUD)

```
Authorization: Bearer <jwt>
X-Workspace-ID: <wsId>
Content-Type: application/json
```

### Auth (execute)

```
X-Workspace-ID: <wsId>          # required
Authorization: Bearer <jwt>     # optional — anonymous execute allowed
Content-Type: application/json
```

Execute is the only `/api/v1` route where Bearer is optional. The workspace
header is still mandatory.

## Workflow shape

```ts
interface Workflow {
  id: string;
  workspace_id: string;
  name: string;
  description?: string;
  input_schema?: Record<string, unknown>;
  input_steps: unknown[];
  stf_steps: unknown[];
  effect_steps: unknown[];
  created_at: string;
  updated_at: string;
}
```

Create/update payloads accept `input_steps`, `stf_steps`, and `effect_steps`
with version ids and field mappings — see d6e console
[`d6e-cloud.ts`](https://gitlab.com/cauchye/d6e-ai/d6e/-/blob/main/packages/frontend/src/lib/server/d6e-cloud.ts)
`CreateWorkflowPayload` / `UpdateWorkflowPayload`.

## List-by-name pattern (expense-check)

There is **no** `GET /workflows/by-name/{name}` endpoint. Resolve a workflow id
by listing and matching exactly:

```ts
const rows = await listWorkflows(accessToken, workspaceId);
const match = rows.find((w) => w.name === 'senna46/expense-check/check-expenses');
if (!match) throw new Error(`Workflow not found. Available: ${rows.map((w) => w.name).join(', ')}`);
```

Installed d6e Apps prefix workflow names with `{owner}/{repo}/{workflow}`.
Memoize name → id in your server process — app re-installs update in place
(same id).

Reference implementation:
[`d6e-expense-check-frontend/src/lib/server/d6e-client.ts`](https://github.com/d6e-ai/d6e-expense-check-frontend/blob/main/src/lib/server/d6e-client.ts)
(`findWorkflowIdByName`).

## Execute

```ts
POST /api/v1/workflows/{workflowId}/execute
X-Workspace-ID: <wsId>
Authorization: Bearer <jwt>
Content-Type: application/json

{ /* workflow input — mapped to $input in step definitions */ }
```

Response body is the JSON output of the **last STF step** in the workflow.

Common errors:

| Status | Cause |
| ------ | ----- |
| 400 | Missing `X-Workspace-ID` or input validation failure |
| 404 | Workflow id not found in workspace |
| 500 | STF runtime error, Effect HTTP failure, unsupported Wasm runtime |

## Docker STF timeout tip

Workflows that include **Docker STF** steps can be slow on first run (image
pull, cold start). Use a generous server-side timeout — the expense-check
frontend uses **120 seconds** for `executeWorkflow`. Combine with
`AbortSignal.any([AbortSignal.timeout(ms), event.request.signal])` so tab
close cancels the outbound fetch.

For LLM-driven runs that exceed platform limits, prefer
[execute-by-intent async jobs](./async-intent-jobs.md) instead of workflow
execute when appropriate.

## Server-side pinning

```ts
const workspaceId = getD6eWorkspaceId(caller);
await fetch(`${getD6eUrl(caller)}/api/v1/workflows/${id}/execute`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${accessToken}`,
    'X-Workspace-ID': workspaceId,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(input),
  signal: AbortSignal.timeout(120_000)
});
```

Never accept workflow id or workspace id from the browser without validating
against your pinned env when building admin UIs.

## Related

- [stfs-and-effects.md](./stfs-and-effects.md) — STF/Effect definitions referenced by steps
- [api-catalog.md](./api-catalog.md) — full endpoint index
- [platform-timeouts.md](./platform-timeouts.md) — Vercel / Cloudflare guidance
