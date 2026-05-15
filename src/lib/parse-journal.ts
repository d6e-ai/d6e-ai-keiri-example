// Helpers that turn the assistant text returned by
// /api/workflows/execute-by-intent into a typed JournalResult or, when the
// model fails to follow the contract, a markdown-fallback payload that the
// UI can still surface to the user.
//
// Key design points:
// - We accept the FIRST valid `kind: "journal"` JSON code block and ignore
//   the rest. The LLM occasionally appends a second "example" block when
//   it gets verbose; taking the first match is empirically the most stable
//   behaviour.
// - Parsing never throws. Anything off-contract is downgraded to a
//   `kind: 'fallback'` result so the AI journal page never goes blank.
// - The original assistant text is always returned alongside the parsed
//   result so the UI can show a "raw text" disclosure for debugging.

import { JournalResultSchema, type JournalResult } from './journal-schema';

const JSON_FENCE_RE = /```(?:json)?\s*([\s\S]*?)```/gi;

export interface ParsedJournal {
	kind: 'journal';
	result: JournalResult;
	rawText: string;
}

export interface ParsedFallback {
	kind: 'fallback';
	reason: 'no_code_block' | 'invalid_json' | 'schema_mismatch';
	detail: string;
	rawText: string;
}

export type ParseResult = ParsedJournal | ParsedFallback;

/**
 * Extract every fenced JSON code block from the assistant message and
 * return them in source order. Markers like ```json``` and bare ```...```
 * are both accepted because some models drop the language tag.
 */
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

/**
 * Parse the assistant message into a JournalResult, or describe why we
 * couldn't. Errors are logged with a `[parse-journal]` prefix per the
 * project's error-handling guidelines.
 */
export function parseJournalMessage(message: string): ParseResult {
	const blocks = extractJsonBlocks(message);
	if (blocks.length === 0) {
		console.warn('[parse-journal] no code block found in assistant message');
		return {
			kind: 'fallback',
			reason: 'no_code_block',
			detail: 'Assistant response did not contain a fenced JSON code block.',
			rawText: message
		};
	}

	for (const block of blocks) {
		let json: unknown;
		try {
			json = JSON.parse(block);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			console.warn(`[parse-journal] JSON.parse failed: ${msg}`);
			continue;
		}

		const parsed = JournalResultSchema.safeParse(json);
		if (parsed.success) {
			return { kind: 'journal', result: parsed.data, rawText: message };
		}
		console.warn(
			`[parse-journal] schema mismatch: ${parsed.error.issues
				.map((issue) => `${issue.path.join('.')}: ${issue.message}`)
				.join('; ')}`
		);
	}

	return {
		kind: 'fallback',
		reason: 'schema_mismatch',
		detail:
			'A JSON code block was present but it did not match the journal schema. Showing the raw assistant text instead.',
		rawText: message
	};
}
