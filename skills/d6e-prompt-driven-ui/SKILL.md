---
name: d6e-prompt-driven-ui
description: Designs prompt-driven UI for d6e-connected frontends — workspace prompt rules that emit `kind`-discriminated JSON inside fenced code blocks, Zod-based parsers with markdown fallback, revision flows driven by XML tags, and the interactive "scenario append" pattern for adding new behaviour without touching the base prompt. Use when authoring a new `scripts/prompts/*.md` file, when the LLM is drifting off-contract, when adding a new task type to an existing prompt, or when the frontend should render structured JSON cards instead of raw assistant text.
---

# d6e Prompt-Driven UI

## Overview

A d6e workspace prompt rule turns the LLM behind
`/api/workflows/execute-by-intent` into a typed JSON producer. The
frontend renders that JSON as cards, tables, status badges, and
"follow-up" forms — never raw chat bubbles. This skill teaches the
three layers that make that work reliably:

1. **Prompt layer** — Force the LLM into one of a small set of
   scenarios, each declaring `kind` plus a strict field schema, all
   emitted inside a single ` ```json ` fenced code block.
2. **Parse layer** — Strip the fences, `JSON.parse` each block, and
   dispatch on `kind` against a Zod schema. Never throw.
3. **Render layer** — Switch on `parsed.kind` to pick a typed
   component; fall back to a markdown render of the raw assistant
   text so the card never goes blank.

The same workspace rule also defines **revision flows** (the user
edits the previous output by sending a follow-up message wrapped in
`<previous_journal>` / `<additional_comment>` / `<registration_request>`
tags) and supports **scenario-append activation** (a user pastes a
second prompt into the d6e chat UI, the d6e AI uses MCP tools to bake
workspace-specific values into placeholders, and inserts a new
section into the existing rule).

## When to Use

Apply this skill when the user says:

- "Add a new task type that produces a JSON card"
- "Why is the model outputting a table instead of JSON?"
- "Make the LLM stop emitting ```json on general questions"
- "Validate the LLM response with Zod"
- "Add a revise / 修正 flow"
- "Bake the freee company ID into the prompt automatically"
- "新しい AI 経理 bot シナリオを追加したい"
- "JSON スキーマでフロントの表示を制御するプロンプトを書きたい"

## Core Concepts

### The three layers

````mermaid
flowchart LR
    Prompt["scripts/prompts/<name>.md<br/>Prompt layer<br/>(forces ```json + kind)"]
    Parser["src/lib/parse-journal.ts<br/>Parse layer<br/>(fence regex + Zod dispatch)"]
    Schema["src/lib/journal-schema.ts<br/>Schema layer<br/>(z.literal('kind'))"]
    Ui["journal-result.svelte<br/>registration-result.svelte<br/>Render layer<br/>(parsed.kind switch + markdown fallback)"]

    Prompt -->|"assistant message"| Parser
    Parser -->|"validates"| Schema
    Schema -->|"typed payload"| Ui
    Parser -->|"on mismatch"| Ui
````

Each layer **must** be permissive at the boundary so the layer below
can decide what to do:

- The prompt instructs the LLM but doesn't enforce — the LLM can still
  drift.
- The parser tolerates partial matches and unknown shapes — it never
  throws, it returns a discriminated result type.
- The renderer switches on that discriminator and falls back to
  markdown — never a blank card.

### Scenario classification

A single workspace prompt rule classifies every turn into one of
several scenarios based on **observable inputs**: attachments,
specific XML tags in the user message, and the `kind` of the prior
assistant turn. Example from
[`scripts/prompts/ai-keiri-prompt.md`](../../scripts/prompts/ai-keiri-prompt.md):

