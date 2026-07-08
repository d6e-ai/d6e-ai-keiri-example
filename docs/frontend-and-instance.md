# Custom Frontends and the d6e Instance — How They Relate

日本語版: [frontend-and-instance.ja.md](./frontend-and-instance.ja.md)

This document explains the **relationship** between a custom frontend,
the d6e instance it talks to, and the central d6e account site. It is
the conceptual companion to the three implementation skills in this
repository ([`skills/`](../skills/README.md)) and to
[`architecture.md`](./architecture.md), which documents the reference
implementation in detail.

Read this first if you are unsure *what a custom frontend actually is*
relative to d6e — especially if you arrived here from the Plugin
development guides and everything so far has been about workspaces,
STFs, and `template.yaml`.

## The three parties

```
┌────────────────────────────────┐
│ Your custom frontend           │   You own this: a normal web app
│ (SvelteKit / Next.js / …)      │   (e.g. on Vercel) — NOT part of
│ e.g. https://keiri.example.com │   the d6e codebase or deployment
└───────────┬────────────────────┘
            │ 1. login redirect        ┌────────────────────────────────┐
            ├─────────────────────────▶│ Central d6e account site       │
            │                          │ https://www.d6e.ai             │
            │                          │  accounts, login UI, client &  │
            │                          │  redirect-URI registry         │
            │                          └───────────────▲────────────────┘
            │ 2. code exchange +                       │ token relay
            │    every API call                        │
            └─────────────────────────▶┌───────────────┴────────────────┐
                                       │ d6e instance                   │
                                       │ ${D6E_BASE_URL}                │
                                       │ e.g. https://cauchye.d6e.ai    │
                                       │ ┌────────────┐ ┌─────────────┐ │
                                       │ │ Console UI │ │ Rust API    │ │
                                       │ │ (SvelteKit)│ │ /api/v1/*   │ │
                                       │ └────────────┘ └─────────────┘ │
                                       │ workspaces: SQL / files / STFs │
                                       │ / workflows / SaaS credentials │
                                       └────────────────────────────────┘
```

1. **Your custom frontend** — an independent web app that you build,
   host, and deploy anywhere (Vercel, your own server, …). It is *not*
   installed into d6e, does not run inside the instance, and shares no
   code with it. Its only connection to d6e is HTTPS calls to the
   instance's public APIs.
2. **The d6e instance** (`${D6E_BASE_URL}`) — a self-hosted deployment
   (API + console + PostgreSQL behind one origin) that owns the
   workspaces: their tables, files, STFs, workflows, SaaS credentials,
   and chat sessions. Everything your frontend does with d6e data goes
   through this instance's HTTP APIs.
