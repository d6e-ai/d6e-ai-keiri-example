# Workspace redirect URIs

OAuth callback URLs registered **per workspace** on d6e-auth. Tokens issued
after authorize include a `d6e_workspace_id` claim when the callback is
workspace-scoped.

Product rules (when to register instance-wide vs per-workspace, franchise
portal, `d6e_workspace_id` on authorize):
[d6e-auth-integration SKILL § Redirect URI registration](../../d6e-auth-integration/SKILL.md#redirect-uri-registration)
and [redirect-uris.md](../../d6e-auth-integration/references/redirect-uris.md)
(when present).

Implementation (Rust proxy):
[`workspace_redirect_uris.rs`](https://github.com/d6e-ai/d6e/blob/main/packages/api/src/routes/v1/workspace_redirect_uris.rs)

---

## Rust Bearer API

Base path: `/api/v1/workspaces/{workspaceId}/redirect-uris`

Workspace resolved from **path** `{workspaceId}`. All endpoints require
**workspace admin** (`403` for non-admin members).

```
Authorization: Bearer <jwt>
Content-Type: application/json
```

| Method | Path | Body | Response |
| ------ | ---- | ---- | -------- |
| `GET` | `…/redirect-uris` | — | `{ "items": RedirectUriItem[] }` |
| `POST` | `…/redirect-uris` | `{ "redirect_uri": "https://…" }` | `RedirectUriItem` |
| `DELETE` | `…/redirect-uris` | `{ "redirect_uri": "https://…" }` | `204 No Content` |

### List response

```json
{
  "items": [
    {
      "id": "01abc…",
      "d6e_workspace_id": "018e…",
      "redirect_uri": "https://app.example.com/auth/callback",
      "added_by_email": "admin@example.com",
      "created_at": "2026-01-10T12:00:00Z"
    }
  ]
}
```

### Create response

`POST` returns the created item (same fields as list element). Upstream
validation errors map to `400` with `{ "error", "message" }`.

### HTTPS rules (POST)

| Rule | Error |
| ---- | ----- |
| Non-empty after trim | `redirect_uri is required` |
| Max 2000 characters | Length error |
| Valid URL | Parse error |
| Scheme must be `https` | Scheme error (no `http://` except loopback is **not** special-cased here) |
| No URL fragment (`#…`) | Fragment error |

`DELETE` requires non-empty `redirect_uri` in body; `404` when not found.

Instance must have `D6E_AUTH_URL`, `D6E_AUTH_CLIENT_ID`, and
`D6E_AUTH_CLIENT_SECRET` configured — otherwise `500` / `502` from the proxy.

---

## Cookie BFF (console)

Thin proxy to Rust using the session cookie's Bearer token:

| Method | Path | Notes |
| ------ | ---- | ----- |
| `GET` | `/api/workspaces/{workspaceId}/redirect-uris` | Admin via `verifyWorkspaceAdmin` |
| `POST` | `…/redirect-uris` | Body `{ "redirect_uri": "https://…" }` |
| `DELETE` | `…/redirect-uris` | Body `{ "redirect_uri": "https://…" }` → `204` |

```
Cookie: auth-token=<jwt>
```

Implementation:
[`packages/frontend/src/routes/api/workspaces/[workspaceId]/redirect-uris/+server.ts`](https://github.com/d6e-ai/d6e/blob/main/packages/frontend/src/routes/api/workspaces/%5BworkspaceId%5D/redirect-uris/+server.ts)

Custom frontends typically use **Rust Bearer** from a server proxy
(`event.locals.accessToken`). Use Cookie BFF only when driving the d6e instance
admin UI through a same-origin proxy.

---

## Auth summary

| Surface | Auth | Admin required |
| ------- | ---- | -------------- |
| Rust `GET/POST/DELETE …/redirect-uris` | Bearer (path ws) | Yes — all three |
| Cookie BFF `…/redirect-uris` | `auth-token` cookie | Yes — all three |

| Status | Meaning |
| ------ | ------- |
| 401 | Missing / invalid session (Cookie) or Bearer |
| 403 | Authenticated but not workspace admin |
| 400 | Invalid `redirect_uri` (validation) |
| 404 | DELETE target not found |
| 502 | d6e-auth upstream failure |

---

## Related

- [workspaces.md](./workspaces.md) — workspace CRUD (separate from redirect URIs)
- [console-bff-catalog.md](./console-bff-catalog.md) — dual-route table
- [api-catalog.md](./api-catalog.md) — master index
- [d6e-auth-integration](../../d6e-auth-integration/SKILL.md) — OAuth flow and registration scopes