| Scenario           | Trigger                                                                                                                         | Required output                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| A — create journal | message has an attached image AND no XML revision tag                                                                           | 1-2 line intro + one ` ```json ` block with `kind: "journal"`                                                |
| B — revise journal | message contains `<previous_journal>...</previous_journal>`                                                                     | same shape; full re-emission, never partial patch                                                            |
| C — general Q&A    | no image AND no revision tags                                                                                                   | plain Japanese markdown; **explicitly forbids** ` ```json ` so the parser falls through to markdown fallback |
| D — registration   | message contains `<registration_request>` OR (prior turn was `kind: "registration"` AND new message has `<additional_comment>`) | one ` ```json ` block with `kind: "registration"`                                                            |

Why classification matters: the parser sees only the assistant's
final text, so the prompt must make scenarios distinguishable from
the input alone, and every scenario must agree on whether a JSON
fence is required. If a "general Q&A" scenario sneaks a JSON block
through, the parser will turn it into a card and confuse the user.

### `kind` as the JSON discriminator

Every JSON payload in the contract has a literal `kind` string at
the top level. Zod uses `z.literal('...')` to ensure no other value
slips through.

```json
{ "kind": "journal", "entries": [...], "warnings": [] }
```

```json
{ "kind": "registration", "status": "success", "freee": {...}, "drive": {...}, "warnings": [], "follow_up_question": null }
```

This makes the dispatch in `parse-journal.ts` trivially safe:
inspect `json.kind`, then run the matching schema. Unknown `kind`
values fall through to fallback rendering rather than rejecting the
whole message.

### XML tags drive revision flows

Revisions are **natural-language messages** that re-include enough
context for the LLM to regenerate the previous output. The frontend
composes the message; the workspace prompt declares the trigger
tags.

```
前回生成した仕訳に対する修正依頼です。
<previous_journal>
{"kind":"journal","entries":[...],"warnings":[]}
</previous_journal>

修正指示: <user's free-form revision text>

仕訳全体を再生成し、変更を反映した完全な JSON を返してください。
```

The same `inputFileRefs[]` is re-sent so the LLM can re-read the
receipt image. The model returns a _new complete_ `kind: "journal"`
payload — never a partial patch — which simplifies the parser and
the render layer (they always see a full document).

### Markdown fallback is sacred

`parse-journal.ts` returns one of three discriminated results:

```ts
type ParseResult =
  | { kind: 'journal'; result: JournalResult; rawText: string }
  | { kind: 'registration'; result: RegistrationResult; rawText: string }
  | {
      kind: 'fallback';
      reason: 'no_code_block' | 'invalid_json' | 'schema_mismatch';
      detail: string;
      rawText: string;
    };
```

`rawText` is the original assistant message. The renderer treats
`fallback` by passing `rawText` through a markdown renderer — so even
a totally off-contract response is still visible to the user. Schema
strictness never costs UX.

### Scenario append: bake workspace values into the prompt

Some scenarios need workspace-specific values (a freee `company_id`,
a Google Drive folder ID) that are unique per workspace and ought
not to be guessed at runtime. The pattern is:

1. The user pastes a **second** prompt file (e.g.
   [`scripts/prompts/freee-registration-prompt.md`](../../scripts/prompts/freee-registration-prompt.md))
   into the d6e chat UI.
2. The receiving d6e AI uses MCP tools
   (`d6e_list_workspace_prompt_rules`, `d6e_list_saas_credentials`,
   `d6e_call_external_api`, `d6e_update_workspace_prompt_rule`) to
   - find the rule that already contains the base scenarios,
   - check that the relevant SaaS connections are healthy,
   - call `GET /api/1/companies` (freee) and
     `GET /drive/v3/files?q=...folder...` (Google Drive) to ask the
     user which entities to bind,
   - substitute the chosen IDs into `{{company_id}}`,
     `{{drive_folder_id}}`, ... placeholders,
   - and insert the now-concrete section into the existing rule at a
     specific anchor (the `## 共通ルール` heading is used as the
     insertion boundary so the new scenario sits _between_ the
     existing scenarios and the shared rules).
3. An idempotency guard (a heading match like `### シナリオ D`)
   prevents the same activation message from doubling up the
   inserted section.

This keeps the deploy-time prompt fixed and human-reviewed while
deferring the workspace-specific binding to a one-time interactive
dance the user can rerun whenever the bindings need to change.

## Quick Start

A minimal `kind: "journal"` contract end-to-end.

### Step 1: write the prompt

````markdown
# AI Accounting — workspace prompt

