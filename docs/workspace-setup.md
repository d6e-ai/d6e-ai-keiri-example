# Workspace setup

`npm run init` registers this app's AI accounting prompt as a workspace
prompt rule on a running d6e instance. Run it once per workspace before
you use the AI Journal page.

## Enabling end-user login (one-time allow-listing)

**Local development needs no allow-listing.** Loopback callback URLs
(`localhost`, `127.0.0.0/8`, or `[::1]` — any port, any path) are always
accepted by both validation layers, so `npm run dev` on any port logs in
out of the box.

Before anyone can log into a **deployed** copy of this app, its
(non-loopback) OAuth callback URL must be allow-listed. Login is
*instance-brokered*: `/auth/callback` exchanges the authorization code
at the instance's own `${D6E_BASE_URL}/api/v1/auth/token`, which relays
it to d6e-auth using the instance's client credentials. Two allow-lists
must therefore include every deployed environment's callback URL:

1. **d6e-auth `registered_client.redirectUris`** — add the callback URL
   (e.g. `https://<deploy>/auth/callback`) to the redirect URIs of the
   instance's own registered client on d6e-auth. This is self-service
   for anyone with the **franchise owner/admin** role on the franchise
   that registered the instance: open
   `${D6E_AUTH_URL}/{locale}/account/franchise` (e.g.
   `https://www.d6e.ai/ja-JP/account/franchise`), find the instance card
   under *d6e Instance Connection*, and add the URL under **Redirect
   URIs**. No d6e-auth platform admin is needed.
2. **The instance's `ALLOWED_REDIRECT_URIS`** — set this env var on the
   d6e instance to the same comma-separated list. The instance validates
   the `redirect_uri` of the code exchange against the ORIGIN-derived
   callback plus this list. Docker Compose already forwards it to the
   `api` service via `env_file: .env`, so adding it to the instance's
   `.env` is enough — no Compose edit required. This one is edited by
   whoever operates the instance deployment. (Loopback URIs skip this
   check on d6e api v0.20.1+; older instances still require explicit
   localhost entries here.)

Then set this app's `D6E_AUTH_CLIENT_ID` to the instance's own client id
(no client secret is needed). Frontends that cannot change the instance's
allow-list can use the standalone-client variant in
[`../skills/d6e-auth-integration/SKILL.md`](../skills/d6e-auth-integration/SKILL.md)
instead.

## What gets registered

The single source of truth is
[`scripts/prompts/ai-keiri-prompt.md`](../scripts/prompts/ai-keiri-prompt.md).
The script reads the file verbatim and POSTs the body to
`POST {D6E_BASE_URL}/api/workspace-prompt-rules`.

The prompt instructs the LLM to:

- Classify each turn into "create journal", "revise journal", or
  "general question".
- For create/revise: produce a ` ```json ` block matching the schema in
  [`src/lib/journal-schema.ts`](../src/lib/journal-schema.ts).
- For general questions: respond in plain Japanese markdown and never
  emit a `json` code block (so the frontend won't accidentally try to
  parse it as a journal).

If you want to tune the LLM behaviour, edit
`scripts/prompts/ai-keiri-prompt.md` and re-run `npm run init`. **Do not
edit the prompt directly in the d6e admin UI** — your change will be
overwritten the next time someone re-runs the script.

## Required environment variables

`npm run init` reads `.env` automatically via Node's `--env-file` flag.

| Variable                 | Where to find it                                                                                                                                  |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `D6E_BASE_URL`           | Base URL of the d6e instance (e.g. `https://your-d6e-instance.example.com`)                                                                       |
| `D6E_WORKSPACE_ID`       | UUID of the target workspace — copy button in the workspace settings page's Integration section (admin view), or read it off any workspace URL |
| `D6E_INIT_REFRESH_TOKEN` | Value of the `auth-refresh` cookie for a logged-in workspace-ADMIN session on `D6E_BASE_URL`                                                      |

`D6E_INIT_REFRESH_TOKEN` is intentionally separate from the regular
`auth-refresh` cookie this app issues to end users. The script can
only POST to `/api/workspace-prompt-rules` if the underlying account
has admin role on the target workspace, so this variable should hold
a token from an explicitly admin browser session — typically yours
during setup.

## Why a cookie value (not a Bearer token)?

