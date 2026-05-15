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

See `.env.example`. The runtime never reads a short-lived access token
directly — it stores a long-lived refresh token (`D6E_REFRESH_TOKEN`)
plus the OAuth client credentials (`D6E_AUTH_CLIENT_ID`,
`D6E_AUTH_CLIENT_SECRET`, `D6E_AUTH_URL`) and exchanges them for an
access token via `src/lib/server/d6e-token.ts` whenever a request needs
one. The same module is reused by `scripts/init-workspace.mjs`, which
stamps the freshly-issued access token into the `Cookie: auth-token=...`
header required by `/api/workspace-prompt-rules`.

The Bearer headers used by `/api/workflows/execute-by-intent` and
`/api/v1/workspaces/{id}/files` carry the same access token; only the
header name differs.

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