あなたは経理アシスタントです。次の規則で応答してください。

## シナリオ A: 仕訳作成

トリガ: ユーザーメッセージに添付画像があり `<previous_journal>` タグが
**含まれない**。

応答:

- 1〜2 文の日本語前置き
- 続けて 1 つだけの `json` フェンスコードブロック
- コードブロックの**後ろ**には何も書かない

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

## シナリオ B: 仕訳修正

トリガ: メッセージに `<previous_journal>...</previous_journal>` タグが含まれる。
応答: シナリオ A と完全に同じスキーマで、修正反映後の **完全な JSON** を返す。

## シナリオ C: 一般質問

トリガ: 添付画像もタグも無いメッセージ。
応答: 通常の日本語マークダウン。
`json` フェンスコードブロックは **絶対に出さない**
(フロントが誤って仕訳テーブルとして解釈してしまう)。
````

Real file:
[`scripts/prompts/ai-keiri-prompt.md`](../../scripts/prompts/ai-keiri-prompt.md).

### Step 2: define the Zod schema

```ts
// src/lib/journal-schema.ts (excerpt)
import { z } from 'zod';

export const JournalEntrySchema = z.object({
  date: z.string().min(1),
  debit_account: z.string().min(1),
  credit_account: z.string().min(1),
  amount: z.number().int().nonnegative(),
  tax_amount: z.number().int().nonnegative().optional(),
  description: z.string().min(1)
});

export const JournalResultSchema = z.object({
  kind: z.literal('journal'),
  entries: z.array(JournalEntrySchema).min(1),
  warnings: z
    .array(z.string())
    .nullish()
    .transform((v) => v ?? [])
});

export type JournalResult = z.infer<typeof JournalResultSchema>;
```

Notable choices:

- `kind: z.literal('journal')` is the discriminator — without it the
  dispatcher cannot route reliably.
- `amount` is `z.number().int().nonnegative()` — JPY has no fractional
  yen and negative totals are nonsensical.
- `date` is `z.string().min(1)` with **no regex** — the LLM occasionally
  emits `"推定: 2026-04-30"` for hard-to-read receipts and we want
  that information visible, not rejected.
- `warnings` uses `nullish().transform()` so an absent field becomes
  `[]` without forcing the LLM to remember the literal `"warnings": []`.

### Step 3: parse with a fence-aware regex

````ts
// src/lib/parse-journal.ts (excerpt)
const JSON_FENCE_RE = /```(?:json)?\s*([\s\S]*?)```/gi;

export function extractJsonBlocks(message: string): string[] {
  if (!message) return [];
  const blocks: string[] = [];
  JSON_FENCE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = JSON_FENCE_RE.exec(message)) !== null) {
    const body = match[1]?.trim();
    if (body) blocks.push(body);
  }
  return blocks;
}

export function parseAssistantMessage(message: string): ParseResult {
  const blocks = extractJsonBlocks(message);
  if (blocks.length === 0) {
    return { kind: 'fallback', reason: 'no_code_block', detail: '...', rawText: message };
  }
  for (const block of blocks) {
    let json: unknown;
    try {
      json = JSON.parse(block);
    } catch {
      continue;
    }
    const dispatched = dispatchSchema(json, message);
    if (dispatched) return dispatched;
  }
  return { kind: 'fallback', reason: 'schema_mismatch', detail: '...', rawText: message };
}
````

The regex is **case-insensitive** (`i`) and accepts both ` ```json `
and bare ` ``` ` (some models drop the language tag). The `g`
flag plus the explicit `lastIndex = 0` reset is deliberate: keeping a
single shared regex avoids re-compilation but requires the reset to
survive re-entry.

The **first** fenced block whose `kind` matches a known schema wins.
Trailing "example" blocks that some chatty models tack on are
ignored.

### Step 4: render with a kind switch

```svelte
<!-- src/lib/components/journal-result.svelte (simplified) -->
{#if parsed.kind === 'journal'}
  <table>...</table>
{:else if parsed.kind === 'registration'}
  <RegistrationResult {parsed} />
{:else}
  <div class="warning">
    <p>reason: {parsed.reason} — {parsed.detail}</p>
    <div class="prose">{@html renderMarkdown(parsed.rawText)}</div>
  </div>
{/if}
```

