# Output files from execute-by-intent

Besides fenced JSON in `message`, `IntentResponse` may include a `files[]`
array when the agent produces binaries (Excel exports, PDFs, generated
reports). Prompt-driven UI must surface these without breaking auth or
serverless memory limits.

```ts
interface IntentResponseFile {
  data: string;      // base64 payload
  filename: string;
  mimeType: string;
}
```

Sync and async jobs return the same shape on `result.files[]` after success.

## Two output channels

| Channel | Shape | Typical source | UI download pattern |
| ------- | ----- | -------------- | ------------------- |
| **Inline `files[]`** | base64 in JSON | MCP tool binary capture (`d6e_instant_run_stf`, wrapped MCP tools) | Client blob **or** server persist → proxy |
| **Storage `fileId`** | UUID in tool result / registration JSON | Upload, `saas-proxy-download`, Drive materialize | Same-origin **streaming proxy** only |

Do not mix them: inline base64 is already in the HTTP response; storage ids
require Bearer + `X-Workspace-ID` on step 2 of the download flow.

## Rendering inline `files[]` (small / moderate files)

Upstream attaches binaries during the agent loop and returns them base64-encoded
to avoid a second Storage round-trip for modest outputs.

**Browser-only (fits in memory):**

```ts
function downloadInlineFile(file: IntentResponseFile): void {
  const bytes = Uint8Array.from(atob(file.data), (c) => c.charCodeSync(0));
  const blob = new Blob([bytes], { type: file.mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = file.filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
```

Guard: skip malformed entries (missing `data` / `filename` / `mimeType`) rather
than failing the whole card — same tolerance as `parseAssistantMessage()`.

**Do not** persist large base64 blobs into `chat_session` JSONB — strip or
replace with storage ids before PATCH (see d6e console agents page pattern).

## Large files — persist then stream via proxy

For Excel/PDF outputs that exceed client memory or serverless response limits:

1. **Server route** decodes `files[].data` (or receives storage id from tool
   metadata) and `POST`s multipart to workspace storage via `uploadFile()`.
2. Return `{ fileId, filename, mimeType }` to the browser (not base64).
3. Render download links against your app origin:

```html
<a href="/api/files/{fileId}/download" download="{filename}">
  Download {filename}
</a>
```

Proxy implementation in this repo:
[`src/routes/api/files/[fileId]/download/+server.ts`](../../../src/routes/api/files/%5BfileId%5D/download/+server.ts).

**Never** 302-redirect the browser to
`${D6E_BASE_URL}/api/v1/.../download` — JWT is HTTP-only; redirects fail
auth or leak URL patterns.

Full two-step flow (metadata → stream):
[`download-two-step.md`](../../d6e-workspace-api-client/references/download-two-step.md).

## Prompt + card layout

- Keep structured **`kind` JSON in `message`** for tables/cards; treat `files[]`
  as **attachments** beside the parsed card (download chips / links).
- Registration scenarios (`kind: "registration"`) may include `web_view_link`
  for SaaS URLs **and** `files[]` for generated artifacts — render both.
- Excel MIME: `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
  — set `download` attribute with `.xlsx` filename from `filename` field.

## Platform notes

| Platform | Inline base64 | Storage proxy |
| -------- | ------------- | ------------- |
| Vercel | OK under ~4.5 MB response budget; prefer persist+stream above that | Stream `upstream.body`; see [platform-timeouts.md](../../d6e-workspace-api-client/references/platform-timeouts.md) |
| Cloudflare Workers | Avoid large base64 in JSON responses | **Required** for big binaries — 128 MB isolate memory |

Async jobs: finalize UI only after `status === 'succeeded'`, then process
`result.files[]` — see [async-jobs-ui.md](./async-jobs-ui.md).

## Checklist

- [ ] Parse `message` with `parseAssistantMessage()`; render `files[]` separately.
- [ ] Validate each file entry; ignore bad rows.
- [ ] Large outputs → upload server-side → `/api/files/{id}/download` link.
- [ ] Proxy streams bytes; never buffers 100 MB on Workers.
- [ ] Do not embed base64 downloads inside `{@html}` markdown — XSS risk.

## Related

- [async-jobs-ui.md](./async-jobs-ui.md)
- [`d6e-workspace-api-client` download-two-step.md](../../d6e-workspace-api-client/references/download-two-step.md)
- [`d6e-workspace-api-client` file-storage.md](../../d6e-workspace-api-client/references/file-storage.md)
- [docs/d6e-api-integration.md §2](../../../docs/d6e-api-integration.md) — `IntentResponse` fields