3. **The central d6e account site** ([https://www.d6e.ai](https://www.d6e.ai)) —
   where user accounts live and where users type their password. It also
   holds the registry of instances (OAuth clients) and their allowed
   redirect URIs. Your frontend never exchanges secrets with it; it only
   redirects the user's browser there for login.

## The relationship in one sentence

> A custom frontend is a separately deployed web app that signs users in
> through the central d6e account site and then drives **one workspace
> on one d6e instance** through the instance's public HTTP APIs — the
> same APIs the built-in console uses.

Two consequences of this that shape everything else:

- **There is no privileged integration.** The instance does not know
  your frontend exists until a request arrives with a valid user token.
  Anything the console can do, your frontend can do; anything your
  frontend cannot do via the APIs, the console cannot do either.
- **The instance stays the security boundary.** Policies, workspace
  membership, SaaS credentials, and audit logging are all enforced
  server-side per user token. Your frontend never holds a client
  secret, database connection, or SaaS token.

## What runs where

| Concern | Runs on | Notes |
|---|---|---|
| Your UI, routing, session cookies | **Your frontend** (your hosting) | The only piece you deploy |
| Login screen, user accounts | **www.d6e.ai** | Browser redirect only |
| Token exchange & refresh | **Instance** `/api/v1/auth/token` | The instance brokers the code to the central site with its own credentials |
| Workspace data (SQL, files, Drive mirror) | **Instance** `/api/v1/*` (Rust API) | Bearer token + `X-Workspace-ID` |
| Workflows, STFs, SaaS proxy | **Instance** `/api/v1/*` (Rust API) | Same policy checks as the console/chat agent |
| Natural-language execution (`execute-by-intent`), chat sessions | **Instance** `/api/*` (SvelteKit side) | The instance serves two API surfaces behind one origin |
| LLM calls | **Instance** | Uses the workspace's configured model; your frontend sends messages, not model API keys |

Note the last column of the middle rows: one `D6E_BASE_URL` origin
serves both the Rust API (`/api/v1/*`) and the d6e SvelteKit routes
(`/api/*`), because a reverse proxy in front of the instance routes by
path. Your frontend treats them as one host. Exact request/response
shapes: [`d6e-api-integration.md`](./d6e-api-integration.md).

## Authentication: one login, d6e-auth redirect URI registration

The full flow (with sequence diagram and code) is in the
[`d6e-auth-integration` skill](../skills/d6e-auth-integration/SKILL.md);
the shape of the relationship is:

1. Your frontend redirects the browser to
   `https://www.d6e.ai/auth/login` with a `redirect_uri` pointing back
   at your app.
2. After login, your server receives the authorization code and posts
   it to the **instance's** `/api/v1/auth/token`. The instance relays
   the code to the central site using the *instance's own* client
   credentials and hands you back tokens already signed for the
   instance's audience.
3. From then on, every API call carries that user-scoped Bearer token.
   Authorization is the user's **workspace membership** — there is no
   separate "frontend account".

Because the instance brokers the exchange, your frontend holds **no
client secret**. Your deployed callback URL must be registered on
**d6e-auth** (loopback/`localhost` URLs are exempt — any port, any
path, no registration, d6e ≥ v0.20.1):

- **Instance-wide** (unscoped tokens): franchise portal
  (`https://www.d6e.ai/{locale}/account/franchise` → instance card →
  **Redirect URIs**). Checked when the login page issues the code and
  when the instance relays the code.
- **Per-workspace** (workspace-scoped tokens): d6e console → Workspace
  Settings → Integration → **Redirect URIs**. Use this when the frontend
  sets `D6E_WORKSPACE_ID` and passes `d6e_workspace_id` on the authorize
  URL (see the auth skill). Required when the same callback URL is
  registered in more than one workspace.

The instance no longer reads `ALLOWED_REDIRECT_URIS`; d6e-auth is the
single validation authority for redirect URIs.

## Where Plugins fit (and where they don't)

Plugins and custom frontends extend d6e on **opposite sides of the same
API line**:

| | **Plugin** | **Custom frontend** |
|---|---|---|
| What it is | A `template.yaml` package of *workspace contents*: prompt, tables/policies, STFs, workflows, effects, files | A separate web app *using* a workspace |
| Where it lives | Installed **into** the instance (per workspace) | Deployed **outside** the instance |
| Executed by | The instance (QuickJS/Docker runtimes, workflow engine, chat agent) | Your hosting provider |
| UI | None of its own — used through the d6e console/chat | Is the UI |
| Distribution | Install-from-URL / marketplace | Normal web deployment |

They compose naturally: the workspace behaviour your frontend depends
on (tables, prompt rules, workflows, STFs) can be packaged as a Plugin
so that new workspaces can be provisioned reproducibly, and the same
repository can carry both the `template.yaml` and the frontend code.
This reference app does exactly that — see
[`workspace-setup.md`](./workspace-setup.md) for the workspace half.

For Plugin development itself (STF runtimes, instant-run, workflow
definitions, marketplace publishing), see the
[d6e-plugin-skills](https://gitlab.com/cauchye/d6e-ai/d6e-plugin-skills)
repository and its
[local AI agent development guide](https://gitlab.com/cauchye/d6e-ai/d6e-plugin-skills/-/blob/main/docs/local-ai-development.md).

## Console, Plugin, or custom frontend?

- **Console only** — the built-in d6e console (chat, data pages,
  workflow runs) is already a complete UI. If your users are comfortable
  there, you need no frontend at all.
- **Plugin only** — packages behaviour (prompts, STFs, workflows) so any
  workspace can install it, still used through the console. Right when
  the console UX is good enough but the *behaviour* must be
  reproducible.
- **Plugin + custom frontend** — when specific users need a dedicated,
  task-shaped UI (e.g. "upload receipts → get journal entries" instead
  of a general chat), with its own domain, branding, and simplified
  flows. The frontend consumes what the Plugin provisions.

## Lifecycle summary

1. **Develop locally** — `npm run dev` on any `localhost` port; OAuth
   loopback needs no registration. Point `D6E_BASE_URL` at a live
   instance and iterate against real workspace data.
2. **Provision the workspace** — by hand in the console, or by
   installing your Plugin (`template.yaml`).
3. **Deploy the frontend** — any static/SSR hosting works (this
   reference uses Vercel).
4. **Register the deployed redirect URI** — on d6e-auth (franchise
   portal for instance-wide, or per-workspace Redirect URIs in the
   console when using `D6E_WORKSPACE_ID`).
5. **Operate** — tokens, policies, and membership are enforced by the
   instance per user; your frontend remains a stateless proxy plus UI.

## Related reading

- [`skills/README.md`](../skills/README.md) — the three implementation
  skills (auth, API client, prompt-driven UI)
- [`architecture.md`](./architecture.md) — the reference app end to end
- [`d6e-api-integration.md`](./d6e-api-integration.md) — exact API shapes
- [`workspace-setup.md`](./workspace-setup.md) — provisioning the
  workspace this app depends on
- [d6e-plugin-skills — local AI agent development guide](https://gitlab.com/cauchye/d6e-ai/d6e-plugin-skills/-/blob/main/docs/local-ai-development.md)
  — the server-side counterpart to this document
