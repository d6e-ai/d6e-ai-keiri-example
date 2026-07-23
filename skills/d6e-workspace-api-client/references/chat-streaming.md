# Chat streaming — `POST /api/chat`

Interactive LLM chat with MCP tool execution, SQL human-in-the-loop (HITL)
approval, `ask_user` prompts, memory injection, and context compaction.
Returns a **UIMessage stream** (Vercel AI SDK protocol), not plain SSE text.

This is the d6e console's primary agent surface. Custom frontends that need
full MCP tool access (beyond what REST exposes) must proxy this route or use
[async-intent-jobs.md](./async-intent-jobs.md) — see
[mcp-rest-map.md](./mcp-rest-map.md).

Implementation:
[`packages/frontend/src/routes/api/chat/+server.ts`](https://gitlab.com/cauchye/d6e-ai/d6e/-/blob/main/packages/frontend/src/routes/api/chat/+server.ts)

**execute-by-intent is NOT a substitute** for interactive chat: it runs a
single NL task with a fixed tool set and returns a final JSON result. It does
not support multi-turn UIMessage history, SQL approval UI, `ask_user` cards,
or streaming tool traces in the same way. Use execute-by-intent for batch
automation; use `/api/chat` for conversational agents.

---

## Auth

```
Cookie: auth-token=<jwt>
Content-Type: application/json
```

- Requires `locals.user` (session).
- Reads JWT from `auth-token` cookie — **Bearer is rejected**.
- Uses session JWT as MCP Bearer when connecting to `D6E_MCP_SERVER_URL`.
- Custom frontend: proxy same-origin with user's session cookie forwarded to
  `${D6E_BASE_URL}/api/chat`.

---

## Request body

```json
{
  "messages": [ /* UIMessage[] from @ai-sdk/svelte Chat or compatible client */ ],
  "provider": "anthropic",
  "model": "claude-sonnet-4-6",
  "baseUrl": null,
  "workspaceId": "<uuid>",
  "chatSessionId": "<uuid>",
  "attachments": [
    { "fileId": "<storage-file-uuid>", "filename": "receipt.pdf", "contentType": "application/pdf" }
  ]
}
```

| Field | Required | Notes |
| ----- | -------- | ----- |
| `messages` | Yes | Non-empty UIMessage array |
| `provider` | Yes | LLM provider id (`openai`, `anthropic`, `google`, …) |
| `model` | No | Defaults via `getDefaultModel(provider)` |
| `baseUrl` | No | Custom endpoint for Ollama/LM Studio |
| `workspaceId` | **Yes** | Entitlement gate + MCP scope; 400 if missing |
| `chatSessionId` | No | Used for compaction logging |
| `attachments` | No | Storage file refs injected into model messages |

---

## Response

`createUIMessageStreamResponse` — streaming HTTP body in UIMessage protocol
(chunks for text, tool calls, tool results, data parts).

Notable custom data part:

| Type | Purpose |
| ---- | ------- |
| `data-binaryFile` | Base64 binary emitted when MCP tools return files; includes `toolCallId` for UI correlation; persisted in session for re-download |

Client persists completed messages via `PATCH /api/chat-sessions/{id}` after
stream finishes.

---

## High-level handler pipeline

1. **Auth + workspace gate** — membership via `getWorkspace`; 403 if not member.
2. **Entitlement soft gate** — `isLlmAllowedForWorkspace`; 402 `llm_soft_gated` if billing blocks LLM.
3. **Model allow-list** — hosted gateway models checked against workspace subscription.
4. **Context assembly**
   - Workspace prompt rules (`loadCombinedPromptRules`)
   - Installed plugin template prompts
   - Agent skills system prompt (`generateSkillsSystemPrompt`)
   - User memories when enabled (`loadUserMemories` → `buildMemoryPromptSection`)
5. **MCP tools loaded** — d6e MCP server + per-workspace DB MCP servers.
6. **UIMessage sanitize chain** — repairs broken tool inputs, neutralizes unknown tools, fills empty outputs, drops empty text parts.
7. **Compaction** — `applyCompaction` prunes/truncates/summarizes when context overflows (env-driven thresholds via `getCompactionConfig`).
8. **Tool assembly** — builtin + Tavily + wrapped MCP tools.
9. **streamText** — AI SDK with `stopWhen: stepCountIs(AGENT_RECURSION_LIMIT)`.
10. **UIMessage stream** — manual chunk forwarding (not `writer.merge`) so binary file emission works during tool execution.
11. **Post-stream** — memory extraction (`extractAndSaveMemories`), entitlement usage pull.

---

## MCP tools in chat

MCP clients connect with:

```
Authorization: Bearer <session-jwt>
X-Workspace-Id: <workspaceId>
```

Plus workspace-configured external MCP servers from `frontend.mcp_server` table.

Tool execution timeout: user's `mcpTimeoutMs` workspace setting (default 300000 ms).

**Google provider note:** MCP tools are **disabled** for `provider === 'google'`
(Gemini tool schema limitations). Only builtin + Tavily tools run.

Wrapped behaviors:

| Tool | Chat-specific behavior |
| ---- | --------------------- |
| `d6e_sql` (and `*__d6e_sql`) | `needsApproval` based on `sqlApprovalMode`; see below |
| Other MCP tools | Binary detection → `data-binaryFile` chunk; image truncation; output smart-truncate |
| `fetch` | Builtin; SSRF-safe fetch; skill URL resolution |
| `ask_user` | No server execute — client supplies result via `addToolOutput` |
| Tavily | Web search tools when configured |

---

## SQL human-in-the-loop (HITL)

SQL tools use AI SDK `needsApproval` when the user's
`sqlApprovalMode` workspace setting requires it:

| Mode | Requires approval for |
| ---- | --------------------- |
| `none` | Never |
| `all` | Every SQL statement |
| `ddl_only` | CREATE / ALTER / DROP TABLE |
| `write_only` (default) | INSERT, UPDATE, DELETE, DDL, unknown |

Classification shared with client UI via `classifySqlOperation` in
`$lib/utils`.

Flow:

1. Model calls `d6e_sql` with `{ sql: "..." }`.
2. Stream emits tool call with `approval-requested` state.
3. User approves/denies in chat UI.
4. On approve, tool executes; result streams back.
5. On deny, execution skipped.

Configure mode via
[memories-mcp-settings.md § workspace-settings](./memories-mcp-settings.md).

Direct REST `POST /api/v1/workspaces/{id}/sql` has **no** approval step — policy
evaluation only. Chat adds UX gate on top.

---

## ask_user tool

Interactive question card with optional choice buttons. **No server-side
execute** — the chat client must call `addToolOutput` with the user's answer.

Special case: if user replies via main chat input (e.g. with file attachment),
tool result is the literal `ASK_USER_SKIP_MARKER`; the next user message
contains the actual response.

Custom frontends implementing chat must handle this protocol or omit `ask_user`
from their UI (tool calls will hang without client output).

---

## Memory injection

When `memoryEnabled` is true (per-user workspace setting):

1. `loadUserMemories(userId, workspaceId)` loads stored memories.
2. `buildMemoryPromptSection` appends to system prompt.
3. After stream, `extractAndSaveMemories` may persist new memories from the turn.

CRUD for memories: [memories-mcp-settings.md](./memories-mcp-settings.md).

There is **no REST equivalent** for memory injection — chat-only behavior.

---

## Context compaction

When conversation token count exceeds configured thresholds:

1. Prune old tool outputs (opencode-style).
2. If still overflowing, LLM summary of older turns.
3. Integrity validation with fallback if summary fails.

Compaction summary is **not** persisted server-side (race with client PATCH).
Next overflow may re-summarize.

Env config via `getCompactionConfig()` — no public REST API.

---

## Errors

| Status | Meaning |
| ------ | ------- |
| 401 | Missing session / cookie |
| 400 | Missing messages or workspaceId; invalid UIMessage format |
| 403 | Not workspace member; model not in subscription |
| 402 | `llm_soft_gated` — billing / credits (same envelope as generate-title) |

---

## Related session routes (Cookie)

| Route | Purpose |
| ----- | ------- |
| `GET/POST /api/chat-sessions` | List / create sessions |
| `GET/PATCH/DELETE /api/chat-sessions/{id}` | Session CRUD + message persistence |
| `POST /api/chat-sessions/generate-title` | AI title generation |

See [console-bff-catalog.md](./console-bff-catalog.md).

---

## Custom frontend guidance

| Need | Approach |
| ---- | -------- |
| Conversational agent with MCP | Proxy `POST /api/chat` with Cookie |
| Structured JSON from NL (keiri bot) | `POST /api/workflows/execute-by-intent` — [async-intent-jobs.md](./async-intent-jobs.md) |
| Direct SQL without LLM | Bearer `POST …/sql` — [sql.md](./sql.md) |
| SaaS calls without agent | Bearer `POST /api/v1/saas-proxy` — [saas-proxy.md](./saas-proxy.md) |

For prompt-driven JSON contracts on top of execute-by-intent, see
[d6e-prompt-driven-ui](../../d6e-prompt-driven-ui/SKILL.md) and link to this
doc for full chat/MCP scenarios.

## Related

- [mcp-rest-map.md](./mcp-rest-map.md) — MCP ↔ REST mapping
- [memories-mcp-settings.md](./memories-mcp-settings.md) — settings that control chat behavior
- [async-intent-jobs.md](./async-intent-jobs.md) — NL automation without chat UI
- [auth-header-matrix.md](./auth-header-matrix.md) — Cookie routes
- [api-catalog.md](./api-catalog.md) — master index
