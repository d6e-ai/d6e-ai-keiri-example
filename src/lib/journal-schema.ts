// Zod schemas and TypeScript types for the LLM output contract.
//
// Two LLM output shapes are recognised, both delivered inside ```json``` fenced
// code blocks in the assistant message:
//
//   1. `kind: "journal"` — journal creation / revision turns.
//      Defined by scripts/prompts/ai-keiri-prompt.md (the 1st workspace
//      prompt rule). Rendered as a read-only table by JournalResult.
//   2. `kind: "registration"` — freee registration + Google Drive upload
//      turns. Defined by scripts/prompts/freee-registration-prompt.md
//      (the 2nd workspace prompt rule, registered manually in the d6e admin
//      UI). Rendered as a status card by RegistrationResult.
//
// Anything else is treated as an unstructured Scenario C response and falls
// back to raw markdown rendering. See docs/llm-output-contract.md for the
// full rationale and tradeoffs.
//
// Common constraints:
// - `kind` is the union discriminator and is required.
// - Monetary fields are integers (consumption tax in Japan is also tracked
//   as an integer JPY amount, no fractional yen).
// - `date` strings should follow ISO 8601 but the schema does NOT enforce
//   the format because the LLM occasionally emits a "ca." or "推定:" prefix
//   that we still want to surface.

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
		.transform((val) => val ?? [])
});

export type JournalEntry = z.infer<typeof JournalEntrySchema>;
export type JournalResult = z.infer<typeof JournalResultSchema>;

// The freee deal_id is documented as an integer by the freee API but we
// accept strings as well because some LLM responses emit very large IDs
// as strings to dodge JavaScript Number precision issues.
const FreeeIdSchema = z.union([z.number(), z.string()]);

export const RegistrationDealSchema = z.object({
	deal_id: FreeeIdSchema,
	date: z.string().min(1),
	amount: z.number().int().nonnegative(),
	description: z.string().min(1)
});

export const RegistrationFreeeBlockSchema = z.object({
	company_id: FreeeIdSchema.nullable(),
	deals: z
		.array(RegistrationDealSchema)
		.nullish()
		.transform((val) => val ?? [])
});

export const RegistrationDriveUploadSchema = z.object({
	file_id: z.string().min(1),
	name: z.string().min(1),
	// The Drive API normally returns webViewLink as an https URL but it is
	// optional in the API response, and the LLM may omit it (or leave the
	// key out entirely) when the fields= mask was not specified. Accept
	// both null and undefined, normalise to null, and reject non-URL strings.
	web_view_link: z
		.string()
		.url()
		.nullish()
		.transform((val) => val ?? null)
});

export const RegistrationDriveBlockSchema = z.object({
	uploads: z
		.array(RegistrationDriveUploadSchema)
		.nullish()
		.transform((val) => val ?? [])
});

export const RegistrationStatusSchema = z.enum(['success', 'partial', 'failed', 'needs_input']);

export const RegistrationResultSchema = z.object({
	kind: z.literal('registration'),
	status: RegistrationStatusSchema,
	freee: RegistrationFreeeBlockSchema.nullish().transform((val) => val ?? null),
	drive: RegistrationDriveBlockSchema.nullish().transform((val) => val ?? null),
	warnings: z
		.array(z.string())
		.nullish()
		.transform((val) => val ?? []),
	// Only populated when status === 'needs_input'. Schema-wise we still
	// allow it on other statuses (LLM may leak it through) but the UI only
	// renders it as a prominent box when status === 'needs_input'.
	follow_up_question: z
		.string()
		.nullish()
		.transform((val) => val ?? null)
});

export type RegistrationDeal = z.infer<typeof RegistrationDealSchema>;
export type RegistrationDriveUpload = z.infer<typeof RegistrationDriveUploadSchema>;
export type RegistrationStatus = z.infer<typeof RegistrationStatusSchema>;
export type RegistrationResult = z.infer<typeof RegistrationResultSchema>;
