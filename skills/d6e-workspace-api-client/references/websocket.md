# WebSocket — `GET /ws`

Real-time row change notifications for workspace SQL tables. Subscribers receive
`RowInserted`, `RowUpdated`, and `RowDeleted` events when DML executes through
the Rust API SQL layer.

Implementation:
[`packages/api/src/routes/ws.rs`](https://gitlab.com/cauchye/d6e-ai/d6e/-/blob/main/packages/api/src/routes/ws.rs),
[`packages/api/src/broadcast.rs`](https://gitlab.com/cauchye/d6e-ai/d6e/-/blob/main/packages/api/src/broadcast.rs).

**Not** a SvelteKit Cookie route — connects directly to the Rust API host
(`D6E_BASE_URL`), not the frontend BFF.

---

## Connection

```
GET /ws
Authorization: Bearer <api-key-or-jwt>
X-Workspace-ID: <workspace-uuid>
Upgrade: websocket
```

| Header | Required | Notes |
| ------ | -------- | ----- |
| `Authorization: Bearer …` | Yes | API key (`d6e_…`) or JWT |
| `X-Workspace-ID` | Yes | Must be valid UUID; workspace to subscribe |

JWT session cookies (`auth-token`) are **not** accepted — use Bearer only.

Custom frontend pattern: open WebSocket from your **server** or expose a
same-origin WS proxy that attaches Bearer + pinned workspace id. Do not expose
API keys to the browser.

---

## Authentication flow

1. Hash Bearer token; lookup `api_key` table (or validate JWT per deployment).
2. Verify API key owner's workspace membership for `X-Workspace-ID`.
3. On failure: single JSON text message `{ "error": "…" }` then close.
4. On success: subscribe to workspace broadcast channel.

---

## Messages

### Server → client: connected

First message after successful auth:

```json
{
  "type": "connected",
  "workspace_id": "<uuid>"
}
```

### Server → client: row events

Tagged JSON (`BroadcastEvent`):

```json
{
  "type": "RowInserted",
  "data": {
    "table_name": "my_table",
    "row": { "id": "…", "…": "…" }
  }
}
```

```json
{
  "type": "RowUpdated",
  "data": {
    "table_name": "my_table",
    "row": { "id": "…", "…": "…" }
  }
}
```

```json
{
  "type": "RowDeleted",
  "data": {
    "table_name": "my_table",
    "id": "<uuid>"
  }
}
```

`table_name` is the **logical** table name (without workspace schema prefix).

### Client → server: ping

Send text `ping` → receive text `pong`. Use for keepalive.

---

## Event source

Broadcasts are emitted from the Rust SQL execution path when rows change.
Direct PostgreSQL writes outside the API will **not** generate events.

There is no REST polling equivalent — WebSocket or manual refresh only.

---

## Reconnection

If the broadcast channel closes, the server re-subscribes internally. Clients
should reconnect on disconnect with exponential backoff.

---

## Example (Node server proxy sketch)

```ts
import WebSocket from 'ws';

const ws = new WebSocket(`${getD6eUrl('/ws-proxy')}/ws`, {
  headers: {
    Authorization: `Bearer ${process.env.D6E_API_KEY}`,
    'X-Workspace-ID': process.env.D6E_WORKSPACE_ID!
  }
});

ws.on('message', (data) => {
  const event = JSON.parse(data.toString());
  if (event.type === 'RowInserted') {
    // invalidate cache, push to browser via SSE, etc.
  }
});

// keepalive every 30s
setInterval(() => ws.send('ping'), 30_000);
```

---

## Limitations

| Topic | Detail |
| ----- | ------ |
| Auth | Bearer only — no Cookie |
| Scope | One workspace per connection (`X-Workspace-ID`) |
| File/storage changes | Not broadcast — SQL row events only |
| MCP / chat | No WebSocket integration |
| Browser direct | Avoid exposing API key; proxy server-side |

---

## Related

- [sql.md](./sql.md) — SQL execute that triggers broadcasts
- [auth-header-matrix.md](./auth-header-matrix.md) — Bearer conventions
- [api-catalog.md](./api-catalog.md) — master index
