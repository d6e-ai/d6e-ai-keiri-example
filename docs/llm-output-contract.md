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

The prompt classifies every turn into one of three buckets:

| Scenario | Trigger                                                                                        | Required output                                  |
| -------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| A        | Message contains an attached image and **no** `<previous_journal>` tag.                        | 1–2 sentence intro + ` ```json``` ` journal body |
| B        | Message contains a `<previous_journal>...</previous_journal>` tag (regardless of attachments). | 1-sentence intro + ` ```json``` ` journal body   |
| C        | No image, no `<previous_journal>`.                                                              | Plain Japanese markdown. **No json fence.**      |

Why this split? The AI Journal page parses every assistant response with
`parseJournalMessage()`. If the model emits a JSON fence on a general
question (Scenario C), the parser will happily turn it into a journal
table, which is confusing. Scenario C explicitly forbids the fence so
the UI falls back to plain text rendering on `/ask`.

## JSON schema

Authoritative definition: [`src/lib/journal-schema.ts`](../src/lib/journal-schema.ts).

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

- `kind` MUST be the literal `"journal"`. Anything else is treated as a
  schema mismatch and falls back to raw text.
- `entries` must be a non-empty array.
- `date`, `debit_account`, `credit_account`, `description` are non-empty
  strings.
- `amount` is a non-negative integer (JPY, no decimals).
- `tax_amount` is an optional non-negative integer.
- `warnings` defaults to `[]` when omitted.

Things deliberately **not** enforced:

- The `date` format is not regex-checked. The LLM occasionally produces
  `推定: 2026-04-30` when the receipt is hard to read; we want to keep
  that information visible rather than throw it away.
- The set of allowed accounting codes is not enumerated. The prompt
  steers the model toward common Japanese accounts, but we accept any
  non-empty string so the user can refine via the revise form.

## Parse layer

`parseJournalMessage(message)` returns one of two shapes:

```ts
type ParseResult =
	| { kind: 'journal'; result: JournalResult; rawText: string }
	| {
			kind: 'fallback';
			reason: 'no_code_block' | 'invalid_json' | 'schema_mismatch';
			detail: string;
			rawText: string;
	  };
```

Algorithm:

1. Iterate every fenced code block in the message (`` ```...``` ``).
2. Try `JSON.parse` on each block; skip on syntax error and warn.
3. Run the parsed value through `JournalResultSchema.safeParse`.
4. Return the first match. If none match, return a `fallback` result
   with the original text intact.

Every fall-through path logs a `[parse-journal] ...` message with the
specific reason so you can grep the dev console.

## Revision flow

Revisions happen via natural-language messages from the user, not by
editing the table in place. The AI Journal page composes the new
message like this:

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
receipt image. This triggers Scenario B in the prompt and the model
returns an updated JSON block that supersedes the prior one.

## Tuning checklist

If the model drifts off-contract, work through these in order:

1. **Did the prompt rule register correctly?**
   Visit the d6e frontend `Settings > Workspace > Prompt rules` and
   confirm the latest text from `scripts/prompts/ai-keiri-prompt.md` is
   listed. If not, re-run `npm run init`.

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
  in component state).
- Calling d6e workflows or STFs from this app. The prompt explicitly
  tells the LLM not to invoke tools because none are registered for
  this example.

The full integration plan in
[`migration-to-full-integration.md`](./migration-to-full-integration.md)
covers all three above.
