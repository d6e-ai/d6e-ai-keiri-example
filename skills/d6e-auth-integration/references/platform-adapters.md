# Platform adapters — SvelteKit, Next.js, Cloudflare Workers

This repo implements auth with **SvelteKit** (`hooks.server.ts`, route
handlers under `src/routes/auth/*`, `src/lib/server/session.ts`). Other
frameworks follow the same **contract**; only the wiring differs.

Shared contract regardless of platform:

1. Redirect to `${D6E_AUTH_URL}/auth/login` with `state`, `client_id`,
   `redirect_uri`, and (when using per-workspace redirects)
   `d6e_workspace_id`.
2. Exchange code at `${D6E_BASE_URL}/api/v1/auth/token` (instance-brokered —
   no client secret in the browser app).
3. Store access + refresh tokens in **HTTP-only** cookies (`SameSite=Lax`,
   `Secure` outside dev).
4. On each protected request: load session, refresh within 60s of `exp`
   with in-flight deduplication, set `locals.accessToken` for `/api/*`
   proxies.
5. Logout: clear local cookies **and** redirect through
   `${D6E_AUTH_URL}/auth/logout?redirect_uri=…`.

See [token-kinds.md](./token-kinds.md) for JWT vs scoped JWT vs `d6e_` API key.

## SvelteKit (reference implementation)

| Concern | This repo |
| ------- | --------- |
| Session load + gate | [`src/hooks.server.ts`](../../../src/hooks.server.ts) — `loadSession()`, redirect unless `/auth/*` or `/api/*` |
| OAuth helpers | [`src/lib/server/oauth.ts`](../../../src/lib/server/oauth.ts) |
| Cookie store | [`src/lib/server/session.ts`](../../../src/lib/server/session.ts) — deduplicated refresh |
| Login / callback / logout | [`src/routes/auth/`](../../../src/routes/auth/) |
| Bearer for d6e proxies | `event.locals.accessToken` from hook |

**Public path policy:** `/auth/*` and `/api/*` skip the login redirect so
XHR receives JSON 401 instead of a 302 chain to d6e-auth (CORS-safe).

**Cookie names:** `auth-access`, `auth-refresh`, `auth-user`, `auth-oauth-state`.

Copy this layout when adding auth to another SvelteKit custom frontend.

## Next.js (App Router notes)

No reference route files ship in this repo; map SvelteKit pieces as follows:

| SvelteKit | Next.js equivalent |
| --------- | ------------------ |
| `hooks.server.ts` `handle` | `middleware.ts` for path gating + `cookies()` read; or layout server component that redirects |
| `+server.ts` route handlers | `app/auth/login/route.ts`, `app/auth/callback/route.ts`, `app/auth/logout/route.ts` |
| `event.locals.accessToken` | `cookies()` in Server Components / Route Handlers; pass token into server-only d6e-client wrappers |
| `requireAccessToken()` | Same pattern in each `/app/api/**/route.ts` |

**Cookies:** use `cookies().set(name, value, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/' })`.
Next.js middleware can read cookies but cannot set refresh responses on the
same request as a Server Action in all cases — prefer Route Handlers for
callback and logout Set-Cookie.

**OAuth callback:** implement as a Route Handler (not a client page) so the
code exchange and Set-Cookie happen server-side before redirect.

**Refresh deduplication:** port the module-level `Map<refreshToken, Promise>`
from `session.ts` — parallel RSC requests during the grace window will otherwise
rotate the refresh token twice and log users out.

**JWT verify for cookie-only SvelteKit surfaces on d6e:** if you proxy
`/api/chat-sessions` through your app, local `jwtVerify` still requires
`aud === D6E_AUTH_CLIENT_ID` (see [token-kinds.md](./token-kinds.md)).

## Cloudflare Workers (edge notes)

Workers excel at short request/response work. Auth **can** run on Workers,
but long LLM runs must not.

### Cookies on Workers

- Set cookies on the OAuth callback response with `HttpOnly; SameSite=Lax;
  Secure; Path=/`.
- Workers `cookies()` APIs (framework-dependent) must mirror the four-cookie
  layout; refresh rotation must write **both** access and refresh cookies on
  every successful refresh.
- Cross-subdomain apps: `Domain` attribute is required if auth and app differ;
  test third-party cookie blocking in Safari.

### OAuth callback on the edge

The callback handler should:

1. Validate `state` (constant-time compare against short-lived cookie).
2. `POST` code to `${D6E_BASE_URL}/api/v1/auth/token` (subrequest from Worker).
3. Set cookies on the redirect response to `/`.

Keep the handler CPU-light — no LLM, no file buffering. Token exchange only.

### Do not hold long LLM work in a Worker

Sync `execute-by-intent` can exceed **~30s CPU** on Cloudflare Workers.
Pattern:

1. Auth Worker sets session cookies and proxies **thin** `/api/*` routes.
2. Intent routes call d6e **async jobs** (`POST …/execute-by-intent/jobs`),
   return `{ jobId }` immediately.
3. Browser polls via same-origin GET every 3–5s; render `toolTrace` client-side.

Platform limits and streaming guidance:
[`d6e-workspace-api-client` platform-timeouts.md](../../d6e-workspace-api-client/references/platform-timeouts.md)
— especially the Cloudflare **~30s CPU** row and the decision matrix for
agent runs > 5 minutes.

File downloads through a Worker must **stream** `upstream.body`; never buffer
multi-MB Excel/PDF bodies in the isolate (128 MB default memory).

### When Workers are too tight

Move download proxies and sync intent to Vercel (Node) or a small sidecar;
keep Workers for auth + job submit/poll only. See platform-timeouts trade-off
section.

## Checklist (any platform)

- [ ] Token exchange targets the **instance**, not d6e-auth directly (unless using standalone-client re-mint).
- [ ] Refresh always POSTs to `${D6E_BASE_URL}/api/v1/auth/token`.
- [ ] Logout clears local cookies **and** hits d6e-auth logout URL.
- [ ] `/api/*` proxies read Bearer from server session, never from browser JS.
- [ ] Long agent runs use async jobs — not a blocking Worker or short `maxDuration` function.
- [ ] Large downloads stream through same-origin proxy — see [download-two-step.md](../../d6e-workspace-api-client/references/download-two-step.md).

## Related

- [token-kinds.md](./token-kinds.md)
- [`d6e-workspace-api-client` platform-timeouts.md](../../d6e-workspace-api-client/references/platform-timeouts.md)
- [`d6e-workspace-api-client` async-intent-jobs.md](../../d6e-workspace-api-client/references/async-intent-jobs.md)
- [`d6e-auth-integration` SKILL.md](../SKILL.md)
