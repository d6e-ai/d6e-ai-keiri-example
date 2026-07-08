# CLAUDE.md — d6e-ai-keiri-example

Example AI accounting frontend built on d6e's `/api/workflows/execute-by-intent` endpoint.
This is a thin reference implementation, **not** a production accounting product.

## Commands

```bash
npm install            # Install dependencies
npm run dev            # Start the dev server (Vite)
npm run build          # Production build (Vercel adapter)
npm run check          # svelte-kit sync + svelte-check
npm run format         # Prettier
npm run format:check   # Prettier dry-run
npm run init           # Register the workspace prompt rule on d6e
```

After editing `messages/*.json`, Paraglide auto-recompiles via the Vite
plugin. If generated files are stale, run manually:

```bash
npx @inlang/paraglide-js compile --project ./project.inlang --outdir ./src/lib/paraglide
```

## Tech stack

- SvelteKit 2.x + Svelte 5 (Runes) + TypeScript strict
- Tailwind CSS v4 (utility tokens defined in `src/routes/layout.css`)
- Paraglide for i18n (`ja-JP`, `en-US`; base locale `ja-JP`)
- `@lucide/svelte` for icons (`XxxIcon` import naming)
- Zod 4 for JSON contract validation
- `@sveltejs/adapter-vercel`

## Project structure

```
src/
├── routes/
│   ├── +layout.svelte           # Sidebar + main column
│   ├── +page.svelte             # AI Journal page (root)
│   ├── tasks/+page.svelte       # Completed tasks (mock list)
│   ├── ask/+page.svelte         # General accounting Q&A
│   └── api/
│       ├── upload/+server.ts    # Proxy to d6e Storage API
│       └── intent/+server.ts    # Proxy to execute-by-intent
└── lib/
    ├── components/              # App-level Svelte components
    ├── server/                  # Server-only modules (d6e client + env)
    ├── journal-schema.ts        # Zod schema for the LLM JSON contract
    ├── parse-journal.ts         # Code-block extraction + fallback
    ├── mock-data/               # Pending / completed task fixtures
    ├── paraglide/               # Auto-generated i18n (do not edit)
    └── utils.ts                 # cn() and formatJpyAmount()
scripts/
├── init-workspace.mjs           # Register prompt rule on d6e
└── prompts/
    └── ai-keiri-prompt.md       # **Single source of truth** for LLM behaviour
docs/
├── architecture.md
├── d6e-api-integration.md
├── workspace-setup.md
├── llm-output-contract.md
└── migration-to-full-integration.md
```

## Environment variables

See `.env.example`. The app implements the OAuth2 Authorization Code
flow with an **instance-brokered token exchange**:

1. The user logs in at d6e-auth (`D6E_AUTH_URL`, e.g.
   `https://www.d6e.ai`) and is bounced back with a `code`.
2. `/auth/callback` exchanges that `code` at the **d6e instance**
   (`${D6E_BASE_URL}/api/v1/auth/token`), which relays it to d6e-auth
   using the instance's own client credentials and returns a pair
   already signed for the instance's audience. This frontend therefore
   holds **no client secret**, and the returned pair is written to
   cookies directly.

Because the exchange happens at the instance, the access token always
carries the audience the d6e instance API requires; every later refresh
hits the same instance endpoint. d6e-auth validates redirect URIs at
authorize and token exchange against `registered_client.redirectUris`
(instance-wide, franchise portal) and per-workspace registrations
(Workspace Settings → Integration → **Redirect URIs**). A
standalone-client variant (own d6e-auth client + two-stage re-mint) is
documented in `skills/d6e-auth-integration/SKILL.md` for frontends that
cannot register a redirect URI on the instance they use.

Required env vars:

- `D6E_BASE_URL`, `D6E_WORKSPACE_ID` — the d6e instance and workspace
  this app targets.
- `D6E_AUTH_URL`, `D6E_AUTH_CLIENT_ID`, `D6E_AUTH_REDIRECT_URI` —
  d6e-auth login URL plus the d6e instance's own OAuth `client_id`
  (no client secret). A deployed (non-loopback) `D6E_AUTH_REDIRECT_URI`
  must be registered on d6e-auth — instance-wide in
  `registered_client.redirectUris` (franchise portal) or per-workspace
  in Workspace Settings → Integration → **Redirect URIs** — before
  logins work. Loopback callbacks need no registration.
