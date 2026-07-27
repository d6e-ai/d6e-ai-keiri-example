# STFs and Effects

State Transition Functions (STFs) and Effects are workspace-scoped building blocks
for workflows. STFs run compute (JavaScript, Docker, Wasm); Effects call external
HTTP APIs with workspace-managed configuration.

All STF and Effect routes require **`X-Workspace-ID`**. Missing header → 400.
See [auth-header-matrix.md](./auth-header-matrix.md).

---

## STFs — CRUD

| Method | Path | Purpose |
| ------ | ---- | ------- |
| `GET` | `/api/v1/stfs` | List STFs |
| `POST` | `/api/v1/stfs` | Create STF + initial version |
| `GET` | `/api/v1/stfs/{id}` | Get STF metadata |
| `PATCH` | `/api/v1/stfs/{id}` | Update name/description/is_public |
| `DELETE` | `/api/v1/stfs/{id}` | Soft delete |

### Auth

```
Authorization: Bearer <jwt>
X-Workspace-ID: <wsId>
Content-Type: application/json
```

### Create payload (summary)

```ts
{
  name: string;                    // 1–255 chars
  description?: string;
  is_public?: boolean;
  version: string;                 // semver
  runtime: 'javascript' | 'docker' | 'wasm';
  code: string;                    // base64-encoded bytes
  input_schema?: object;
  output_schema?: object;
}
```

---

## STF versions

| Method | Path | Purpose |
| ------ | ---- | ------- |
| `GET` | `/api/v1/stfs/{id}/versions` | List semver versions |
| `POST` | `/api/v1/stfs/{id}/versions` | Publish new version |

Workflow steps reference `stf_version_id` — pin versions in production workflows
with `pin_version: true` in step definitions. See [workflows.md](./workflows.md).

---

## STF instant-run

Run a single STF version without composing a workflow:

```
POST /api/v1/stfs/instant-run
X-Workspace-ID: <wsId>
Authorization: Bearer <jwt>

{
  "stf_version_id": "<uuid>",
  "input": { /* matches input_schema */ }
}
```

Returns the STF output JSON directly. Useful for debugging and one-off admin
tools.

---

## STF describe

Infer or validate input/output JSON Schema from code:

```
POST /api/v1/stfs/{id}/describe
X-Workspace-ID: <wsId>

{ "version": "1.0.0" }   /* optional — defaults to latest */
```

Used by the d6e console editor before publishing a version.

---

## STF secrets

Per-STF environment secrets (injected at runtime for Docker/JS STFs):

| Method | Path | Purpose |
| ------ | ---- | ------- |
| `GET` | `/api/v1/stfs/{stfId}/secrets` | List secret **key names** (not values) |
| `POST` | `/api/v1/stfs/{stfId}/secrets` | Upsert `{ "env_key": "…", "value": "…" }` |
| `DELETE` | `/api/v1/stfs/{stfId}/secrets/{envKey}` | Remove secret |

Values are write-only — list returns keys only.

### Docker STF `api_token` is SQL-only

Docker STF containers receive a short-lived **`api_token`** env var for calling
**workspace SQL** from inside the container. That token is **not** a general
d6e API key — it cannot call SaaS proxy, file storage, or other `/api/v1`
routes.

For external SaaS from custom frontends:

- Use [saas-proxy.md](./saas-proxy.md) or Effect steps in workflows
- Use MCP tools from execute-by-intent (LLM path)
- Do **not** expose container `api_token` to the browser

See the **d6e-docker-stf-development** skill for container runtime details.

---

## STF libraries (global)

Shared library catalog — not workspace-scoped:

| Method | Path | Auth | Purpose |
| ------ | ---- | ---- | ------- |
| `GET` | `/api/v1/stf-libraries` | Bearer | List libraries |
| `GET` | `/api/v1/stf-libraries/{name}/types` | Bearer | TypeScript type defs |

No `X-Workspace-ID` required.

---

## Effects — CRUD

| Method | Path | Purpose |
| ------ | ---- | ------- |
| `GET` | `/api/v1/effects` | List effects |
| `POST` | `/api/v1/effects` | Create effect + initial version |
| `GET` | `/api/v1/effects/{id}` | Get effect |
| `PATCH` | `/api/v1/effects/{id}` | Update metadata |
| `DELETE` | `/api/v1/effects/{id}` | Soft delete |

Same auth headers as STFs.

Effects define HTTP calls (method, URL template, headers, body mapping) executed
during workflow runs. Workflow steps reference `effect_version_id`.

### Create payload

```ts
{
  name: string;                    // 1–255 chars
  description?: string;            // max 1000 chars
  is_public?: boolean;
  version: string;                 // semver, e.g. "1.0.0"
  url: string;                     // absolute URL
  method: string;                  // GET | POST | PUT | PATCH | DELETE | HEAD | OPTIONS
  input_schema?: object;           // JSON Schema object
  header_mappings: FieldMapping[]; // required (may be [])
  body_mappings: FieldMapping[];   // required (may be [])
  query_mappings?: FieldMapping[]; // default []
}
```

`FieldMapping` shape (effect mappings use simple field paths — no `$input` prefix):

```json
{
  "source": { "type": "Variable", "value": "customer_id" },
  "target": "id"
}
```

Static values:

```json
{
  "source": { "type": "Const", "value": "application/json" },
  "target": "Content-Type"
}
```

Example create:

```json
POST /api/v1/effects
X-Workspace-ID: <wsId>
Authorization: Bearer <jwt>

{
  "name": "notify-slack",
  "version": "1.0.0",
  "url": "https://hooks.slack.com/services/…",
  "method": "POST",
  "header_mappings": [],
  "body_mappings": [
    {
      "source": { "type": "Variable", "value": "message" },
      "target": "text"
    }
  ],
  "query_mappings": []
}
```

---

## Effect versions

| Method | Path | Purpose |
| ------ | ---- | ------- |
| `GET` | `/api/v1/effects/{id}/versions` | List versions |
| `POST` | `/api/v1/effects/{id}/versions` | Publish new version |

### Create version payload

Same HTTP/mapping fields as create (without `name` / `description` / `is_public`):

```ts
{
  version: string;                 // semver
  url: string;
  method: string;
  input_schema?: object;
  header_mappings: FieldMapping[];
  body_mappings: FieldMapping[];
  query_mappings?: FieldMapping[]; // default []
}
```

```json
POST /api/v1/effects/{effectId}/versions
X-Workspace-ID: <wsId>

{
  "version": "1.1.0",
  "url": "https://api.example.com/v2/notify",
  "method": "POST",
  "header_mappings": [
    {
      "source": { "type": "Const", "value": "Bearer secret" },
      "target": "Authorization"
    }
  ],
  "body_mappings": [
    {
      "source": { "type": "Variable", "value": "payload" },
      "target": "body"
    }
  ]
}
```

Workflow steps reference `effect_version_id`. Pin with `pin_version: true` in
step definitions — see [workflows.md](./workflows.md).

---

## Docker STF performance

First execution may pull container images and exceed default fetch timeouts.
Workflow execute proxies should use **≥ 120 s** timeout when Docker STFs are
involved — see [workflows.md](./workflows.md).

---

## Related

- [workflows.md](./workflows.md) — compose STF/Effect steps
- [policies.md](./policies.md) — editor permission gates
- [api-catalog.md](./api-catalog.md) — master index
