// Helpers that turn the assistant text returned by
// /api/workflows/execute-by-intent into a typed payload or, when the model
// fails to follow the contract, a markdown-fallback payload that the UI can
// still surface to the user.
//
// Supported assistant payload shapes (both delivered inside ```json``` fenced
// code blocks):
//   - `kind: "journal"`         (see scripts/prompts/ai-keiri-prompt.md)
//   - `kind: "registration"`    (see scripts/prompts/freee-registration-prompt.md)
//
// Key design points:
// - We scan every fenced JSON block in source order. The first block whose
//   `kind` field matches one of the known schemas wins. The LLM occasionally
//   appends a second "example" block when it gets verbose, so taking the
//   first match is empirically the most stable behaviour.
// - Parsing never throws. Anything off-contract is downgraded to a
//   `kind: 'fallback'` result so the AI journal page never goes blank.
// - The original assistant text is always returned alongside the parsed
//   result so the UI can show a "raw text" disclosure for debugging.
// - parseJournalMessage() is kept as a backwards-compatible wrapper that
//   delegates to parseAssistantMessage() so callers that already imported
//   it continue to work.

import {
	JournalResultSchema,
	RegistrationResultSchema,
	type JournalResult,
	type RegistrationResult
} from './journal-schema';

const JSON_FENCE_RE = /```(?:json)?\s*([\s\S]*?)```/gi;

export interface ParsedJournal {
	kind: 'journal';
	result: JournalResult;
	rawText: string;
}

export interface ParsedRegistration {
	kind: 'registration';
	result: RegistrationResult;
	rawText: string;
}

export interface ParsedFallback {
	kind: 'fallback';
	reason: 'no_code_block' | 'invalid_json' | 'schema_mismatch';
	detail: string;
	rawText: string;
}

export type ParseResult = ParsedJournal | ParsedRegistration | ParsedFallback;

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
 * Parse a single decoded JSON value against the known schemas, returning
 * either a typed payload or null if neither schema matches. The function
 * is intentionally narrow: it only dispatches on the `kind` discriminator
 * so an off-contract payload (kind missing, kind unknown) consistently
 * returns null and the caller can fall back to fallback rendering.
 */
function dispatchSchema(json: unknown, rawText: string): ParsedJournal | ParsedRegistration | null {
	if (!json || typeof json !== 'object') return null;
	const kind = (json as { kind?: unknown }).kind;

	if (kind === 'journal') {
		const parsed = JournalResultSchema.safeParse(json);
		if (parsed.success) {
			return { kind: 'journal', result: parsed.data, rawText };
		}
		console.warn(
			`[parse-journal] journal schema mismatch: ${parsed.error.issues
				.map((issue) => `${issue.path.join('.')}: ${issue.message}`)
				.join('; ')}`
		);
		return null;
	}

	if (kind === 'registration') {
		const parsed = RegistrationResultSchema.safeParse(json);
		if (parsed.success) {
			return { kind: 'registration', result: parsed.data, rawText };
		}
		console.warn(
			`[parse-journal] registration schema mismatch: ${parsed.error.issues
				.map((issue) => `${issue.path.join('.')}: ${issue.message}`)
				.join('; ')}`
		);
		return null;
	}

	return null;
}

/**
 * Parse the assistant message into a `kind: "journal"` or
 * `kind: "registration"` payload, or describe why neither matched. Errors
 * are logged with a `[parse-journal]` prefix per the project's
 * error-handling guidelines.
 *
 * Scanning rule: the FIRST fenced JSON block whose `kind` discriminator
 * matches a known schema wins. Subsequent blocks (even with valid kinds)
 * are ignored, mirroring the legacy single-schema behaviour.
 */
export function parseAssistantMessage(message: string): ParseResult {
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

	let sawValidJson = false;
	let lastJsonParseError = '';
	for (const block of blocks) {
		let json: unknown;
		try {
			json = JSON.parse(block);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			lastJsonParseError = msg;
			console.warn(`[parse-journal] JSON.parse failed: ${msg}`);
			continue;
		}
		sawValidJson = true;

		const dispatched = dispatchSchema(json, message);
		if (dispatched) return dispatched;
	}

	if (!sawValidJson) {
		return {
			kind: 'fallback',
			reason: 'invalid_json',
			detail: `A fenced code block was present but could not be parsed as JSON: ${lastJsonParseError}`,
			rawText: message
		};
	}

	return {
		kind: 'fallback',
		reason: 'schema_mismatch',
		detail:
			'A JSON code block was present but it did not match the journal or registration schema. Showing the raw assistant text instead.',
		rawText: message
	};
}

/**
 * Backwards-compatible wrapper that preserves the original
 * `parseJournalMessage()` name. Existing call sites (journal-task.ts,
 * +page.svelte, registration handlers) keep working without an import
 * rename; new code is encouraged to call parseAssistantMessage() directly.
 */
export function parseJournalMessage(message: string): ParseResult {
	return parseAssistantMessage(message);
}
