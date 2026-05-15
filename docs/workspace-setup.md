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

| Variable           | Where to find it                                                                       |
| ------------------ | -------------------------------------------------------------------------------------- |
| `D6E_FRONTEND_URL` | Base URL of the d6e frontend (e.g. `https://b-button.d6e.ai` or `http://localhost:5173`) |
| `D6E_WORKSPACE_ID` | UUID of the target workspace (visible in the d6e frontend URL when you're inside one)  |
| `D6E_AUTH_COOKIE`  | Value of the `auth-token` cookie for a logged-in d6e admin session                     |

## Why a cookie value (not a Bearer token)?

`/api/workspace-prompt-rules` is part of the d6e SvelteKit frontend and
authenticates via the SvelteKit `cookies` store rather than the
`Authorization` header. This is asymmetric with `execute-by-intent`
(Bearer) — track the upstream behaviour at
[`packages/frontend/src/lib/server/workspace-prompt-rules.ts`](https://github.com/d6e-ai/d6e/blob/main/packages/frontend/src/lib/server/workspace-prompt-rules.ts).

The literal cookie content is still the same JWT, just transported on a
different header.

### How to obtain the cookie value

1. Open the d6e frontend in your browser and log in with an account
   that has admin role on the target workspace.
2. Open dev tools -> Application (Chrome) / Storage (Firefox) -> Cookies.
3. Select the `D6E_FRONTEND_URL` host.
4. Copy the value of the `auth-token` cookie. It looks like
   `eyJhbGciOi...`.
5. Paste it into `.env` as `D6E_AUTH_COOKIE=<value>`.

The cookie is `HttpOnly`, so this manual copy is unavoidable in the
B-case integration. The C-case (full integration) plan in
[`migration-to-full-integration.md`](./migration-to-full-integration.md)
replaces this with proper d6e-auth OAuth.

## Running the script

```bash
npm run init
```

Successful output:

```
[init-workspace] POST http://localhost:5173/api/workspace-prompt-rules (workspaceId=<uuid>)
[init-workspace] prompt size: 2853 characters
[init-workspace] OK - rule id=<uuid> sort_order=0
[init-workspace] Verify in the d6e frontend: Settings > Workspace > Prompt rules.
```

## Troubleshooting

### `401 Unauthorized`

Either `D6E_AUTH_COOKIE` is empty, expired, or you copied the wrong
cookie. Re-login and re-copy. The d6e frontend refreshes the cookie
silently, so an old value will simply stop working after some time.

### `403 Forbidden`

The account behind the cookie is not an admin of the target workspace.
Promote them in the d6e admin UI, or use a different cookie.

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
