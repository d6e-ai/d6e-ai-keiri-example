# Google Drive sync API

Workspace-scoped endpoints to mirror selected Google Drive folders / shared
drives into d6e storage and the `drive_files` SQL projection. LLM tools query
`drive_files` via SQL instead of calling the Drive API on every turn.

**Workspace id is never in the URL path.** Supply `workspace_id` in the query
string (GET) or JSON body (writes). Pin server-side from `D6E_WORKSPACE_ID` —
never trust the browser. See [auth-header-matrix.md](./auth-header-matrix.md).

Requires a connected **`google_workspace`** SaaS credential in the workspace
(d6e console settings). See [workspace-setup.md](./workspace-setup.md).

## Endpoints

| Method | Path | `workspace_id` location | Purpose |
| ------ | ---- | ----------------------- | ------- |
| `GET` | `/api/v1/drive-sync/status` | query | Status, config, roots, `node_count` |
| `GET` | `/api/v1/drive-sync/config` | query | Config + roots snapshot |
| `PUT` | `/api/v1/drive-sync/config` | body | Update enabled + sync interval |
| `GET` | `/api/v1/drive-sync/roots` | query | List sync roots |
| `POST` | `/api/v1/drive-sync/roots` | body | Add sync root |
| `DELETE` | `/api/v1/drive-sync/roots/{rootId}` | query | Remove root |
| `POST` | `/api/v1/drive-sync/sync` | body | Trigger background sync |
| `POST` | `/api/v1/drive-sync/materialize` | body | Copy Drive file → `storage_file` |
| `POST` | `/api/v1/drive-sync/read` | body | Read Drive file text/metadata |
| `GET` | `/api/v1/drive-sync/picker` | query | Browse folders for picker UI |

### Auth (all routes)

```
Authorization: Bearer <jwt>
Content-Type: application/json   /* writes */
```

No `X-Workspace-ID` header — workspace comes from body/query only.

---

## Status

```
GET /api/v1/drive-sync/status?workspace_id=<wsId>
```

```ts
interface DriveSyncStatus {
  config: DriveSyncConfig | null;
  roots: DriveSyncRoot[];
  node_count: number;
}
```

Use after triggering sync — background job updates `last_synced_at` /
`last_sync_error` on config.

---

## Config

**Get:**

```
GET /api/v1/drive-sync/config?workspace_id=<wsId>
```

**Update:**

```json
PUT /api/v1/drive-sync/config
{
  "workspace_id": "<wsId>",
  "enabled": true,
  "sync_interval_seconds": 3600
}
```

---

## Sync roots

Roots define which Drive folders or shared drives are mirrored.

**List:**

```
GET /api/v1/drive-sync/roots?workspace_id=<wsId>
```

**Add:**

```json
POST /api/v1/drive-sync/roots
{
  "workspace_id": "<wsId>",
  "drive_id": "<driveFolderOrSharedDriveId>",
  "drive_type": "folder",          /* folder | shared_drive | my_drive */
  "name": "Finance",
  "shared_drive_id": null          /* set when drive_type = shared_drive child */
}
```

**Delete:**

```
DELETE /api/v1/drive-sync/roots/{rootId}?workspace_id=<wsId>
```

---

## Trigger sync

```json
POST /api/v1/drive-sync/sync
{ "workspace_id": "<wsId>" }
```

Returns immediately — sync runs in the background. Poll
`GET …/status` until `last_synced_at` advances or `last_sync_error` is set.

Typical UI flow:

1. POST `/sync`
2. Poll `/status` every few seconds
3. Show error from `config.last_sync_error` on failure

---

## Materialize

Copy a synced Drive node's bytes into workspace storage for download, LLM file
tools, or [saas-proxy](./saas-proxy.md) `file_id` attachment:

```json
POST /api/v1/drive-sync/materialize
{
  "workspace_id": "<wsId>",
  "drive_file_id": "<id from drive_files projection>"
}
```

Response includes `storage_file_id` for
[download-two-step.md](./download-two-step.md).

**Synchronous** — large files block the request until complete.

---

## Read

Read file content without persisting to storage (preview, text extraction):

```json
POST /api/v1/drive-sync/read
{
  "workspace_id": "<wsId>",
  "drive_file_id": "<id>"
}
```

---

## Picker

Folder browser for admin UI when adding sync roots:

```
GET /api/v1/drive-sync/picker?workspace_id=<wsId>&parent=<folderId>&shared_drives=true
```

```ts
interface DrivePickerResponse {
  folders: { id: string; name: string }[];
  shared_drives: { id: string; name: string }[];
}
```

---

## SQL projection

After sync, query mirrored metadata via workspace SQL:

```sql
SELECT id, name, mime_type, modified_time
FROM drive_files
WHERE name ILIKE '%invoice%'
```

Table naming rules apply — see [sql.md](./sql.md). External skill:
**d6e-saas-google-workspace** (`drive_files` + MCP tools).

---

## Server-side pinning example

```ts
const workspaceId = getD6eWorkspaceId(caller);
await fetch(`${getD6eUrl(caller)}/api/v1/drive-sync/sync`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ workspace_id: workspaceId })
});
```

Overwrite any browser-supplied `workspace_id` before forwarding.

## Related

- [saas-proxy.md](./saas-proxy.md) — direct Drive API calls with credentials
- [sql.md](./sql.md) — query `drive_files`
- [api-catalog.md](./api-catalog.md) — master index
