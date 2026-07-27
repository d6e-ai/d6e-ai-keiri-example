# LLM and embedding API keys — who needs what

Custom frontend developers **do not** put provider API keys (`GEMINI_API_KEY`,
`GOOGLE_API_KEY`, `OPENAI_API_KEY`, …) in their app for chat, execute-by-intent,
or workspace embeddings. The d6e **instance** routes cloud LLM and embedding
calls through the **Vercel AI Gateway** using an instance virtual gateway key
(`AI_GATEWAY_API_KEY` pinned in env, or fetched from d6e-auth via
`D6E_AUTH_URL` + `D6E_AUTH_CLIENT_SECRET`). Your proxy only forwards the user's
**Bearer JWT** (or a server-held `d6e_*` API key for automation).

Upstream references:

- Embedding bootstrap: [`packages/api/src/main.rs`](https://github.com/d6e-ai/d6e/blob/main/packages/api/src/main.rs) (`embedding_config`)
- Chat / intent gateway routing: [`packages/frontend/src/lib/server/ai-providers.ts`](https://github.com/d6e-ai/d6e/blob/main/packages/frontend/src/lib/server/ai-providers.ts)
- Execute-by-intent model resolution: [`execute-by-intent/+server.ts`](https://github.com/d6e-ai/d6e/blob/main/packages/frontend/src/routes/api/workflows/execute-by-intent/+server.ts)

---

## Decision table

| Role | Chat / execute-by-intent | Column / file / table embeddings | SaaS API calls (freee, Google, …) |
| ---- | ------------------------ | ---------------------------------- | --------------------------------- |
| **Custom FE developer** | Bearer JWT (or `d6e_*` key on server). **No** provider keys in `.env`. May pass `provider` + `model` in `/api/chat` body only — keys stay on instance. | Same Bearer auth. **No** `GEMINI_API_KEY` in custom FE `.env`. | Bearer JWT + workspace-stored credentials (connect via Cookie BFF proxy). |
| **Instance operator** | `AI_GATEWAY_API_KEY` **or** d6e-auth client credentials for virtual gateway key. Optional `TAVILY_API_KEY` (chat tools only). Optional `OPENAI_API_KEY` for `/api/transcribe` only. | `EMBEDDING_MODEL` + `D6E_AUTH_CLIENT_ID` + gateway key path (same as chat). Optional `EMBEDDING_DIMENSIONS`. | Provider OAuth app secrets on instance + user/workspace connect flow. |
| **End user (SaaS OAuth)** | Logs in via your OAuth; no keys. | No keys. | Connects provider in UI; tokens stored in `frontend.saas_credential`. |

Token shapes (instance JWT vs workspace-scoped vs `d6e_*`):
[d6e-auth-integration token-kinds.md](../../d6e-auth-integration/references/token-kinds.md).

---

## Custom frontend `.env` — what you need

| Variable | Required | Purpose |
| -------- | -------- | ------- |
| `D6E_BASE_URL` | Yes | Instance origin for all proxies |
| `D6E_WORKSPACE_ID` | Yes | Server-pinned workspace (never from browser) |
| `D6E_AUTH_CLIENT_ID` | Yes (local JWT verify) | Audience for `jwtVerify` on cookie routes |
| OAuth client id/secret / redirect | Yes | Login flow ([d6e-auth-integration](../../d6e-auth-integration/SKILL.md)) |

### DO NOT add to custom frontend `.env`

| Variable | Why |
| -------- | --- |
| `GEMINI_API_KEY` / `GOOGLE_API_KEY` | Embeddings and Gemini chat route via gateway on the instance |
| `OPENAI_API_KEY` | Chat/intent use gateway; only instance `/api/transcribe` reads this directly |
| `ANTHROPIC_API_KEY` | Cloud providers use gateway, not per-provider env on instance |
| `AI_GATEWAY_API_KEY` | Instance operator secret — not for custom FE repos |

If embeddings return `503 EMBEDDING_NOT_CONFIGURED`, the **operator** must fix
instance env — not your frontend `.env`.

---

## Instance operator — LLM gateway

Cloud providers (`openai`, `anthropic`, `google`, `xai`, `meta`) are always
routed through the Vercel AI Gateway. Configure **one** of:

1. `AI_GATEWAY_API_KEY` — pinned virtual key (dev / self-hosted), or
2. `D6E_AUTH_URL` (or `D6E_AUTH_BASE_URL`) + `D6E_AUTH_CLIENT_ID` +
   `D6E_AUTH_CLIENT_SECRET` — runtime fetch of virtual gateway key.

Local providers (`ollama`, `lmstudio`) bypass the gateway via `*_BASE_URL` env
on the instance only.

Chat entitlement: workspace subscription allow-list checked before spend.
Execute-by-intent uses workspace `snsProvider` / `snsModel` defaults (see
[async-intent-jobs.md](./async-intent-jobs.md)).

---

## Instance operator — embeddings

Embedding is enabled when **all** of the following hold
([`main.rs` embedding bootstrap](https://github.com/d6e-ai/d6e/blob/main/packages/api/src/main.rs)):

| Variable | Required | Notes |
| -------- | -------- | ----- |
| `EMBEDDING_MODEL` | Yes | e.g. `google/gemini-embedding-2-preview` (multimodal for files) |
| `D6E_AUTH_CLIENT_ID` | Yes | Instance id for gateway attribution tags |
| `AI_GATEWAY_API_KEY` **or** d6e-auth fetch | Yes | Same gateway path as chat |
| `EMBEDDING_DIMENSIONS` | No | Default `768` |

Rust API calls `POST {gateway}/v1/embeddings` — not Google Gemini REST with a
client-side Gemini key. See [`packages/api/src/embedding/`](https://github.com/d6e-ai/d6e/tree/main/packages/api/src/embedding).

### Embedding error codes (custom FE should surface)

| HTTP | Code | Meaning |
| ---- | ---- | ------- |
| 503 | `EMBEDDING_NOT_CONFIGURED` | Instance missing `EMBEDDING_MODEL` or gateway credentials |
| 502 | `EMBEDDING_API_ERROR` | Gateway/upstream embedding call failed (e.g. search query embed) |
| 503 | `MODEL_NOT_MULTIMODAL` | File embed/regenerate requires `gemini-embedding-2*` multimodal model |
| 400 | `EMPTY_FILE_IDS` | `file_ids` must be a non-empty array (max 50) |

Details and polling: [embeddings.md](./embeddings.md). RAG walkthroughs:
[rag-recipes.md](./rag-recipes.md).

---

## Chat and execute-by-intent — both Vercel AI SDK

Both LLM surfaces run on the **d6e instance** with the **Vercel AI SDK** (`ai`
package) and the instance AI Gateway key. Custom frontends never embed provider
SDKs or provider API keys for these calls.

| Surface | SDK entrypoint | HTTP shape |
| ------- | -------------- | ---------- |
| `POST /api/chat` | `streamText` | UIMessage stream ([chat-streaming.md](./chat-streaming.md)) |
| `POST /api/workflows/execute-by-intent` (+ async jobs) | `generateText` | JSON `IntentResponse` or job poll ([async-intent-jobs.md](./async-intent-jobs.md)) |

---

## Chat — `POST /api/chat`

- Auth: `Cookie: auth-token=<jwt>` (Bearer rejected).
- Client may send `provider` and `model` in the JSON body; the instance resolves
  the actual model via `getModelAsync()` and **instance gateway key** — no client
  provider secret.
- Optional `baseUrl` only for local Ollama/LM Studio on the instance.
- Full pipeline: [chat-streaming.md](./chat-streaming.md).

---

## Execute-by-intent — sync and async jobs

- Auth: `Authorization: Bearer <jwt>`.
- Request body has **no** `provider` or `model` fields. Model is resolved from
  `workspace_default_models.sns_provider` / `sns_model` (admin-managed), with
  entitlement and gateway fallback — same as SNS bots.
- Async job create body matches sync (message, `workspaceId`, optional file refs)
  — still no provider/model.
- Contrast with `/api/chat`: [async-intent-jobs.md](./async-intent-jobs.md).

---

## Changing models via API

**Applies only to chat and execute-by-intent (and SNS bots).** It does **not**
change the embedding model — that is instance env only (`EMBEDDING_MODEL` /
`EMBEDDING_DIMENSIONS`; see [Instance operator — embeddings](#instance-operator--embeddings)).

| Goal | How | Scope |
| ---- | --- | ----- |
| Pick model **per chat request** | Body `provider` + optional `model` on `POST /api/chat` (example in [chat-streaming.md](./chat-streaming.md#request-body)) | That HTTP request only |
| Change **execute-by-intent / SNS** default | Workspace admin Cookie BFF `PUT /api/workspaces/{id}/default-models` with `snsProvider` + `snsModel` together | **Whole workspace** |
| Change **chat UI seed** defaults | Same endpoint with `chatProvider` + `chatModel` together (browser IndexedDB may still override) | Workspace seed; not per-user server setting |
| Reset chat + SNS pairs | `DELETE /api/workspaces/{id}/default-models` → openai / gpt-5.6-luna | Whole workspace |
| Change **embedding** model | Instance operator sets `EMBEDDING_MODEL` (restart/redeploy). **No** workspace or chat API | **Whole instance** |

```http
PUT /api/workspaces/{workspaceId}/default-models
Cookie: auth-token=<admin jwt>
Content-Type: application/json

{
  "snsProvider": "anthropic",
  "snsModel": "claude-sonnet-4-6"
}
```

- **Admin only** (`verifyWorkspaceAdmin`). Members cannot GET/PUT this route.
- Providers must be in the instance allowlist (`openai`, `anthropic`, `google`,
  `xai`, `meta`, `ollama`, `lmstudio`). Model id is a non-empty string (max 200);
  catalog membership is not re-validated server-side on PUT.
- Hosted models are still filtered at call time by entitlement `allowedModels`.
- Indexed in [console-bff-catalog.md](./console-bff-catalog.md).

### GET response shape

`GET /api/workspaces/{workspaceId}/default-models` auto-creates a row on first
read. Response (camelCase):

```json
{
  "workspaceId": "018e…",
  "chatProvider": "openai",
  "chatModel": "gpt-5.6-luna",
  "snsProvider": "openai",
  "snsModel": "gpt-5.6-luna",
  "createdAt": "2026-01-01T00:00:00.000Z",
  "updatedAt": "2026-01-01T00:00:00.000Z"
}
```

`DELETE` resets both pairs to `openai` / `gpt-5.6-luna` and returns the same
shape.

There is **no** public Rust `/api/v1/...` equivalent for default-models — custom
frontends proxy the Cookie BFF (or instruct admins to set defaults in the d6e
console). Embeddings have **no** equivalent workspace API either.

---

## Exceptions — keys that are NOT the AI Gateway

| Feature | Env var | Scope | Custom FE |
| ------- | ------- | ----- | --------- |
| Voice transcribe | `OPENAI_API_KEY` on instance | `GET/POST /api/transcribe` (Whisper) | Proxy only; do not add key to FE |
| Tavily web tools | `TAVILY_API_KEY` on instance | Chat + execute-by-intent tool set | Not configurable from custom FE |
| SaaS OAuth apps | Provider client secrets | Instance OAuth apps | End users connect; see [saas-oauth-bff.md](./saas-oauth-bff.md) |

---

## Related

| Document | Topic |
| -------- | ----- |
| [embeddings.md](./embeddings.md) | Column / file / table embedding API |
| [rag-recipes.md](./rag-recipes.md) | End-to-end RAG without client Gemini keys |
| [chat-streaming.md](./chat-streaming.md) | UIMessage chat, MCP, gateway models |
| [async-intent-jobs.md](./async-intent-jobs.md) | NL automation, workspace default models |
| [token-kinds.md](../../d6e-auth-integration/references/token-kinds.md) | JWT vs scoped JWT vs `d6e_*` API key |
| [api-catalog.md](./api-catalog.md) | Full endpoint index |
