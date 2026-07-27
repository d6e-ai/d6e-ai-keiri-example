# JWT claims and lifetimes

Access and refresh tokens issued by d6e-auth share a common claim layout. This
repo stores the access token in the `auth-access` cookie and forwards it as
Bearer or `auth-token` depending on the upstream route.

Signing implementation:
[`d6e-auth/src/lib/server/jwt.ts`](https://github.com/d6e-ai/d6e-auth/blob/main/src/lib/server/jwt.ts).
Token exchange:
[`d6e-auth/src/routes/api/v1/auth/token/+server.ts`](https://github.com/d6e-ai/d6e-auth/blob/main/src/routes/api/v1/auth/token/+server.ts).

Local decode (no signature check) in this repo:
[`src/lib/server/oauth.ts`](../../../src/lib/server/oauth.ts)
(`decodeJwtPayload`, `decodeJwtExpMs`).

Full verification on the d6e instance:
[`d6e/packages/frontend/src/lib/server/auth.ts`](https://github.com/d6e-ai/d6e/blob/main/packages/frontend/src/lib/server/auth.ts)
(`verifyAccessToken` → `jwtVerify`).

---

## Access token claims

| Claim | Required | Meaning |
| ----- | -------- | ------- |
| `sub` | Yes | User UUID (`user.id`) — becomes `SessionUser.id` / `locals.user.id` |
| `email` | Yes | User email — used for pending-invitation auto-promote (`provision_jwt_user`) |
| `name` | Yes | Display name — sidebar greeting via `auth-user` cookie |
| `aud` | Yes* | OAuth client id the token was minted for — must equal `D6E_AUTH_CLIENT_ID` on the instance |
| `iss` | Yes | Always `d6e-auth` (or `D6E_AUTH_JWT_ISSUER` / `D6E_AUTH_URL` when verifying) |
| `exp` | Yes | Expiry — **1 hour** from issue (`setExpirationTime("1h")`) |
| `iat` | Yes | Issued-at timestamp |
| `d6e_workspace_id` | No | Present when the callback was registered per-workspace; scopes API access to that workspace |

\* Access tokens minted without an `audience` argument (rare internal paths) omit
`aud`. End-user OAuth through a `registered_client` always sets `aud` to the
client id.

Refresh tokens carry `sub`, `iss`, `exp`, `type: "refresh"`, and optionally
`d6e_workspace_id`. They do **not** repeat `email` / `name` — those are
re-loaded from the database on refresh.

---

## Lifetimes

| Artifact | Lifetime | Notes |
| -------- | -------- | ----- |
| **Authorization code** | **5 minutes**, single-use | `expiresAt: now + 5 * 60 * 1000` on insert; reload on `/auth/callback` re-sends a consumed code |
| **Access token (JWT)** | **~1 hour** | `expires_in: 3600` in token response; `auth-access` cookie max-age derived from `exp` |
| **Refresh token (JWT)** | **30 days** | `setExpirationTime("30d")`; `auth-refresh` cookie capped at 30 days in `session.ts` |
| **d6e-auth session cookie** | **30 days** | Set on login at `${D6E_AUTH_URL}` — separate from your app's cookies; cleared by `/auth/logout` redirect |
| **OAuth state cookie** | **10 minutes** | `auth-oauth-state` between `/auth/login` form POST and `/auth/callback` |

Proactive refresh: `loadSession()` refreshes when `exp` is within **60 seconds**
(`REFRESH_GRACE_MS`). Refresh always targets
`${D6E_BASE_URL}/api/v1/auth/token` so the new access token keeps
instance audience.

---

## What this repo trusts locally

| Operation | Signature verified? | Claims used |
| --------- | ------------------- | ----------- |
| `decodeJwtExpMs` / `decodeJwtPayload` | **No** | `exp`, `sub`, `email`, `name` — scheduling refresh and sidebar display only |
| `decodeUserFromAccessToken` | **No** | `sub`, `email`, `name` at `/auth/callback` |
| `loadSession` refresh decision | **No** | `exp` only |
| d6e Rust API Bearer auth | **Yes** (JWKS) | Full payload + membership provisioning |
| d6e SvelteKit `verifyAccessToken` | **Yes** (`jwtVerify`) | `sub`, `email`, `name`; requires `aud === D6E_AUTH_CLIENT_ID`, `iss` match |

**Rule:** never authorize API calls based on local decode alone. The HTTP-only
cookie prevents client-side forgery, but server-side proxies still rely on d6e
to reject bad signatures. Local `exp` parsing only decides **when** to refresh.

`jwtVerify` on the instance (Cookie BFF routes):

```ts
await jwtVerify(token, getJwks(), {
  issuer: env.D6E_AUTH_JWT_ISSUER || env.D6E_AUTH_URL || 'd6e-auth',
  audience: env.D6E_AUTH_CLIENT_ID,  // must be set — cannot skip
  algorithms: ['RS256']
});
```

API keys (`d6e_…`) skip `jwtVerify` and resolve via `GET /api/v1/auth/me`.

---

## Workspace scope claim

When `d6e_workspace_id` is present:

- Rust API enforces `enforce_workspace_scope` — 403 if the requested workspace
  does not match the claim.
- `reject_scoped_token()` blocks `/api/v1/api-keys` CRUD.
- Cookie BFF routes still accept the JWT; workspace is usually pinned from env
  in the custom frontend proxy.

See [token-kinds.md](./token-kinds.md) and [redirect-uris.md](./redirect-uris.md).

---

## Related

- [cookie-transport-bridge.md](./cookie-transport-bridge.md) — `auth-access` vs `auth-token`
- [token-kinds.md](./token-kinds.md) — instance vs scoped JWT vs API key
- [operator-tokens.md](./operator-tokens.md) — `D6E_INIT_REFRESH_TOKEN` lifetimes
