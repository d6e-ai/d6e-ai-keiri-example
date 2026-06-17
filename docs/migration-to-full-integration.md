# Migration to full integration (B-case → C-case)

This document is the roadmap for turning the example app into a real
multi-user AI accounting product. Nothing here is implemented yet — it
is intended as a starting point for whoever picks up maintenance.

The current example ("B-case") integrates one workspace with d6e-auth
through a proper OAuth2 Authorization Code flow:

- Each user signs in with their own d6e-auth account. JWT pairs are
  stored in HTTP-only cookies; the SvelteKit hook auto-refreshes them.
- A workspace allow-list (`D6E_WORKSPACE_ID`) is enforced at
  `/auth/callback` via the d6e workspace membership probe.
- Manual bootstrap via `npm run init` is still required once per
  workspace to register the LLM prompt rule.
- LLM behaviour shaped only through a workspace prompt rule.
- Receipt files uploaded ad-hoc; deletable from the queue but never
  persisted in this app's own DB.

The full integration ("C-case") replaces the still-thin parts with a
proper production-grade equivalent. Phases below are ordered so you can
ship incrementally.

## Phase 1 — Multi-workspace authentication ✅ partially shipped

**Status:** per-user OAuth login is now part of the B-case (see
`src/routes/auth/*` and `src/hooks.server.ts`). What is still B-case-y:

- A single `D6E_WORKSPACE_ID` is hard-coded in `.env`; users outside
  that workspace are bounced to `/auth/no-access`.
- Refresh tokens are stored only in the user's `auth-refresh` cookie
  (HTTP-only, 30-day cap). There is no server-side persistence, so a
  user that clears their cookies must log in again. For a true C-case
  product, mirror the refresh tokens into a server-side store keyed
  by user id so the user keeps their session across devices.

Login uses the **instance-brokered** token exchange: `/auth/callback`
posts the authorization code to the d6e instance, which relays it to
d6e-auth with its own client credentials, so this frontend carries no
client secret. A standalone-client variant — the frontend registers its
own d6e-auth client and re-mints via refresh — remains available as a
fallback for deployments that cannot edit the instance's
`ALLOWED_REDIRECT_URIS`; see
[`../skills/d6e-auth-integration/SKILL.md`](../skills/d6e-auth-integration/SKILL.md).

## Phase 2 — Multi-workspace support

**Goal:** each user picks a workspace at login and the URL reflects it.

Concretely:

- Restructure routes under `src/routes/[workspaceId]/...`. The current
  `/`, `/tasks`, `/ask` become `/[workspaceId]/`, `/[workspaceId]/tasks`,
  `/[workspaceId]/ask`.
- Add a `/workspaces` index that calls
  `GET /api/v1/workspaces` (Bearer auth) on the d6e API and renders a
  picker.
- Inject `workspaceId` per-request rather than from `D6E_WORKSPACE_ID`.
- Allow each user to set their default workspace on a `/settings` page
  that writes to local storage.

## Phase 3 — Persistent tasks

**Goal:** the "pending" / "completed" task lists become real instead of
the current `src/lib/mock-data/tasks.ts` fixtures.

Two paths exist; pick one:

- **A. Use d6e SQL.** Create a `journal_tasks` table inside d6e and
  insert/update from this app via `d6e_execute_sql` MCP tool calls
  routed through `execute-by-intent`. Cheapest from an ops perspective
  because no separate DB is required.
- **B. Bring your own DB.** Add Drizzle + a Postgres connection and
  manage `journal_tasks` ourselves. More work but cleaner ownership.

For both paths, the AI Journal page becomes "save journal" instead of
"display once". Add a `Save to freee` button that:

1. Calls a new freee credential / OAuth flow (see Phase 5).
2. Posts each `JournalEntry` to freee's `/api/1/deals` or equivalent.
3. Records the freee deal id back into `journal_tasks`.

## Phase 4 — Dedicated STFs / workflows

**Goal:** stop relying purely on a prompt rule and ship the journal
behaviour as a d6e App package.

Concretely:

- Mirror the structure of
  [`d6e-ai/d6e-app-invoice-jp`](https://github.com/d6e-ai/d6e-app-invoice-jp)
  (`template.yaml` + `stfs/*` + `files/*`) inside this repository so the
  app can be installed via the d6e App Marketplace.
- The `template.yaml` should declare:
  - A `receipt-to-journal` workflow that orchestrates OCR → category
    inference → JSON emission.
  - Underlying STFs (in JS or Docker as appropriate) for any step that
    benefits from determinism (e.g. a fixed mapping table for common
    Japanese accounts).
- Replace the workspace prompt rule with a much smaller "this workspace
  has the AI 経理 app installed" hint; the rest of the behaviour lives
  in the STF definitions.

This phase is the biggest semantic upgrade because it moves the contract
from "prompt-engineering" to "code-versioned workflow".

## Phase 5 — freee + Google Drive integrations

**Goal:** automate the boring parts of the mock screens that this
example only renders statically.

- **Google Drive import.** Reuse the d6e SaaS credentials infrastructure
  (`/api/saas-auth/[provider]`) to authorise Drive once per user, then
  poll a designated folder for new receipts and call the
  `receipt-to-journal` workflow per file.
- **freee export.** Use the same SaaS credentials pattern, but for
  freee's OAuth, to push approved journals into the user's account.

## Phase 6 — Operational polish

Nice-to-haves once the above are in place:

- Audit log (`who approved which journal at what time`) backed by the
  same DB as Phase 3.
- Slack / LINE notifications when a new task lands in `pending_approval`
  — d6e already has SNS bot support, so this can piggy-back on the same
  `execute-by-intent` infrastructure.
- Configurable accounting code mapping via a YAML in the d6e App package
  rather than free-text prompt guidance.

## Anti-goals

- **Do not** turn the journal table into a spreadsheet editor. The
  decision in this example was explicitly that "revisions go through
  the LLM" so corrections stay auditable as natural-language history.
  Re-evaluate this only if customers ask for it.
- **Do not** persist access tokens or refresh tokens in localStorage on
  the client. The whole point of routing everything through
  `src/routes/api/*` is to keep tokens server-side.

## Order of operations

For a smooth migration, ship the phases in order:

1. Phase 1 (auth) — unlocks everything else.
2. Phase 2 (multi-workspace) — needed before any user-specific state.
3. Phase 3 (persistent tasks) — first real product value.
4. Phase 5 (freee export) — closes the loop for end-users.
5. Phase 4 (STFs) — once you understand which steps are deterministic
   enough to extract.
6. Phase 6 (polish) — anything left.