The fallback branch always renders **something**. The user sees the
parse reason and the raw assistant text, formatted as markdown.

## Reference

### Field conventions

| Field                          | Type                                                                                           | Why                                                                                    |
| ------------------------------ | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `kind`                         | `z.literal('<name>')`                                                                          | Mandatory discriminator — drives `dispatchSchema` and the UI switch.                   |
| `amount` / `tax_amount`        | `z.number().int().nonnegative()`                                                               | JPY is integer-only; rejection on string saves the UI from numeric coercion bugs.      |
| `date`                         | `z.string().min(1)`                                                                            | No format enforcement — the LLM may prefix uncertain dates.                            |
| `warnings`                     | `z.array(z.string()).nullish().transform(v => v ?? [])`                                        | Optional in practice; default to empty array.                                          |
| `web_view_link` (URL)          | `.string().nullish().transform(v => { try { new URL(v); return v; } catch { return null; } })` | Salvage malformed URLs to `null` instead of failing the whole payload.                 |
| `freee.company_id` / `deal_id` | `z.union([z.number(), z.string()])`                                                            | Some LLMs emit large integer IDs as strings to dodge JS Number precision; accept both. |

### Parse return type

```ts
interface ParsedJournal {
  kind: 'journal';
  result: JournalResult;
  rawText: string;
}
interface ParsedRegistration {
  kind: 'registration';
  result: RegistrationResult;
  rawText: string;
}
interface ParsedFallback {
  kind: 'fallback';
  reason: 'no_code_block' | 'invalid_json' | 'schema_mismatch';
  detail: string;
  rawText: string;
}
type ParseResult = ParsedJournal | ParsedRegistration | ParsedFallback;
```

`rawText` is always populated so the renderer can show the raw model
output regardless of branch. The three fallback `reason`s map to
operationally distinct fixes:

| `reason`          | Meaning                               | Fix                                                                                  |
| ----------------- | ------------------------------------- | ------------------------------------------------------------------------------------ |
| `no_code_block`   | LLM never emitted a fence             | Tighten prompt: "Always emit one ` ```json ` block per response"                     |
| `invalid_json`    | Found a fence but `JSON.parse` failed | Tell the model to escape quotes inside strings; add an example with `\\"`            |
| `schema_mismatch` | Parsed JSON but Zod rejected it       | Look at `[parse-journal] schema mismatch` log; usually a missing field or wrong type |

All three log via `console.warn('[parse-journal] ...')` with enough
detail to grep in the browser dev console.

### Revision message templates

Journal revision (Scenario B trigger):

```
前回生成した仕訳に対する修正依頼です。
<previous_journal>
{ "kind": "journal", "entries": [...], "warnings": [] }
</previous_journal>

修正指示: <user's revision text>

仕訳全体を再生成し、変更を反映した完全な JSON を返してください。
```

Registration follow-up (Scenario D follow-up):

```
直前の freee 登録ターンへの追加コメントです。
<additional_comment>
<user's free-form text>
</additional_comment>

必要に応じて未完了の登録 / Drive アップロードを実行し、最新の状態を kind:"registration" JSON で返してください。
```

Registration kick-off (Scenario D primary trigger):

```
下記の仕訳を freee に登録し、添付の領収書を Google Drive にアップロードしてください。
<registration_request>
{ "kind": "journal", "entries": [...], "warnings": [] }
</registration_request>
```

The frontend composes these from the _current_ parsed payload — see
[`src/routes/+page.svelte`](../../src/routes/+page.svelte) for the
composer, [`src/lib/parse-journal.ts`](../../src/lib/parse-journal.ts)
for parsing the model's reply.

### Scenario-append (`freee-registration-prompt.md`) structure

The activation file has four sections:

1. **Preamble blockquote** — tells the receiving d6e AI not to register
   this file as a rule, but to use it as an _instruction sheet_.
2. **Step-by-step procedure** — list of imperative steps, each citing
   a specific MCP tool and the exact REST call. Example:
   "Step 5: call `d6e_call_external_api` with `provider: 'freee',