`/api/workspace-prompt-rules` is part of the d6e SvelteKit frontend and
authenticates via the SvelteKit `cookies` store rather than the
`Authorization` header. This is asymmetric with `execute-by-intent`
(Bearer) — track the upstream behaviour at
[`packages/frontend/src/routes/api/workspace-prompt-rules/+server.ts`](https://gitlab.com/cauchye/d6e-ai/d6e/-/blob/main/packages/frontend/src/routes/api/workspace-prompt-rules/+server.ts).

The cookie content is the same access token used for Bearer requests,
just transported on a different header. The init script obtains the
access token by refreshing against
`${D6E_BASE_URL}/api/v1/auth/token` (no client credentials needed)
and stamps it into the `auth-token` cookie when calling this endpoint.

## How to obtain the refresh token

### `D6E_INIT_REFRESH_TOKEN`

1. Open the d6e frontend (`D6E_BASE_URL`) in your browser and log
   in with an account that has admin role on the target workspace.
2. Open dev tools -> Application (Chrome) / Storage (Firefox) -> Cookies.
3. Select the `D6E_BASE_URL` host.
4. Copy the value of the `auth-refresh` cookie. It is much longer-lived
   (30 days) than `auth-token`.
5. Paste it into `.env` as `D6E_INIT_REFRESH_TOKEN=<value>`.

The cookie is `HttpOnly`, so this manual copy is unavoidable for the
initial setup. The bootstrap script refreshes the access token by
posting `{ grant_type: "refresh_token", refresh_token: ... }` to
`${D6E_BASE_URL}/api/v1/auth/token` (no client credentials needed
against the d6e instance) and stamps the issued JWT into the
`auth-token` cookie when calling `/api/workspace-prompt-rules`.

## Running the script

```bash
npm run init
```

Successful output:

```
[init-workspace] refreshing access token via https://your-d6e-instance.example.com/api/v1/auth/token
[init-workspace] POST https://your-d6e-instance.example.com/api/workspace-prompt-rules (workspaceId=<uuid>)
[init-workspace] prompt size: 2853 characters
[init-workspace] OK - rule id=<uuid> sort_order=0
[init-workspace] Verify in the d6e frontend: Settings > Workspace > Prompt rules.
```

## Troubleshooting

### `rejected refresh (status=4xx)`

`D6E_INIT_REFRESH_TOKEN` is invalid. The most common cause is that the
d6e frontend silently rotated the cookie while you were logged in.
Re-login to the d6e frontend, copy the latest `auth-refresh` cookie
value, and update `.env`.

### `401 Unauthorized` from `/api/workspace-prompt-rules`

The refresh flow succeeded but the issued access token isn't accepted by
the d6e frontend. Confirm `D6E_BASE_URL` actually points at the same
d6e instance the refresh token came from.

### `403 Forbidden`

The account behind the refresh token is not an admin of the target
workspace. Promote them in the d6e admin UI, or use a different
account's refresh token.

### `400 content must not exceed 50,000 characters`

The prompt grew too large. Tighten the prose in
`scripts/prompts/ai-keiri-prompt.md`. (The current prompt is well under
the limit, so this should only happen if you've been adding heavy
custom guidance.)

### Multiple rules accumulating

The script is idempotent against re-runs with the **same** prompt
content: before POSTing it lists the workspace's existing rules and
hashes each one (SHA-256). If any of them already matches the prompt
about to be uploaded, the script logs "identical rule already
registered" and exits 0 without POSTing.

A new rule is therefore only created when one of these is true:

- The workspace has no rule with this exact content yet (first install).
- You edited `scripts/prompts/ai-keiri-prompt.md`, so the hash no
  longer matches the rule that was registered last time. In this case
  the old rule keeps living at its previous `sortOrder` slot and you
  probably want to delete it: either via the d6e admin UI, or with
  `DELETE /api/workspace-prompt-rules/{ruleId}` using the same
  cookie-based auth as POST.

The check is content-based, so a rule that someone hand-edited inside
the d6e admin UI will look different to the script and trigger a fresh
POST. Treat the admin UI and `npm run init` as mutually exclusive
editors for the same rule.

### LLM ignores the prompt

Open the d6e frontend's chat UI for the workspace and confirm the
prompt rule is listed under `Settings > Workspace > Prompt rules`.
If it's there but the model is still off-contract, see
[`llm-output-contract.md`](./llm-output-contract.md) for tuning
guidance.
