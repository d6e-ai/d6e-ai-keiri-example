# Platform timeouts and long-running work

Custom frontends sit on serverless or edge runtimes (Vercel, Cloudflare
Workers) while d6e runs as a long-lived container. Design proxies so the
**worker returns quickly** and heavy work stays on d6e or streams without
buffering.

## Vercel (SvelteKit + adapter-vercel)

| Constraint | Typical value | Implication |
| ---------- | ------------- | ----------- |
| `maxDuration` | 300s default; up to ~800s on Fluid Compute | Sync `execute-by-intent` must finish below this |
| `waitUntil()` | Extends background work after response sent | Good for async job finalization + chat_session writes |
| Request body size | ~4.5 MB (Hobby) / larger on Pro | Reinforces app-side upload caps |
| Memory | 1–3 GB tier-dependent | Buffering a 100 MB download can OOM |

**Patterns:**

- **Long LLM agent runs** → [`async-intent-jobs.md`](./async-intent-jobs.md):
  POST job (immediate `{ jobId }`), poll from browser every 3–5s. Optional
  `waitUntil()` to persist result to `chat_session` after terminal status.
- **Sync execute-by-intent** → keep wrapper `timeoutMs` **below**
  `maxDuration` (this repo uses 270s vs 300s cap) so the function returns
  a clean 504 instead of being killed mid-flight.
- **File download** → stream `upstream.body` through the proxy; do not
  `arrayBuffer()` large files. Size download proxy timeouts for expected
  file sizes (60–120s for tens of MB on slow links).

## Cloudflare Workers

| Constraint | Typical value | Implication |
| ---------- | ------------- | ----------- |
| CPU time | ~30s (paid tiers vary) | Hard ceiling for CPU-bound work in the isolate |
| Subrequest limits | 1000 subrequests / invocation | Polling loops must run client-side, not in one worker call |
| Response streaming | Supported but tricky with transforms | Prefer pass-through stream; avoid parsing body |
| Memory | 128 MB default | Never buffer 100 MB saas-proxy-download bodies in the worker |

**Patterns:**

- **Long LLM tool chains** → same as Vercel: create async intent job on
  d6e, return `{ jobId }` immediately, poll from the browser via thin
  same-origin routes.
- **File transfer** → worker does auth + metadata + **stream only**. Step 1
  (`saas-proxy-download`) can run on d6e (100 MB persisted server-side);
  step 2 streams from d6e storage through the worker without loading bytes
  into memory.
- **If CF is too constraining** → Vercel (or a small Node sidecar) is a
  practical alternative for download proxies and sync intent. Document the
  trade-off: CF edge latency vs Vercel's higher duration/memory for
  streaming.

## Decision matrix

| Workload | Recommended pattern | Avoid |
| -------- | ------------------- | ----- |
| Agent run > 5 min | Async intent jobs + client poll | Sync execute-by-intent |
| Agent run < 2 min, SNS bot | Sync execute-by-intent | Async overhead |
| SaaS JSON API call | `saas-proxy` in server route | Calling provider directly |
| SaaS binary ingest | `saas-proxy-download` then stream | `saas-proxy` (10 MB cap) |
| Browser file download | Same-origin streaming GET proxy | 302 to `${D6E_BASE_URL}` |
| SQL admin UI | Short execute/preview per click | Long polling in one function |
| Background persistence | `waitUntil()` on Vercel | Blocking the HTTP response |

## Abort and timeout flags

Pass `event.request.signal` into wrappers. Map aborts to
`D6eClientError(status=499, aborted=true)` and timeouts to
`status=504, timedOut=true` so the UI can distinguish user cancel from
platform timeout.

## Related

- [async-intent-jobs.md](./async-intent-jobs.md)
- [download-two-step.md](./download-two-step.md)
- [size-limits.md](./size-limits.md)
