# Billing entitlement and LLM soft gate

d6e instances cache workspace subscription state locally and **refuse LLM spend**
when credits are exhausted, the subscription is `past_due` / `canceled`, or
overage caps are hit. Custom frontends cannot read or push entitlement directly —
handle the gate in UI when chat or execute-by-intent returns **HTTP 402**.

---

## Where the gate runs

| Route | Auth | Gate check |
| ----- | ---- | ---------- |
| `POST /api/chat` | Cookie | `isLlmAllowedForWorkspace(workspaceId)` before stream starts |
| `POST /api/workflows/execute-by-intent` | Bearer | Same, before agent run |
| `POST /api/workflows/execute-by-intent/jobs` | Bearer | Same in async runner (`intent-executor.ts`) |
| `POST /api/chat-sessions/generate-title` | Cookie | Same |
| `POST /api/verify` | Cookie | Same (background LLM) |

Non-LLM Rust routes (`/api/v1/sql`, files, documents, workflows execute, …)
are **not** soft-gated — data view/edit continues when AI is disabled.

Implementation:
[`packages/frontend/src/lib/server/entitlement-client.ts`](https://github.com/d6e-ai/d6e/blob/main/packages/frontend/src/lib/server/entitlement-client.ts)

---

## HTTP 402 response shapes

### Chat (`POST /api/chat`)

Structured JSON (stable contract for chat clients):

```json
{
  "error": "llm_soft_gated",
  "reason": "credits_exhausted",
  "status": "credits_exhausted",
  "remainingCredits": 0,
  "overageEnabled": false,
  "message": "AI features are temporarily disabled for this workspace."
}
```

HTTP status: **402** (`SOFT_GATE_HTTP_STATUS`).

A separate **403** with `error: "model_not_allowed"` occurs when the chosen
hosted model is not on the workspace subscription — not the same as soft gate.

### Execute-by-intent (sync and async create)

Returns an `IntentResponse` envelope with HTTP **402**:

```json
{
  "success": false,
  "message": "AI features are temporarily disabled for this workspace."
}
```

Async job poll: if the runner hits the gate, the job may end in `failed` with a
similar message in `error` — treat terminal `failed` + 402-class message like chat.

See [chat-streaming.md](./chat-streaming.md) and
[async-intent-jobs.md](./async-intent-jobs.md).

---

## Custom frontend cannot call billing/entitlement APIs

Entitlement data flows **d6e-auth → instance**, not browser → d6e-auth.

| Endpoint | Who may call | Custom FE |
| -------- | ------------ | --------- |
| `POST /api/billing/entitlement` | d6e-auth service JWT (`sub: service:d6e-auth`, `purpose: entitlement`) | **No** — push-only |
| `GET /api/v1/workspaces/{id}/entitlement` (d6e-auth) | Instance Basic auth (`D6E_AUTH_CLIENT_ID` + secret) | **No** |
| Billing UI (`/billing`, Stripe portal) | d6e console Cookie session | Optional — not a public REST API for integrators |

The instance stores a cache row in `frontend.workspace_entitlement`. LLM routes
read the cache synchronously; they do not expose a Bearer endpoint for custom
frontends to query subscription state.

**UI guidance:**

1. On 402 from proxied `/api/chat` or execute-by-intent, show billing CTA
   (link to d6e console `/billing` or your own upgrade copy).
2. Do not try to pre-flight entitlement from the browser — you have no supported
   credential.
3. Optional: surface a static banner when your product knows the workspace is
   trial-only; still handle 402 as the authoritative gate.

---

## Gate reasons (typical)

Derived from cached `llmEnabled`, `status`, credits, and overage flags:

| `reason` / `status` (examples) | Meaning |
| ------------------------------ | ------- |
| `credits_exhausted` | Monthly credits used; overage off |
| `past_due` | Payment failed |
| `canceled` | Subscription ended |
| `pending` | Checkout not completed |

Exact strings come from `entitlement-client.ts` — treat `message` as user-facing
copy; branch on `error === 'llm_soft_gated'` for chat.

**Cold start / outage:** when no cache row exists and d6e-auth is unreachable,
the gate is **permissive** (`allowed = true`) so customers are not locked out of
all AI during outages. Do not assume 402 on every unpaid workspace without a
failed request.

---

## Related

- [chat-streaming.md](./chat-streaming.md) — chat 402 handling
- [async-intent-jobs.md](./async-intent-jobs.md) — Bearer agent 402
- [mcp-rest-map.md](./mcp-rest-map.md) — chat vs execute-by-intent paths
- [api-catalog.md](./api-catalog.md) — master index
