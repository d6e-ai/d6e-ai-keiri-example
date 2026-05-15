# Workspace setup

`npm run init` registers this app's AI accounting prompt as a workspace
prompt rule on a running d6e instance. Run it once per workspace before
you use the AI Journal page.

## What gets registered

The single source of truth is
[`scripts/prompts/ai-keiri-prompt.md`](../scripts/prompts/ai-keiri-prompt.md).
The script reads the file verbatim and POSTs the body to
`POST {D6E_FRONTEND_URL}/api/workspace-prompt-rules`.

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

| Variable                  | Where to find it                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------- |
| `D6E_FRONTEND_URL`        | Base URL of the d6e frontend (e.g. `https://b-button.d6e.ai`)                         |
| `D6E_WORKSPACE_ID`        | UUID of the target workspace (visible in the d6e frontend URL when you're inside one) |
| `D6E_AUTH_URL`            | Base URL of d6e-auth (`https://www.d6e.ai` for managed instances)                     |
| `D6E_AUTH_CLIENT_ID`      | OAuth client ID issued by d6e-auth for your d6e instance                              |
| `D6E_AUTH_CLIENT_SECRET`  | OAuth client secret paired with the client ID                                         |
| `D6E_REFRESH_TOKEN`       | Value of the `auth-refresh` cookie for a logged-in d6e admin session                  |

## Why a cookie value (not a Bearer token)?

`/api/workspace-prompt-rules` is part of the d6e SvelteKit frontend and
authenticates via the SvelteKit `cookies` store rather than the
`Authorization` header. This is asymmetric with `execute-by-intent`
(Bearer) — track the upstream behaviour at
[`packages/frontend/src/routes/api/workspace-prompt-rules/+server.ts`](https://github.com/d6e-ai/d6e/blob/main/packages/frontend/src/routes/api/workspace-prompt-rules/+server.ts).

The cookie content is the same access token used for Bearer requests,
just transported on a different header. The init script obtains the
access token via the d6e-auth refresh flow (no manual JWT pasting
required) and stamps it into the `auth-token` cookie when calling this
endpoint.

## How to obtain the refresh token and OAuth credentials

### `D6E_REFRESH_TOKEN`

1. Open the d6e frontend (`D6E_FRONTEND_URL`) in your browser and log
   in with an account that has admin role on the target workspace.
2. Open dev tools -> Application (Chrome) / Storage (Firefox) -> Cookies.
3. Select the `D6E_FRONTEND_URL` host.
4. Copy the value of the `auth-refresh` cookie. It is much longer-lived
   (30 days) than `auth-token`.
5. Paste it into `.env` as `D6E_REFRESH_TOKEN=<value>`.

The cookie is `HttpOnly`, so this manual copy is unavoidable for the
initial setup. After that the app refreshes access tokens automatically
via the d6e-auth `/api/v1/auth/token` endpoint.

### `D6E_AUTH_CLIENT_ID` and `D6E_AUTH_CLIENT_SECRET`

These are issued by d6e-auth when your d6e instance is registered. Ask
your d6e administrator or find them in the d6e-auth admin dashboard.
They are application credentials, not user credentials, so they remain
stable until the d6e instance is re-registered.

## Running the script

```bash
npm run init
```

Successful output:

```
[init-workspace] refreshing access token via https://www.d6e.ai/api/v1/auth/token
[init-workspace] POST https://b-button.d6e.ai/api/workspace-prompt-rules (workspaceId=<uuid>)
[init-workspace] prompt size: 2853 characters
[init-workspace] OK - rule id=<uuid> sort_order=0
[init-workspace] Verify in the d6e frontend: Settings > Workspace > Prompt rules.
```

## Troubleshooting

### `d6e-auth rejected refresh (status=400)`

`D6E_REFRESH_TOKEN` is invalid. The most common cause is that the d6e
frontend silently rotated the cookie while you were logged in. Re-login
to the d6e frontend, copy the latest `auth-refresh` cookie value, and
update `.env`.

### `d6e-auth rejected refresh (status=401)`

`D6E_AUTH_CLIENT_ID` or `D6E_AUTH_CLIENT_SECRET` is wrong, or the
client was revoked. Check the d6e-auth admin dashboard.

### `401 Unauthorized` from `/api/workspace-prompt-rules`

The refresh flow succeeded but the issued access token isn't accepted by
the d6e frontend. Confirm `D6E_FRONTEND_URL` actually points at the
same d6e instance the OAuth client was registered for.

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

POST appends a new rule each time you run the script. If you see
duplicate rules in the d6e admin UI, delete the older ones there;
this script does not have a "replace" mode.

### LLM ignores the prompt

Open the d6e frontend's chat UI for the workspace and confirm the
prompt rule is listed under `Settings > Workspace > Prompt rules`.
If it's there but the model is still off-contract, see
[`llm-output-contract.md`](./llm-output-contract.md) for tuning
guidance.
