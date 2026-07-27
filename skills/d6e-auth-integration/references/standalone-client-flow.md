# Standalone client flow — when you cannot use instance-brokered exchange

**This example repo uses the instance-brokered flow by default.** The frontend
exchanges the authorization code at `${D6E_BASE_URL}/api/v1/auth/token` with
**no client secret**; the Rust proxy injects the instance's
`D6E_AUTH_CLIENT_ID` / `D6E_AUTH_CLIENT_SECRET` before relaying to d6e-auth.

Use the standalone-client variant only when you **cannot** register a redirect
URI on the d6e instance you target — e.g. a third-party app against a managed
instance you do not operate.

---

## When to use which flow

| Situation | Flow |
| --------- | ---- |
| You operate the instance or a workspace admin can add your callback in Integration settings | **Instance-brokered** (this repo's default) |
| Local dev on loopback (`localhost`, `127.x`, `[::1]`) | **Instance-brokered** — loopback needs no registration |
| Third-party app; no workspace admin access; you can register your own OAuth client on d6e-auth | **Standalone client** |
| You need unscoped tokens but only have workspace-scoped redirect registration | Register instance-wide URI in franchise portal, or use standalone client |

Trade-offs:

| | Instance-brokered | Standalone client |
| - | ----------------- | ----------------- |
| Client secret in frontend server | **No** | **Yes** (`D6E_AUTH_CLIENT_SECRET`) |
| Token exchange hops on login | 1 | 2 |
| Redirect URI registration | On d6e-auth (workspace or franchise) | On **your** `registered_client` |
| Resulting `aud` after login | Instance client id (immediate) | Instance client id (after re-mint) |

---

## Franchise portal client registration (outline)

1. Sign in to `${D6E_AUTH_URL}` with a franchise owner/admin account.
2. Open `{locale}/account/franchise` → *d6e Instance Connection*.
3. Register a new OAuth client (or use an existing one you own).
4. Add your app's callback under **Redirect URIs** on that client card
   (`registered_client.redirectUris` — instance-wide, **unscoped** tokens).
5. Copy `client_id` and `client_secret` into your server env as
   `D6E_AUTH_CLIENT_ID` and `D6E_AUTH_CLIENT_SECRET`.
6. Set `D6E_AUTH_REDIRECT_URI` to the exact callback URL you registered.

Without a franchise role, ask a d6e-auth platform operator to create the
client under `/admin/instances`.

Workspace-scoped registration (per-workspace `d6e_workspace_id` tokens) is
**not** available through the standalone client's own `redirectUris` list — use
the workspace Integration UI or
[redirect-uris API](../../d6e-workspace-api-client/references/redirect-uris.md)
on the instance instead.

---

## Two-step token exchange (pseudo-code)

After the user returns to `/auth/callback?code=…&state=…`:

```ts
// Step 1 — exchange at d6e-auth with YOUR client credentials
const authResponse = await fetch(`${D6E_AUTH_URL}/api/v1/auth/token`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    grant_type: 'authorization_code',
    code,
    client_id: D6E_AUTH_CLIENT_ID,       // your registered_client id
    client_secret: D6E_AUTH_CLIENT_SECRET,
    redirect_uri: D6E_AUTH_REDIRECT_URI
  })
});
const { access_token: authAccess, refresh_token } = await authResponse.json();

// authAccess has aud = your client id, iss = d6e-auth.
// ${D6E_BASE_URL} Bearer endpoints reject it — discard authAccess.

// Step 2 — re-mint at the d6e instance (no client secret sent)
const instanceResponse = await fetch(`${D6E_BASE_URL}/api/v1/auth/token`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    grant_type: 'refresh_token',
    refresh_token
  })
});
const { access_token, refresh_token: rotatedRefresh } = await instanceResponse.json();

// Store ONLY this pair in auth-access / auth-refresh cookies.
// instance injects its own client_id/secret when relaying refresh to d6e-auth,
// so access_token.aud === <instance client id>.
```

Everything after storage matches the instance-brokered skill: cookies,
`loadSession` refresh via `${D6E_BASE_URL}/api/v1/auth/token`, workspace
allow-list, logout through d6e-auth, `auth-access` → `auth-token` bridge for
Cookie BFF routes.

`D6E_AUTH_CLIENT_SECRET` must live in **server-side env only** (SvelteKit
`$env/dynamic/private`, Vercel encrypted env) — never in client bundles.

---

## Audience (`aud`) diagnosis

| Symptom | Likely `aud` in stored cookie | Fix |
| ------- | ------------------------------ | --- |
| Login OK, every Bearer call 401 | Your standalone client id (step-1 token stored by mistake) | Run step 2; store only instance-minted pair |
| Login OK, Cookie routes 401 | Same — or expired token | Confirm `jwtVerify` audience on instance matches instance client id |
| `jwtVerify` throws audience error | Token minted for different `registered_client` | Re-mint at instance; align `D6E_AUTH_CLIENT_ID` in custom FE env with **instance** client id for verify, not your standalone id |

Decode locally (debug only):

```ts
const payload = decodeJwtPayload(accessToken);
console.log({ aud: payload?.aud, iss: payload?.iss, d6e_workspace_id: payload?.d6e_workspace_id });
```

In production, trust d6e's verification — do not skip `aud` checks.

---

## Authorize URL difference

Standalone flow still sends users to `${D6E_AUTH_URL}/auth/login`, but
`client_id` must be **your** registered client id (not the instance's), and
`redirect_uri` must appear in **your** client's `redirectUris`.

If you also use workspace-scoped redirects, include `d6e_workspace_id` the same
way as `buildAuthorizeUrl()` — see [redirect-uris.md](./redirect-uris.md).

---

## Related

- [SKILL.md](../SKILL.md) — instance-brokered default flow
- [redirect-uris.md](./redirect-uris.md) — registration rules
- [jwt-claims-and-lifetimes.md](./jwt-claims-and-lifetimes.md) — `aud`, `iss`, `exp`
- [cookie-transport-bridge.md](./cookie-transport-bridge.md) — after login
