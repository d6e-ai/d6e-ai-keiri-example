# Chat sessions (Cookie BFF)

Persisted chat history for the d6e console and custom frontends that proxy the
instance SvelteKit app. Sessions live in `frontend.chat_session` (PostgreSQL on
the instance) — **no Rust `/api/v1` equivalent**.

## Auth

```
Cookie: auth-token=<jwt>
```

Bearer is **rejected**. Custom frontends must forward the session cookie to
`D6E_BASE_URL` (same-origin proxy pattern). See
[cookie transport bridge](../../d6e-auth-integration/references/cookie-transport-bridge.md)
and [auth-header-matrix.md](./auth-header-matrix.md).

Implementation:
[`packages/frontend/src/routes/api/chat-sessions/`](https://github.com/d6e-ai/d6e/tree/main/packages/frontend/src/routes/api/chat-sessions)

---

## Endpoints

| Method | Path | Auth | Purpose |
| ------ | ---- | ---- | ------- |
| `GET` | `/api/chat-sessions?workspaceId=` | Cookie (member) | List sessions (newest `updatedAt` first) |
| `POST` | `/api/chat-sessions` | Cookie (member) | Create session |
| `GET` | `/api/chat-sessions/{id}` | Cookie (member) | Get session |
| `PATCH` | `/api/chat-sessions/{id}` | Cookie (member) | Update title and/or messages |
| `DELETE` | `/api/chat-sessions/{id}` | Cookie (member) | Delete session (+ best-effort file cleanup) |
| `POST` | `/api/chat-sessions/generate-title` | Cookie | LLM title generation |

All routes require `locals.user`. Membership is checked against the session's
workspace (or `workspaceId` on list/create).

---

## GET — list

**Query parameters**

| Param | Required | Notes |
| ----- | -------- | ----- |
| `workspaceId` | Yes | UUID; caller must be a workspace member |

**Response:** `200` — array of session rows, ordered by `updatedAt` descending.

```json
[
  {
    "id": "018f…",
    "workspaceId": "018e…",
    "title": "Invoice review",
    "messages": [ /* UIMessage[] or legacy Message[] */ ],
    "snsSource": null,
    "externalConversationKey": null,
    "createdAt": "2026-01-15T10:00:00.000Z",
    "updatedAt": "2026-01-15T10:05:00.000Z"
  }
]
```

| Status | Cause |
| ------ | ----- |
| 400 | Missing `workspaceId` |
| 401 | No session cookie |
| 403 | Not a workspace member |

There is no pagination, search, or `limit` query param — the handler returns all
sessions for the workspace.

---

## POST — create

**Request body**

```json
{
  "workspaceId": "018e…",
  "title": "Optional title",
  "messages": []
}
```

| Field | Required | Notes |
| ----- | -------- | ----- |
| `workspaceId` | Yes | Member check |
| `title` | No | Defaults to `null` |
| `messages` | No | Defaults to `[]`; stripped before insert (see below) |

**Response:** `201` — created session row (same shape as list item).

`snsSource` and `externalConversationKey` exist on the schema but are **not**
accepted on this REST handler. SNS bots set them internally via
`persistSnsChatSession` when calling
`POST /api/workflows/execute-by-intent` with matching `snsSource` +
`externalConversationKey` in the body. Returned rows may include those fields
when populated by that path.

| `snsSource` values | `externalConversationKey` |
| ------------------ | ------------------------- |
| `slack`, `discord`, `line` | Opaque thread id (max length enforced server-side) |

---

## GET / PATCH / DELETE — single session

### GET `/api/chat-sessions/{id}`

Returns the full session row. `404` when id missing; `403` when authenticated
but not a member of the owning workspace.

### PATCH `/api/chat-sessions/{id}`

**Request body** (all fields optional):

```json
{
  "title": "Renamed session",
  "messages": [ /* full replacement array */ ]
}
```

**UIMessage persistence:** `messages` is stored as JSONB. New chat UI writes
**Vercel AI SDK `UIMessage[]`** (`id`, `role`, `parts`, optional `metadata`).
Legacy sessions may still hold pre-Phase-2 `Message[]`; the session adapter
converts on load. Before save, the server runs
`stripNonPersistedChatSessionMessages` to drop non-persisted UI parts.

**409 conflict — assistant wipe guard:** If the session already has one or more
assistant messages and the PATCH would set `messages` to an array with **zero**
assistant messages, the server returns:

```json
HTTP 409
{
  "error": "Refusing to overwrite chat history: update would remove all assistant messages"
}
```

This blocks stale clients from silently truncating completed conversations.
Normal saves only append turns or update in place — they never go from N>0
assistant messages to zero.

### DELETE `/api/chat-sessions/{id}`

Deletes the row. When attached storage files are referenced in `messages`,
best-effort `deleteStorageFile` runs (requires auth cookie). Response:
`{ "success": true }`.

---

## POST `/api/chat-sessions/generate-title`

LLM-based title for a session. Thin wrapper around `generateChatTitle` —
workspace title rule is applied server-side.

**Request body**

```json
{
  "workspaceId": "018e…",
  "messages": [
    { "role": "user", "content": "Summarize last month's expenses" },
    { "role": "assistant", "content": "Here is a breakdown…" }
  ],
  "provider": "google",
  "model": "gemini-…"
}
```

| Field | Required | Notes |
| ----- | -------- | ----- |
| `workspaceId` | Yes | Entitlement / metering attribution |
| `messages` | Yes | Non-empty; typically first user + optional assistant turn |
| `provider`, `model` | No | Hint for fallback when lightweight title model fails; **not** forced as title model |

**Response:** `200`

```json
{ "title": "Monthly expense summary" }
```

**402 billing gate** (`llm_soft_gated`):

```json
HTTP 402
{
  "error": "llm_soft_gated",
  "reason": "…",
  "message": "…"
}
```

Callers should fall back to a deterministic title builder when gated or on error.
Title naming conventions also honor `workspace_title_rule` — see
[workspace-setup.md § Title rule](./workspace-setup.md#title-rule).

| Status | Cause |
| ------ | ----- |
| 400 | Missing `messages` or `workspaceId` |
| 402 | Workspace LLM soft gate |
| 500 | LLM / upstream failure |

---

## Related surfaces

| Document | Topic |
| -------- | ----- |
| [chat-streaming.md](./chat-streaming.md) | `POST /api/chat` — live UIMessage stream (not session CRUD) |
| [workspace-setup.md](./workspace-setup.md) | Title rule, prompt rules vs `custom_prompt` |
| [async-intent-jobs.md](./async-intent-jobs.md) | SNS persistence via execute-by-intent |
| [console-bff-catalog.md](./console-bff-catalog.md) | Cookie vs Rust dual routes |
| [auth-header-matrix.md](./auth-header-matrix.md) | Cookie transport |

Custom frontend helper in this repo: `listChatSessions` / CRUD in
`src/lib/server/d6e-client.ts` (Cookie auth).
