# Async intent job API

Detaches long-running `execute-by-intent` agent runs from the HTTP request
lifetime. Available on d6e instances running `feat/async-intent-jobs` or
later.

See also [docs/d6e-api-integration.md §2b](../../../docs/d6e-api-integration.md)
and [platform-timeouts.md](./platform-timeouts.md).

## When to use

| Scenario | Recommendation |
| -------- | -------------- |
| Vercel / CF frontend, heavy runs (> 5 min) | **Async** |
| SNS bot (Slack / Discord / LINE) | **Sync** — simpler |
| Light runs (< 2 min) | Either; sync is simpler |
| Progress UI (tool trace) | **Async** |
| User cancel button | **Async** — sync has no cancel |

## Endpoints

| Method | Path | Purpose |
| ------ | ---- | ------- |
| `POST` | `/api/workflows/execute-by-intent/jobs` | Create job → `{ jobId }` |
| `GET` | `/api/workflows/execute-by-intent/jobs/{id}` | Poll status, tool trace, result |
| `POST` | `/api/workflows/execute-by-intent/jobs/{id}/cancel` | Cooperative cancel |

All use `Authorization: Bearer <jwt>`. Pin `workspaceId` in the create body
from `getD6eWorkspaceId(caller)`.

## Job lifecycle

```
queued → running → succeeded
                 → failed
                 → cancelled
```

| Status | Meaning |
| ------ | ------- |
| `queued` | Row created; awaiting runner pickup |
| `running` | Runner claimed job; heartbeat ~every 10s; checks `cancel_requested` |
| `succeeded` | `result` carries same `IntentResponse` as sync endpoint |
| `failed` | `error` describes cause (LLM failure, timeout, …) |
| `cancelled` | Cooperative cancel; `error` = `"Job was cancelled"` |

## Create job

**Request:**

```json
{
  "workspaceId": "<UUID, server-pinned>",
  "message": "領収書を仕訳に変換してください",
  "inputFileRefs": [
    {
      "fileId": "<UUID>",
      "filename": "receipt.jpg",
      "mimeType": "image/jpeg",
      "sizeBytes": 124300
    }
  ],
  "conversationContext": "<optional>"
}
```

**Response:** `{ "jobId": "019bbac4-…" }` (HTTP 200, not 202).

**Errors:** `401`, `403`, `422`, `429` (concurrency cap), `500`.

## Poll status

**Response:**

```json
{
  "id": "019bbac4-…",
  "status": "running",
  "toolTrace": [
    {
      "tool": "d6e_execute_workflow",
      "startedAt": "2025-01-15T10:30:00Z",
      "finishedAt": "2025-01-15T10:30:45Z"
    }
  ],
  "startedAt": "2025-01-15T10:30:00Z",
  "finishedAt": null,
  "elapsedMs": 46000,
  "result": null,
  "error": null
}
```

Terminal statuses: `succeeded`, `failed`, `cancelled`. On `succeeded`,
read `result` (same shape as sync `execute-by-intent`).

## Cancel

**Response:** `{ "cancelled": true | false }`

`false` means the job was not `running` when cancel arrived (already
finished or still `queued`). Check poll `status` and `finishedAt`.

Cancellation is **cooperative** — runner checks flag on next heartbeat (~10s).

## Wrapper functions

Add to `src/lib/server/d6e-client.ts`:

```ts
export async function createAsyncIntentJob(
  caller: string,
  accessToken: string,
  body: { message: string; inputFileRefs?: IntentInputFileRef[]; conversationContext?: string }
): Promise<{ jobId: string }>;

export async function getAsyncIntentJobStatus(
  caller: string,
  accessToken: string,
  jobId: string
): Promise<AsyncJobStatusResponse>;

export async function cancelAsyncIntentJob(
  caller: string,
  accessToken: string,
  jobId: string
): Promise<{ cancelled: boolean }>;
```

```ts
type AsyncJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

interface AsyncJobToolTrace {
  tool: string;
  startedAt: string;
  finishedAt?: string | null;
}

interface AsyncJobStatusResponse {
  id: string;
  status: AsyncJobStatus;
  toolTrace: AsyncJobToolTrace[];
  startedAt: string | null;
  finishedAt: string | null;
  elapsedMs: number | null;
  result: IntentResponse | null;
  error: string | null;
}
```

## Integration pattern (Vercel)

1. **Submit** — server route calls `createAsyncIntentJob()`, returns
   `{ jobId }` to browser immediately.
2. **Background finalize (optional)** — `waitUntil()` polls until terminal,
   writes `chat_session`.
3. **Client poll** — browser hits same-origin proxy (e.g.
   `/api/intent/d6e-job/{id}`) every 3–5s; render `toolTrace` + `elapsedMs`.
4. **Cancel** — same-origin `POST …/cancel` when user clicks cancel.
5. **Finalize** — on terminal status, process `result` or show `error`.

Never expose raw `${D6E_BASE_URL}/api/workflows/execute-by-intent/jobs/…`
URLs to the browser.

## Guardrails

| Guardrail | Default | Env var |
| --------- | ------- | ------- |
| Wall-clock cap | 30 min | `INTENT_JOB_TIMEOUT_MS` |
| Step cap | 50 | `AGENT_RECURSION_LIMIT` |
| Heartbeat stale | 60s | — (job → `failed` on stale poll) |
| Workspace concurrency | 3 running jobs | — (429 on excess) |
| Tool trace cap | 100 entries | — |

## Troubleshooting

| Symptom | Cause | Action |
| ------- | ----- | ------ |
| `429` on create | 3 concurrent jobs per workspace | Wait, cancel one, or ask admin to raise limit |
| Stale `running` + old heartbeat | Runner killed mid-flight | d6e marks `failed` after 60s stale; check instance health |
| `cancelled: false` | Job already terminal | Read poll `status` |
| Result lost after tab close | No persistence | Use `waitUntil()` or rely on d6e `intent_job` row + reload poll |

## Upstream reference

[d6e `packages/frontend/src/routes/api/workflows/execute-by-intent/jobs/`](https://github.com/d6e-ai/d6e/blob/main/packages/frontend/src/routes/api/workflows/execute-by-intent/jobs/)
