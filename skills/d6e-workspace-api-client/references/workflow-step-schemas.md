# Workflow step JSON schemas

Canonical shapes for `input_steps`, `stf_steps`, and `effect_steps` on workflow
create/update payloads and in `GET /api/v1/workflows/{id}` responses.

Source types (Rust):

- [`packages/types/src/v1/input_source.rs`](https://github.com/d6e-ai/d6e/blob/main/packages/types/src/v1/input_source.rs)
- [`packages/types/src/v1/field_source.rs`](https://github.com/d6e-ai/d6e/blob/main/packages/types/src/v1/field_source.rs)

Console mirror:
[`packages/frontend/src/lib/server/d6e-cloud.ts`](https://github.com/d6e-ai/d6e/blob/main/packages/frontend/src/lib/server/d6e-cloud.ts)
(`CreateWorkflowPayload`).

See [workflows.md](./workflows.md) for CRUD/execute endpoints.

---

## Workflow container

```ts
interface Workflow {
  id: string;
  workspace_id: string;
  name: string;
  description?: string;
  input_schema?: Record<string, unknown>;  // JSON Schema for $input
  input_steps: InputStep[];
  stf_steps: StfStep[];
  effect_steps: EffectStep[];
  created_at: string;
  updated_at: string;
}
```

Execution order: **input_steps** (load `$sources`) → **stf_steps** (chain) →
**effect_steps** (HTTP side effects). Execute body JSON maps to **`$input`**.

---

## `input_steps` — `InputStep[]`

Each step exposes a named source as `$sources.{name}` in later STF code.

```ts
interface InputStep {
  name: string;                    // referenced as $sources.{name}
  source: InputSource;
  content_type?: string;           // optional; validation hint only (often no-op)
}
```

### `InputSource` (tagged union — `type` discriminator)

```ts
type InputSource =
  | { type: 'Library'; name: string }
  | { type: 'File'; id: string }   // storage_file UUID
  | {
      type: 'Fetch';
      url: string;
      method?: string;             // default "GET"
      headers?: Record<string, string>;
      body?: unknown;               // POST/PUT/PATCH
      timeout_secs?: number;       // default 30, max 60
    };
```

| Variant | Purpose | Limits |
| ------- | ------- | ------ |
| `Library` | Global STF library (e.g. `crypto-js`) | Global scope |
| `File` | Workspace `storage_file` by UUID | Workspace-scoped |
| `Fetch` | HTTP GET/POST/PUT/PATCH/DELETE | 60 s max timeout; private IPs blocked (SSRF) |

### Examples

**Library:**

```json
{
  "name": "lodash",
  "source": { "type": "Library", "name": "lodash" }
}
```

**File (workspace storage):**

```json
{
  "name": "template",
  "source": { "type": "File", "id": "019b…-uuid" }
}
```

Plugin bundled files get **new UUIDs on every install** — do not hardcode ids in
manifests. See
[bundled-files-in-workflows.md](https://github.com/d6e-ai/d6e-plugin-skills/blob/main/skills/d6e-plugin-development/references/bundled-files-in-workflows.md).

**Fetch:**

```json
{
  "name": "remote-config",
  "source": {
    "type": "Fetch",
    "url": "https://example.com/config.json",
    "method": "GET",
    "timeout_secs": 30
  }
}
```

---

## `stf_steps` — `StfStep[]`

Runs STF (JavaScript/Wasm/Docker) versions in order. Output of step *n* is
available as `$steps[n]` (and fields within mappings).

```ts
interface StfStep {
  stf_version_id: string;          // UUID of stf_version row
  pin_version?: boolean;           // default false
  input_mappings: FieldMapping[];
}
```

| Field | Behavior |
| ----- | -------- |
| `pin_version: true` | Execute exactly `stf_version_id` |
| `pin_version: false` / omitted | Resolve parent STF → latest version by `created_at` |
| `input_mappings` | Map `$input`, `$sources.*`, `$steps[n].*` into STF inputs |

---

## `effect_steps` — `EffectStep[]`

Same mapping model as STF steps, but targets an Effect version (outbound HTTP).

```ts
interface EffectStep {
  effect_version_id: string;
  pin_version?: boolean;
  input_mappings: FieldMapping[];
}
```

Effect definitions also carry `header_mappings`, `body_mappings`, and
`query_mappings` on the Effect version itself — workflow `input_mappings` feed
the Effect's input object. See [stfs-and-effects.md](./stfs-and-effects.md).

---

## Field mapping — `FieldMapping` / `FieldSource`

```ts
interface FieldMapping {
  source: FieldSource;
  target: string;                  // input field name on STF/Effect
}

type FieldSource =
  | { type: 'Const'; value: unknown }
  | { type: 'Variable'; value: string };
```

**Variable** paths are string references interpreted at runtime, for example:

| Path | Meaning |
| ---- | ------- |
| `input.amount` | Field from execute request body (`$input`) |
| `sources.template` | Output of input step named `template` |
| `steps[0].rows` | Output field from first STF step |

### Example STF step

```json
{
  "stf_version_id": "019b…-uuid",
  "pin_version": true,
  "input_mappings": [
    {
      "source": { "type": "Variable", "value": "input.expenses" },
      "target": "expenses"
    },
    {
      "source": { "type": "Const", "value": { "mode": "strict" } },
      "target": "options"
    }
  ]
}
```

---

## Full create payload sketch

```json
POST /api/v1/workflows
X-Workspace-ID: <wsId>
Authorization: Bearer <jwt>

{
  "name": "acme/import-receipts",
  "description": "Parse uploads and insert rows",
  "input_schema": {
    "type": "object",
    "properties": {
      "fileId": { "type": "string", "format": "uuid" }
    },
    "required": ["fileId"]
  },
  "input_steps": [
    {
      "name": "receipt",
      "source": { "type": "File", "id": "019b…-storage-uuid" }
    }
  ],
  "stf_steps": [
    {
      "stf_version_id": "019b…-stf-version-uuid",
      "input_mappings": [
        {
          "source": { "type": "Variable", "value": "sources.receipt" },
          "target": "file"
        }
      ]
    }
  ],
  "effect_steps": []
}
```

---

## Related

- [workflows.md](./workflows.md) — list, execute, auth headers
- [stfs-and-effects.md](./stfs-and-effects.md) — STF/Effect CRUD
- [file-storage.md](./file-storage.md) — upload before `File` input steps
- [bundled-files-in-workflows.md](https://github.com/d6e-ai/d6e-plugin-skills/blob/main/skills/d6e-plugin-development/references/bundled-files-in-workflows.md) — plugin file UUID caveats