method: 'GET', path: '/api/1/companies'` to fetch the company
   list."
3. **Guardrails** — a short list of forbidden operations (do not call
   `d6e_delete_workspace_prompt_rule`, do not modify Scenarios A/B/C
   text, idempotency check) so the d6e AI cannot drift into
   destructive behaviour.
4. **Append body template** — the actual scenario text with
   `{{placeholder}}` slots that the d6e AI replaces with the values
   it discovered via the MCP tools.

The activation file deliberately is **not** registered via
`scripts/init-workspace.mjs`. Adding it would defeat the
"interactively bind workspace values" goal.

### Insertion anchor: `## 共通ルール`

The base prompt ends with a `## 共通ルール` heading that contains
rules shared by every scenario (output language, refusal patterns,
tool-use policy). New scenarios insert **immediately before** that
heading so:

- Scenarios A / B / C / D form one contiguous block of task scenarios.
- The shared rules below them apply to all four uniformly.
- The idempotency guard (`### シナリオ D` heading already present)
  is straightforward to implement: search the rule body, skip if
  found, otherwise split on `## 共通ルール`, splice, rejoin.

### Prompt source of truth

`scripts/prompts/*.md` files are the single source of truth for
workspace prompt rule content. The init script computes their
SHA-256 and skips POSTing when an identical rule already exists (see
the [`d6e-workspace-api-client`](../d6e-workspace-api-client/SKILL.md)
skill for the full idempotent registration flow). The matching
operational rule: **never edit the prompt directly in the d6e admin
UI**, because the next `npm run init` won't see a matching hash and
will create a duplicate.

## Implementation Checklist

