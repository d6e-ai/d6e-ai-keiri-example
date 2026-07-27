# Operator tokens — `D6E_INIT_REFRESH_TOKEN` vs end-user cookies

Bootstrap and automation scripts need a long-lived credential that is **not**
the browser session of whoever last clicked "Sign in". This repo separates
operator refresh tokens from end-user OAuth cookies.

Script:
[`scripts/init-workspace.mjs`](../../../scripts/init-workspace.mjs).

End-user session:
[`src/lib/server/session.ts`](../../../src/lib/server/session.ts).

---

## Two refresh tokens, two purposes

| Credential | Storage | Lifetime | Used by |
| ---------- | ------- | -------- | ------- |
| **`auth-refresh` cookie** | HTTP-only cookie per browser session | 30 days, rotated on every refresh | `hooks.server.ts` → every user page view and `/api/*` proxy |
| **`D6E_INIT_REFRESH_TOKEN` env var** | `.env` / Vercel encrypted env | Until rotated on d6e-auth (JWT `exp` 30d per refresh cycle) | `npm run init` / `scripts/init-workspace.mjs` only |

**Never mix them.** The end-user cookie belongs to whoever last logged in through
the UI. The init token is an operator credential with workspace-admin rights for
bootstrap tasks.

---

## How to obtain `D6E_INIT_REFRESH_TOKEN`

1. Sign in to `${D6E_BASE_URL}` as a user with **workspace admin** role on
   `D6E_WORKSPACE_ID`.
2. Open browser dev tools → Application → Cookies → your d6e instance origin.
3. Copy the value of the **`auth-refresh`** cookie from that admin session.

For this repo's custom frontend (different origin), instead:

1. Sign in through **your app's** `/auth/login` as a workspace admin, **or**
2. Complete OAuth on the d6e console directly and copy **`auth-refresh`** from
   `${D6E_BASE_URL}` if your init script only talks to the instance.

Paste into `.env`:

```dotenv
D6E_INIT_REFRESH_TOKEN=<paste refresh token JWT>
```

Treat it like a database password — do not commit, do not log, do not expose in
client-side code.

---

## What init scripts call

`init-workspace.mjs` flow:

1. **`POST ${D6E_BASE_URL}/api/v1/auth/token`**
   ```json
   { "grant_type": "refresh_token", "refresh_token": "<D6E_INIT_REFRESH_TOKEN>" }
   ```
   No `client_id` / `client_secret` — the instance proxy injects them (same as
   end-user `loadSession` refresh).

2. **`GET ${D6E_BASE_URL}/api/workspace-prompt-rules?workspaceId=…`**
   with `Cookie: auth-token=<access_token from step 1>` — **not** Bearer.

3. SHA-256 compare existing rules; **`POST /api/workspace-prompt-rules`** only
   when no identical prompt content exists (idempotent bootstrap).

Required env vars: `D6E_BASE_URL`, `D6E_WORKSPACE_ID`, `D6E_INIT_REFRESH_TOKEN`.

---

## Rotation and failure modes

| Event | What happens |
| ----- | ------------ |
| Admin logs out of d6e console | d6e-auth may invalidate related refresh tokens — re-copy `auth-refresh` |
| Another session refreshes the same refresh token | Rotation invalidates the old value — init fails with 400; re-copy from admin browser |
| Developer runs app locally while init script runs | End-user `auth-refresh` in browser is unrelated — unless you mistakenly copied the wrong cookie into `D6E_INIT_REFRESH_TOKEN` |
| Token expires (30d JWT `exp`) | Refresh fails — obtain a new admin session and update env |

Error hint from the script when refresh fails:

```
Likely cause: D6E_INIT_REFRESH_TOKEN was rotated in another session —
re-copy the auth-refresh cookie value from your admin browser dev tools.
```

---

## What operator tokens must not do

| Do not | Why |
| ------ | --- |
| Set `D6E_INIT_REFRESH_TOKEN` in Vercel **production** user-facing env if only CI needs init | Reduces blast radius — use CI secrets |
| Wire `D6E_INIT_REFRESH_TOKEN` into `hooks.server.ts` | Would impersonate the operator for all users |
| Store init token in `auth-refresh` cookie via `storeSession` | Collides with end-user sessions |
| Use init token in browser `fetch` | Secret leakage |

For MCP, local dev scripts, and CI jobs that are not interactive login, a
`d6e_*` **API key** is often simpler — see
[token-kinds.md](./token-kinds.md). API keys cannot call Cookie BFF routes or
CRUD other API keys.

---

## Related

- [jwt-claims-and-lifetimes.md](./jwt-claims-and-lifetimes.md) — refresh token 30d JWT `exp`
- [cookie-transport-bridge.md](./cookie-transport-bridge.md) — `auth-token` on prompt-rules POST
- [token-kinds.md](./token-kinds.md) — API key alternative for automation
- [`d6e-workspace-api-client` SKILL.md](../../d6e-workspace-api-client/SKILL.md) — init idempotency
