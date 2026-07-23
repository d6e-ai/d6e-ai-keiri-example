# Token kinds — JWT, workspace scope, and API keys

Custom frontends authenticate to `${D6E_BASE_URL}` with a Bearer credential.
Three shapes appear in practice; pick the one your login flow produces and
validate it consistently server-side.

## Comparison

| Kind | Prefix / claim | Typical source | Instance Bearer APIs | Cookie routes (`/api/chat-sessions`, `/api/workspace-prompt-rules`) |
| ---- | -------------- | -------------- | -------------------- | ------------------------------------------------------------------- |
| **Instance JWT** | `aud` = instance client id; no `d6e_workspace_id` | Loopback OAuth or instance-wide redirect URI | Yes | Yes (same JWT in `auth-token` cookie) |
| **Workspace-scoped JWT** | `d6e_workspace_id` claim = bound workspace | Per-workspace redirect URI + `d6e_workspace_id` on authorize URL | Yes, only for that workspace (`enforce_workspace_scope`) | Yes |
| **API key** | `d6e_…` prefix | d6e console → API Keys (user session required to create) | Yes (Bearer) | **No** — cookie routes reject non-session tokens |

All three travel as `Authorization: Bearer <value>` on Rust API and
`execute-by-intent` routes. Only the end-user OAuth pair is stored in
HTTP-only cookies in this repo (`auth-access` / `auth-refresh`).

## Instance JWT (default OAuth outcome)

After instance-brokered code exchange at
`POST ${D6E_BASE_URL}/api/v1/auth/token`, the access token is signed for the
**d6e instance audience** (matches the instance's own OAuth client id). It
works immediately against Bearer endpoints without a re-mint step.

**Local verification (d6e SvelteKit surfaces):** when the instance verifies
JWTs locally (e.g. chat-session cookie auth), `jwtVerify` must require:

```ts
audience: env.D6E_AUTH_CLIENT_ID  // must match token `aud` exactly
issuer: env.D6E_AUTH_JWT_ISSUER || env.D6E_AUTH_URL || 'd6e-auth'
```

If `D6E_AUTH_CLIENT_ID` is unset, audience validation cannot be skipped —
tokens issued for a different client of the same d6e-auth instance would
otherwise be accepted. API keys (`d6e_…`) bypass local JWT verify and
resolve via `GET /api/v1/auth/me` instead.

Symptom when `aud` is wrong: login succeeds but every Bearer call returns
401 — the stored token still has `iss=d6e-auth` audience from a direct
d6e-auth exchange. Fix: exchange at the instance (this skill's default flow).

## Workspace-scoped JWT (`d6e_workspace_id`)

When the callback URL is registered **per workspace** (Workspace Settings →
Integration → Redirect URIs), d6e-auth embeds a `d6e_workspace_id` claim
scoped to that workspace only.

**Authorize URL:** must include `d6e_workspace_id=<D6E_WORKSPACE_ID>` when the
same callback is registered in multiple workspaces (otherwise earliest
registration wins). `buildAuthorizeUrl()` in this repo adds it from env.

**Runtime enforcement:**

- `enforce_workspace_scope(requested_workspace_id)` — 403 if the token's
  scoped workspace does not match the workspace being accessed.
- `reject_scoped_token()` — 403 on endpoints that must not be callable with
  a workspace-scoped session.

### Scoped tokens cannot manage API keys

`POST/GET/DELETE /api/v1/api-keys` call `reject_scoped_token()` upstream.
Workspace-scoped OAuth tokens **cannot CRUD API keys** — only an unscoped
(instance-wide) session or API key can mint long-lived `d6e_…` keys.

Operational implication: if your app login uses a workspace-registered
redirect URI, end users get scoped JWTs. That is fine for normal workspace
API use; bootstrap scripts that create API keys must use a separate unscoped
admin path (`D6E_INIT_REFRESH_TOKEN`, operator session, or API key).

## API keys (`d6e_…`)

Long-lived keys created in the d6e console (format `d6e_{uuid}`) authenticate
as Bearer tokens on Rust API routes and `execute-by-intent`.

| Use | OK with API key? |
| --- | ---------------- |
| `scripts/init-workspace.mjs`, MCP, local dev | Yes |
| End-user browser session in a custom frontend | **No** — use OAuth cookies |
| `/api/chat-sessions`, `/api/workspace-prompt-rules` | **No** — require session cookie |

See also
[`d6e-workspace-api-client` auth-header matrix](../../d6e-workspace-api-client/references/auth-header-matrix.md#api-keys-local-dev--scripts).

## Quick decision tree

```
Browser login for one workspace app?
  → Instance-brokered OAuth → instance-audience JWT in cookies

Same callback URL registered in multiple workspaces?
  → Add d6e_workspace_id to authorize URL → scoped JWT

Operator script / MCP / CI without interactive login?
  → API key d6e_… (unscoped) — never put in browser cookies

Need to create API keys programmatically?
  → Must NOT use workspace-scoped JWT; use unscoped session or existing API key
```

## Related

- [platform-adapters.md](./platform-adapters.md) — cookie/session patterns per host
- [`d6e-auth-integration` SKILL.md](../SKILL.md) — OAuth flow, cookies, refresh
- [`d6e-workspace-api-client` auth-header matrix](../../d6e-workspace-api-client/references/auth-header-matrix.md)
