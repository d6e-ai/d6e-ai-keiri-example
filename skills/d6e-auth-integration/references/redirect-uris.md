# Redirect URIs — validation, registration, and workspace scope

d6e-auth is the **single authority** for OAuth redirect URI validation at both
authorize time (`/auth/login`) and token exchange (`POST /api/v1/auth/token`).
The d6e instance's `/api/v1/auth/token` proxy forwards `redirect_uri` unchanged
and injects its own `client_id` / `client_secret`; it does **not** maintain a
separate allow-list (the deprecated `ALLOWED_REDIRECT_URIS` env var on the
instance is no longer read).

Implementation:
[`d6e-auth/src/lib/server/redirect-uris.ts`](https://github.com/d6e-ai/d6e-auth/blob/main/src/lib/server/redirect-uris.ts),
[`d6e/packages/api/src/routes/v1/auth.rs`](https://github.com/d6e-ai/d6e/blob/main/packages/api/src/routes/v1/auth.rs).

This repo's authorize URL builder:
[`src/lib/server/oauth.ts`](../../../src/lib/server/oauth.ts) (`buildAuthorizeUrl`).

Workspace admin API (list / add / delete):
[`../d6e-workspace-api-client/references/redirect-uris.md`](../../d6e-workspace-api-client/references/redirect-uris.md).

---

## Validation rules

| Rule | Detail |
| ---- | ------ |
| **Exact match** | `redirect_uri` must match a registered entry **character-for-character** at authorize and token exchange. No trailing-slash normalization. |
| **Loopback auto-allow** | `isLoopbackRedirectUri()` accepts `localhost` (exact hostname — **not** `app.localhost`), any `127.0.0.0/8` IPv4 (e.g. `127.0.0.1`), and `[::1]` on **any port**, `http` or `https`. Loopback URIs need **no registration** and issue **unscoped** tokens (no `d6e_workspace_id`). |
| **Non-loopback** | Must appear in `registered_client.redirectUris` (instance-wide) or `workspace_redirect_uri` (per workspace). |
| **Workspace registration** | `validateWorkspaceRedirectUri()` requires **`https:`** scheme, **no URL fragment** (`#…`), max **2000** characters, absolute URL. |
| **Franchise / admin registration** | `normalizeRedirectUris()` allows `http` only for `localhost` / `127.0.0.1` hostnames; all other hosts must use `https`. |
| **Re-validation at token** | Token exchange re-checks the URI against the same allow-list and, for workspace-scoped codes, against the workspace stored on the authorization code row. |

Common false positives:

- `http://app.localhost:5173/auth/callback` — hostname is not exactly `localhost`.
- `http://192.168.x.x/auth/callback` — LAN IPs are not loopback.
- `https://myapp.com/callback#token` — fragments rejected for workspace registration.
- `https://myapp.com/callback/` vs `https://myapp.com/callback` — different strings.

---

## Where to register

| Surface | Table / field | Who can edit | Token scope |
| ------- | ------------- | ------------ | ----------- |
| **Franchise portal** | `registered_client.redirectUris` | Franchise owner/admin at `${D6E_AUTH_URL}/{locale}/account/franchise` → *d6e Instance Connection* → **Redirect URIs** | Unscoped (no `d6e_workspace_id`) |
| **Workspace Settings** | `workspace_redirect_uri` | Workspace admin at `{D6E_BASE_URL}/{locale}/workspaces/{id}/settings` → **Integration** → **Redirect URIs** | Workspace-scoped (`d6e_workspace_id` claim) |
| **d6e-auth admin** | `registered_client.redirectUris` | Platform admin at `/admin/instances` | Unscoped |

Workspace admins self-serve the per-workspace path. Instance-wide registration
requires franchise owner/admin (or platform admin). Loopback dev callbacks need
no registration anywhere.

---

## `d6e_workspace_id` when the same URI is registered in multiple workspaces

When the same callback URL exists in **more than one** workspace's
`workspace_redirect_uri` table, the authorize request must include:

```
d6e_workspace_id=<D6E_WORKSPACE_ID>
```

`buildAuthorizeUrl()` in this repo adds the parameter automatically from env.
`resolveRedirectUriScope()` behaviour:

- **With** `d6e_workspace_id`: URI must be registered for that exact workspace.
- **Without** `d6e_workspace_id`: earliest `createdAt` row wins (legacy).

The workspace id is stored on the authorization code and embedded in the issued
JWT when the match came from `workspace_redirect_uri`.

---

## Preview and production deploys

Each deployed origin needs its **own** registered callback URL:

| Environment | Example `D6E_AUTH_REDIRECT_URI` | Registration |
| ----------- | ------------------------------- | ------------ |
| Local dev | `http://localhost:5173/auth/callback` | None (loopback) |
| Vercel preview | `https://my-app-git-feature-foo.vercel.app/auth/callback` | Workspace Integration or franchise portal |
| Production | `https://my-app.example.com/auth/callback` | Same |

Register preview URLs before testing OAuth on preview deploys. A missing
registration fails at authorize (400 "Invalid client configuration") or token
exchange (`invalid_grant` / `redirect_uri not registered`).

---

## Failure symptoms

| Symptom | Likely cause |
| ------- | ------------ |
| Login form 400 "Invalid client configuration" | Non-loopback `redirect_uri` not registered (authorize step) |
| Token exchange `invalid_grant` / `redirect_uri mismatch` | Exchange `redirect_uri` differs from authorize, or code expired (5 min, single-use) |
| Token exchange `redirect_uri not registered` | URI removed after authorize, or workspace hint mismatch |
| Scoped token on wrong workspace | Same URI in multiple workspaces without `d6e_workspace_id` on authorize URL |

See [SKILL.md Troubleshooting](../SKILL.md#troubleshooting) and
[token-kinds.md](./token-kinds.md) for scoped vs unscoped token behaviour.

---

## Related

- [jwt-claims-and-lifetimes.md](./jwt-claims-and-lifetimes.md) — `d6e_workspace_id` claim
- [standalone-client-flow.md](./standalone-client-flow.md) — registering your own `registered_client`
- [`d6e-workspace-api-client` redirect URIs API](../../d6e-workspace-api-client/references/redirect-uris.md)
