# Voice transcribe (Whisper)

Instance-only Cookie BFF for speech-to-text via OpenAI Whisper. **No Rust
`/api/v1` equivalent.** Requires `OPENAI_API_KEY` on the **d6e instance** — custom
frontends proxy the route; do not add the key to your app `.env`.

See [llm-and-embedding-keys.md § Exceptions](./llm-and-embedding-keys.md#exceptions--keys-that-are-not-the-ai-gateway).

Implementation:
[`packages/frontend/src/routes/api/transcribe/+server.ts`](https://github.com/d6e-ai/d6e/blob/main/packages/frontend/src/routes/api/transcribe/+server.ts)

---

## Auth

```
Cookie: auth-token=<jwt>
```

Requires both `auth-token` cookie **and** `locals.user`. Bearer rejected.

---

## GET `/api/transcribe`

Probe whether transcription is available (instance has `OPENAI_API_KEY`).

**Response:** `200`

```json
{ "available": true }
```

`available` is `false` when `OPENAI_API_KEY` is unset.

| Status | Cause |
| ------ | ----- |
| 401 | Missing cookie or user session |

---

## POST `/api/transcribe`

Transcribe an audio upload.

**Request:** `multipart/form-data`

| Part | Required | Notes |
| ---- | -------- | ----- |
| `audio` | Yes | Audio blob/file |
| `language` | No | ISO language hint passed to Whisper |

**Limits:** max **25 MB** per file (Whisper API limit). Default filename when
missing: `recording.webm`.

**Response:** `200`

```json
{ "text": "Transcribed content here" }
```

Silent or near-silent audio may return `{ "text": "" }` when Whisper reports
high `no_speech_prob` on all segments (hallucination guard).

### Errors

| Status | Cause |
| ------ | ----- |
| 400 | Not multipart, or missing `audio` field |
| 401 | Not authenticated |
| 413 | File larger than 25 MB |
| 503 | `OPENAI_API_KEY` not configured on instance |
| 502 | Whisper API failure |

Example 503 body:

```json
{
  "error": "Voice transcription is not available (API key not configured)"
}
```

---

## Custom frontend proxy pattern

1. `GET` availability before showing a microphone button.
2. `POST` browser `FormData` with `audio` part through your same-origin
   `/api/transcribe` proxy, forwarding `Cookie: auth-token=<jwt>` to
   `D6E_BASE_URL`.
3. Never expose `OPENAI_API_KEY` to the browser.

---

## Related

- [console-bff-catalog.md](./console-bff-catalog.md) — BFF inventory
- [llm-and-embedding-keys.md](./llm-and-embedding-keys.md) — operator env keys
- [chat-streaming.md](./chat-streaming.md) — chat (separate from transcribe)