- `D6E_INIT_REFRESH_TOKEN` — admin-only refresh token used **only** by
  `scripts/init-workspace.mjs` to POST the workspace prompt rule.
  Separate from the end-user `auth-refresh` cookie.

Per-request token flow:

1. `src/hooks.server.ts` reads the `auth-access` cookie and exposes
   it as `event.locals.accessToken`.
2. `src/lib/server/session.ts` checks the JWT `exp` and transparently
   refreshes via `${D6E_BASE_URL}/api/v1/auth/token` (the d6e
   instance, never d6e-auth) when within 60s of expiry, so the
   rotated cookie always carries a d6e-instance-issued access token.
3. All d6e API helpers in `src/lib/server/d6e-client.ts` accept the
   access token as an explicit argument; route handlers pass
   `event.locals.accessToken` (via `requireAccessToken()` for type
   narrowing).

The Bearer headers used by `/api/workflows/execute-by-intent` and
`/api/v1/workspaces/{id}/files/multipart` and the `Cookie: auth-token=...`
value used by `/api/workspace-prompt-rules` and `/api/chat-sessions`
all carry the same JWT; only the header name differs.

## LLM output contract

The model is expected to emit a fenced ` ```json` block with this shape
on journal creation/revision turns:

```json
{
  "kind": "journal",
  "entries": [
    {
      "date": "2026-04-30",
      "debit_account": "消耗品費",
      "credit_account": "現金",
      "amount": 1280,
      "tax_amount": 116,
      "description": "コンビニ事務用品"
    }
  ],
  "warnings": []
}
```

Parsing always falls back to a raw-text view if the model deviates from
the contract; the AI Journal page must never go blank. See
`docs/llm-output-contract.md` for the full rationale.

## Coding conventions

- **Naming**: lowerCamelCase for TS, files in kebab-case under `src/lib/components/`.
- **Formatting**: Prettier — tabs, single quotes, no trailing commas, `printWidth: 100`.
- **Imports**: Auto-sorted by `prettier-plugin-sort-imports` (svelte → third-party → `$lib` → `$env` → relative).
- **Svelte 5 only**: use runes (`$state`, `$props`, `$derived`, `$effect`); no `export let`.
- **No comment before `<script>` in `.svelte` files** — Svelte renders it as text. Put the file-header comment **inside** `<script lang="ts">`.
- **No `class:` directive on shadcn-style components**. Use `cn()` from `$lib/utils`.
- **UI text in English** by default, with Japanese variants when copy is user-facing accounting terminology. All strings flow through Paraglide.
- **Error messages**: include the function name and salient parameters; prefix server-side logs with `[<module>]`.
- **Commit messages**: English only. No AI attribution.

## Development workflow

For non-trivial changes write a plan under `.plans/` first. Use Plan mode
in Cursor/Claude to discuss tradeoffs before editing. Once a PR is
opened, keep the description in sync with what actually changed.

## Agent Skills (`skills/`)

This repo also publishes three reusable Agent Skills for AI agents
building their own d6e-connected frontends:

- [`skills/d6e-auth-integration/SKILL.md`](./skills/d6e-auth-integration/SKILL.md) — instance-brokered OAuth2 (+ standalone-client alternative) + session cookies + hooks.
- [`skills/d6e-workspace-api-client/SKILL.md`](./skills/d6e-workspace-api-client/SKILL.md) — Bearer/cookie header matrix, `caller + accessToken` wrapper convention, idempotent prompt-rule bootstrap.
- [`skills/d6e-prompt-driven-ui/SKILL.md`](./skills/d6e-prompt-driven-ui/SKILL.md) — `kind`-discriminated JSON contracts, Zod parse with markdown fallback, XML-tag revision flow, scenario-append activation.

Conventions when editing them:

- Each `SKILL.md` has a YAML frontmatter (`name` + `description`) in
  English. The `description` must include trigger phrases so the
  [skills CLI](https://skills.sh) search and Cursor's `@skills` picker
  can surface the skill from natural-language requests.
- Skill bodies are English-first with Japanese trigger examples in
  the `When to Use` list.
- Skills cite the implementation by relative path
  (e.g. `[\`src/lib/server/d6e-client.ts\`](../../src/lib/server/d6e-client.ts)`).
  When you change a referenced module, update the citing skill in
  the same PR.
- Skills are installed straight from this repository's GitLab URL:
  `npx skills add https://gitlab.com/d6e-ai/d6e-ai-keiri-example --skill <name>`.
  The repository moved to GitLab, so the GitHub `owner/repo`
  shorthand no longer works — always document the full URL.