- [ ] Every JSON payload has a top-level `kind: z.literal('<name>')`.
- [ ] The prompt enforces exactly one ` ```json ` block per response and tells the model to put nothing after it.
- [ ] Each scenario states a _visible-to-the-LLM_ trigger condition (attachment, XML tag, prior assistant `kind`) so classification is deterministic.
- [ ] At least one scenario forbids JSON fences to keep general Q&A out of the structured-card pipeline.
- [ ] `parseAssistantMessage()` never throws — failures collapse to `kind: 'fallback'`.
- [ ] The regex uses both the `g` and `i` flags and resets `lastIndex = 0` before each use.
- [ ] The renderer always handles `parsed.kind === 'fallback'` with a markdown render of `rawText`.
- [ ] Revision flows wrap the prior JSON in a recognisable XML tag (`<previous_journal>`, `<additional_comment>`, `<registration_request>`); the prompt enumerates the tags it understands.
- [ ] Re-sending revisions also re-sends `inputFileRefs[]` so the LLM can re-read source attachments.
- [ ] Scenario-append files are explicitly outside `npm run init` (they go through the d6e chat UI, not `/api/workspace-prompt-rules`).
- [ ] Scenario-append guardrails forbid `d6e_delete_workspace_prompt_rule` and any rewrite of the existing scenarios.
- [ ] Placeholder substitution (`{{company_id}}`, etc.) is verified before write — the activation flow asserts no `{{` remains in the final body.

## Best Practices

### Prompt authoring

- **Show, don't tell** — include a complete JSON example for every
  scenario that requires a fence. The model is much better at
  matching shape than at deriving it from prose.
- **Two adjacent scenarios should agree on fence-or-no-fence** — if
  Scenario A emits JSON and Scenario C must not, say so _both_ in
  Scenario A's spec ("always emit") and in Scenario C's spec ("never
  emit"). Belt-and-braces redundancy here pays for itself.
- **Use XML tags only for revision context, not for new content** —
  if a tag is used in both meanings, the classifier cannot tell
  apart "user is revising" from "user is asking a question that
  happens to mention `<previous_journal>`". Pick distinct tag names
  per flow.
- **Keep the prompt under 50,000 characters** — that's the
  `/api/workspace-prompt-rules` cap. The example app's full prompt
  sits at a few thousand characters; cut prose, not examples.

### Schema design

- **`z.literal('...')` for every `kind`** — `z.string()` followed by
  a manual switch lets typos slip through.
- **Salvage rather than reject** — use `.nullish().transform()` to
  default arrays to `[]` and malformed URLs to `null`. A partially
  populated card is much more useful than a fallback.
- **Accept polymorphic IDs** — use `z.union([z.number(), z.string()])`
  for IDs that the LLM might emit as strings to dodge JS number
  precision.
- **Do not regex-enforce dates** — receipts are messy, dates are
  best displayed as the LLM extracted them.

### Render layer

- **Always render `rawText` in the fallback branch** — never just
  show "an error occurred". The user often needs to see what the
  model said.
- **Surface the `reason` and `detail`** from the fallback variant so
  developers can fix the prompt or schema. They can be small, but
  must be visible.
- **Provide a "Raw AI response" disclosure** even on successful
  parse — debugging gets dramatically easier when the operator can
  inspect what the model said without devtools.

### Operations

- **One source of truth per prompt** — `scripts/prompts/<name>.md`.
  Track edits in git; never edit the rule in the d6e admin UI on a
  workspace that `npm run init` targets.
- **Hash-check on register** — see the
  [`d6e-workspace-api-client`](../d6e-workspace-api-client/SKILL.md)
  skill for the SHA-256 idempotency pattern.
- **Scenario append files belong in `scripts/prompts/` too** — even
  though they aren't auto-registered, keep them next to the base
  prompt so reviewers can see both halves of the contract together.

## Troubleshooting

### "schema mismatch" on every response

Open the dev console and look for `[parse-journal] schema mismatch: <issue path>: <message>`.
Common culprits:

- `amount` returned as a string — add an example in the prompt that
  shows an integer (no quotes).
- `entries: []` — the model failed to OCR the receipt. The schema
  requires non-empty entries so this falls through to fallback.
  Tighten the prompt or accept that low-quality images need fallback
  rendering.
- Missing `description` — the prompt says "concise Japanese for the
  freee 摘要 column" but the model is dropping the field. Add it to
  the example payload explicitly.

### Model outputs a table instead of JSON

Add a strong "Do not output tables or bullet lists for journal data"
sentence near the scenario A spec. Models tend to default to tables
for tabular data unless explicitly told not to.

### Multiple JSON blocks per response

The parser takes the **first** valid one, which is usually correct.
If the model is appending an "example" block at the end, instruct it
explicitly: "Emit exactly one ` ```json ` block per response.
Do not include example blocks."

### Scenario C is leaking JSON fences

The prompt isn't emphatic enough. Add: "Do not output any
` ```json ` code block in Scenario C; this is required so the
frontend does not misinterpret your reply as a journal." Repeat the
prohibition in the共通ルール section.

### Revision turn ignores `<previous_journal>` content

The model is treating the tag as decorative. Promote it: in the
prompt, say "When `<previous_journal>...</previous_journal>` is
present, parse the JSON inside it and use it as the baseline. Modify
only the fields the user mentioned; return the full updated JSON."

### Scenario-append run inserted the section twice

The idempotency check failed. Confirm the activation prompt
explicitly searches for the new section's heading (e.g.
`### シナリオ D`) **before** computing the rest of the work. If the
heading is found, the activation must bail out and report to the
user — not silently re-insert.

### Activation left `{{company_id}}` literally in the rule

The substitution loop missed a placeholder. The activation prompt
should assert "no `{{` remains in the final string" as a post-condition
before calling `d6e_update_workspace_prompt_rule`.

### `npm run init` keeps creating duplicate rules

Someone hand-edited the rule in the d6e admin UI. The SHA-256 hashes
no longer match, so the script POSTs a fresh copy. Resolve by
deleting the orphan via the admin UI, then re-run `npm run init`.

## Related Skills

- [`d6e-workspace-api-client`](../d6e-workspace-api-client/SKILL.md) — Provides `execute-by-intent` and the idempotent prompt-rule registration that this skill's prompts ride on.
- [`d6e-auth-integration`](../d6e-auth-integration/SKILL.md) — Authenticates the `execute-by-intent` calls that ferry these prompts to the LLM.
