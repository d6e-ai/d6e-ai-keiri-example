# LLM output contract

`execute-by-intent` returns a free-form `message` string from the LLM.
We force that string into a predictable structure by:

1. Telling the LLM, via the workspace prompt rule, exactly which shape
   to produce.
2. Parsing the response on the client with a strict Zod schema.
3. Falling back to a raw-text view if the model deviates.

This document describes those three layers and what to do if the LLM
drifts off-contract.

## Scenarios

The prompt classifies every turn into one of four buckets. All four are
ultimately served by **the same single workspace prompt rule** — the one
registered by `npm run init` from
[`scripts/prompts/ai-keiri-prompt.md`](../scripts/prompts/ai-keiri-prompt.md).

- Scenarios A / B / C ship out of the box with that rule.
- Scenario D is **optional** and is appended to the same rule on demand
  by pasting [`scripts/prompts/freee-registration-prompt.md`](../scripts/prompts/freee-registration-prompt.md)
  into the d6e chat UI. The d6e AI:
  - calls `d6e_list_saas_credentials` to confirm both freee and
    google_workspace are connected,
  - calls `d6e_call_external_api` against freee (`GET /api/1/companies`)
    and Google Drive (`GET /drive/v3/files` for root folders) so it can
    ask the user **which company and which Drive folder** to use,
  - substitutes those confirmed values into Scenario D's template
    (`{{company_id}}`, `{{drive_folder_id}}`, …), then
  - uses `d6e_list_workspace_prompt_rules` /
    `d6e_update_workspace_prompt_rule` to append the now-concrete
    Scenario D body to the existing rule's `content`.
  See [Scenario D activation](#scenario-d-activation-optional) below.

Before scenario D is appended the registration button still renders, but
pressing it produces a `fallback` parse (the LLM does not know the
`<registration_request>` tag yet) — that is expected.

| Scenario | Trigger                                                                                                                                              | Required output                                                       |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| A        | Message contains an attached image and **no** `<previous_journal>` / `<registration_request>` / `<additional_comment>` tag.                          | 1–2 sentence intro + ` ```json``` ` block with `kind: "journal"`     |
| B        | Message contains a `<previous_journal>...</previous_journal>` tag (regardless of attachments).                                                       | 1-sentence intro + ` ```json``` ` block with `kind: "journal"`       |
| C        | No image, no `<previous_journal>` / `<registration_request>` / `<additional_comment>`.                                                               | Plain Japanese markdown. **No json fence.**                           |
| D        | Message contains `<registration_request>` (new registration), **or** prior assistant turn was `kind: "registration"` and message has `<additional_comment>`. | 1-sentence intro + ` ```json``` ` block with `kind: "registration"` |

Why this split? The AI Journal page parses every assistant response with
`parseAssistantMessage()`. If the model emits a JSON fence on a general
question (Scenario C), the parser will happily turn it into a card,
which is confusing. Scenario C explicitly forbids the fence so the UI
falls back to plain text rendering on `/ask`.

## JSON schemas

Authoritative definitions: [`src/lib/journal-schema.ts`](../src/lib/journal-schema.ts).

### `kind: "journal"` (Scenarios A / B)

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

Constraints (enforced by Zod):

- `kind` MUST be the literal `"journal"`.
- `entries` must be a non-empty array.
- `date`, `debit_account`, `credit_account`, `description` are non-empty
  strings.
- `amount` is a non-negative integer (JPY, no decimals).
- `tax_amount` is an optional non-negative integer.
- `warnings` defaults to `[]` when omitted.

### `kind: "registration"` (Scenario D)

```json
{
	"kind": "registration",
	"status": "success",
	"freee": {
		"company_id": 1234,
		"deals": [
			{
				"deal_id": 987654,
				"date": "2026-04-30",
				"amount": 1280,
				"description": "コンビニ事務用品"
			}
		]
	},
	"drive": {
		"uploads": [
			{
				"file_id": "1A2B3C...",
				"name": "receipt-2026-04-30.jpg",
				"web_view_link": "https://drive.google.com/file/d/1A2B3C.../view"
			}
		]
	},
	"warnings": [],
	"follow_up_question": null
}
```

Constraints (enforced by Zod):

- `kind` MUST be the literal `"registration"`.
- `status` is one of `"success"`, `"partial"`, `"failed"`, `"needs_input"`.
- `freee` / `drive` may be `null` when the corresponding side never ran.
- `freee.deals[]` contains only deals that were actually created upstream
  (failed rows are reported via `warnings` instead).
- `drive.uploads[].web_view_link` may be `null` when the Drive API
  response omitted it.
- `follow_up_question` is `null` unless `status === "needs_input"`.

Things deliberately **not** enforced:

- The `date` format is not regex-checked. The LLM occasionally produces
  `推定: 2026-04-30` when the receipt is hard to read; we want to keep
  that information visible rather than throw it away.
- The set of allowed accounting codes is not enumerated. The prompt
  steers the model toward common Japanese accounts, but we accept any
  non-empty string so the user can refine via the revise form.

## Parse layer

`parseAssistantMessage(message)` returns one of three shapes:

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

`parseJournalMessage()` is kept as a thin backwards-compatible alias for
the same function so existing call sites continue to work.

Algorithm:

1. Iterate every fenced code block in the message (`` ```...``` ``).
2. Try `JSON.parse` on each block; skip on syntax error and warn.
3. Dispatch on `kind`: run the value through `JournalResultSchema` or
   `RegistrationResultSchema` as appropriate.
4. Return the first match. If none match, return a `fallback` result
   with the original text intact.

Every fall-through path logs a `[parse-journal] ...` message with the
specific reason so you can grep the dev console.

## Revision flow

Revisions happen via natural-language messages from the user, not by
editing the table in place. The AI Journal page composes the new
message based on the **current** assistant payload kind:

### Revising a journal table (Scenario B trigger)

```
前回生成した仕訳に対する修正依頼です。
<previous_journal>
{
	"kind": "journal",
	"entries": [...],
	"warnings": []
}
</previous_journal>

修正指示: <user's free-form text>

仕訳全体を再生成し、変更を反映した完全な JSON を返してください。
```

The same `inputFileRefs` is sent again so the LLM can re-read the
receipt image. The model returns an updated `kind: "journal"` block
that supersedes the prior one.

### Following up on a registration turn (Scenario D follow-up)

```
直前の freee 登録ターンへの追加コメントです。
<additional_comment>
<user's free-form text>
</additional_comment>

必要に応じて未完了の登録 / Drive アップロードを実行し、最新の状態を kind:"registration" JSON で返してください。
```

This is used to answer `follow_up_question` (e.g. "use company ID 1234")
or to add late instructions ("also put the file in folder 1ABC..."). The
LLM continues the registration conversation and returns an updated
`kind: "registration"` payload.

## Registration flow

The "freee に登録" button on the journal result card sends a fixed
message that triggers Scenario D:

```
下記の仕訳を freee に登録し、添付の領収書を Google Drive にアップロードしてください。
<registration_request>
{
	"kind": "journal",
	"entries": [...],
	"warnings": []
}
</registration_request>
```

The LLM is expected to:

1. Confirm freee / google_workspace are still connected
   (`d6e_list_saas_credentials`).
2. Use the **pre-confirmed** `company_id` and `drive_folder_id` baked
   into Scenario D at activation time (see
   [Scenario D activation](#scenario-d-activation-optional)). It only
   has to resolve `account_item_id` / `tax_code` against the freee API
   (`GET /api/1/account_items`, `GET /api/1/taxes/codes`) for the
   current company.
3. Create deals (`POST /api/1/deals`) using `type: "income"` when the
   journal's credit account is a revenue line (売上高, 雑収入, etc.)
   and `type: "expense"` otherwise.
4. Upload the receipt to Google Drive. Files land in
   `<pre-confirmed parent folder>/YYYY/MM/` — the LLM creates the
   `YYYY` and `MM` folders on demand using `GET /drive/v3/files` and
   `POST /drive/v3/files`, then performs the actual upload via
   `POST /upload/drive/v3/files?uploadType=multipart` with `file_id`.
   The `YYYY` / `MM` segments come from the smallest `entries[].date`
   in the journal.
5. Return a single `kind: "registration"` JSON block describing what
   actually happened (including a warning when a `YYYY` / `MM`
   sub-folder was freshly created so the user can see Drive structure
   changes).

Because the company/folder selection is no longer a runtime decision,
`status: "needs_input"` is rare in practice — the typical reason left is
an ambiguous account name in the current journal.

The receipt file ID is re-sent in `inputFileRefs` so the LLM has direct
access to the binary again (same mechanism that powers the original
journal generation).

## Scenario D activation (optional)

Scenario D is **not** registered by `npm run init`. The journal generation
flow (Scenarios A/B/C) works end-to-end without it. To turn on the
"freee に登録" button:

1. Open [`scripts/prompts/freee-registration-prompt.md`](../scripts/prompts/freee-registration-prompt.md) and copy the whole file.
2. Paste it into the d6e chat UI for the target workspace.
3. The d6e AI follows the embedded instructions and walks through these
   phases (the user only has to answer a couple of multiple-choice
   questions in the chat):
   1. **Locate the rule** — calls `d6e_list_workspace_prompt_rules`,
      finds the rule that already contains Scenarios A/B/C, and bails
      out idempotently if `### シナリオ D` is already present.
   2. **Health check** — calls `d6e_list_saas_credentials` and confirms
      both `freee` and `google_workspace` are `enabled`.
   3. **Discover freee company** — calls
      `d6e_call_external_api` → `GET /api/1/companies`. With one
      company it just asks for confirmation; with several it asks the
      user to pick one. The chosen `id` becomes the value bound to
      `{{company_id}}`.
   4. **Discover Drive folder** — calls
      `d6e_call_external_api` → `GET /drive/v3/files?q=...folder...` to
      list folders in My Drive's root, and offers the user (a) pick one
      of the listed folders, (b) save to My Drive root, or (c) create a
      new folder via `POST /drive/v3/files`. The chosen ID (or `null`
      for "root") becomes `{{drive_folder_id}}`.
   5. **Substitute & confirm** — fills in the placeholders
      (`{{company_id}}`, `{{company_name}}`, `{{drive_folder_id}}`,
      `{{drive_folder_name}}`, `{{generated_at}}`), shows the resulting
      Scenario D body to the user inside a code fence, and asks for a
      final OK.
   6. **Insert** — calls `d6e_update_workspace_prompt_rule` to write
      the existing content with Scenario D **inserted just before the
      `## 共通ルール` heading** (i.e. directly after Scenario C). This
      keeps A/B/C/D as a contiguous block of task scenarios and lets
      the shared rules below apply to all four. `sort_order` is left
      untouched. If the `## 共通ルール` heading cannot be located, the
      d6e AI falls back to appending Scenario D at the end of the
      content and warns the user.
4. From this point on, the registration button on the AI Journal page
   produces a `kind: "registration"` JSON payload that reuses the
   pre-confirmed company and Drive folder on every press, instead of
   asking the user again at runtime.

To change the bound values, either edit the rule directly from
`Settings > Workspace > Prompt rules` and adjust the `{{company_id}}` /
`{{drive_folder_id}}` lines, or delete the entire `### シナリオ D`
section and paste `freee-registration-prompt.md` again to redo the
discovery flow. The instruction sheet always performs an idempotency
check on the `### シナリオ D` heading, so re-pasting it without first
deleting the section is a no-op.

## Tuning checklist

If the model drifts off-contract, work through these in order:

1. **Did the prompt rule register correctly?**
   Visit the d6e frontend `Settings > Workspace > Prompt rules` and
   confirm a single rule whose body starts with the `# d6e AI 経理 -
   ワークスペースプロンプト` header is listed. Re-run `npm run init` if it
   is missing.
   - If you also need Scenario D, confirm the same rule's body ends with
     a `### シナリオ D: freee 仕訳登録 + Google Drive 領収書保存` section
     (added by the activation flow described above).

2. **Is the model emitting markdown around the JSON?**
   The fence regex tolerates leading/trailing prose, so a sentence or
   two before the block is fine. If the model emits a TABLE instead of
   JSON, add a more emphatic "Do not output tables or bullet lists for
   journal data" line to the prompt.

3. **Is the schema being violated?**
   Open the dev console and look for `[parse-journal] schema mismatch:`.
   The log lists each Zod issue with its JSON path. Common fixes:
   - `amount` returned as a string → add an example in the prompt that
     shows an integer.
   - Missing `description` → tighten the prompt around the description
     field's purpose.

4. **Is the model occasionally returning two JSON blocks?**
   The parser already takes the first valid one. If the model is
   adding an "example" block at the end, tell it explicitly: "Emit
   exactly one ` ```json ` block per response."

5. **Is the JSON empty / `entries: []`?**
   The schema requires `entries` to be non-empty, so this falls back
   to raw text. Usually means the model could not OCR the receipt.
   Add an example in the prompt that shows a single-entry response so
   the model knows the minimum shape.

## What is NOT in scope

- Editing the table in place (use a revision comment instead).
- Persisting prior turns across page reloads (the revision JSON lives
  in component state, although chat_session rows persist the dialogue).
- Calling d6e workflows or STFs from this app. The Scenario A/B/C prompt
  tells the LLM not to invoke tools because none are registered for
  this example. Scenario D explicitly allows `d6e_call_external_api`
  for freee / google_workspace API access — that is the entire point of
  the "freee に登録" button.
- Triggering "freee に登録" from the completed-task detail dialog. The
  fileRef needed to re-upload the receipt is not yet recovered from the
  chat_session row; tracked as a separate piece of work.

The full integration plan in
[`migration-to-full-integration.md`](./migration-to-full-integration.md)
covers the persistence side.
