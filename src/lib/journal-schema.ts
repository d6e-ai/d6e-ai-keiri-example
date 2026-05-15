// Zod schemas and TypeScript types for the LLM output contract.
//
// The LLM is instructed (via the workspace prompt rule, see
// scripts/prompts/ai-keiri-prompt.md) to emit a JSON code block with the
// shape defined below. The frontend parses each ```json``` code block
// in the assistant message with these schemas and renders the result as
// a read-only table. See docs/llm-output-contract.md for the full
// rationale and chosen tradeoffs.
//
// Constraints baked into the schema:
// - `kind` is the discriminator. Only the literal "journal" is recognised
//   for journal-creation / journal-revision responses. Anything else is
//   treated as an unstructured (Scenario C) response.
// - All monetary fields are integers (consumption tax in Japan is also
//   tracked as an integer JPY amount, no fractional yen).
// - `date` is a free-form string but should follow ISO 8601 (YYYY-MM-DD).
//   The schema does NOT enforce the format because the LLM occasionally
//   emits a "ca." or "推定:" prefix that we still want to surface.

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
	warnings: z.array(z.string()).default([])
});

export type JournalEntry = z.infer<typeof JournalEntrySchema>;
export type JournalResult = z.infer<typeof JournalResultSchema>;
