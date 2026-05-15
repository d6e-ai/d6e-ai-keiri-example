// Title conventions for chat_session rows owned by this app.
//
// We piggyback on the existing chat_session.title column to express two
// pieces of metadata without modifying the d6e schema:
//
//   1. Which surface in this app owns the session.
//      - "[keiri] " prefix -> AI Journal session (POST /api/intent with a receipt
//        attached, or a revise turn).
//      - "[keiri-ask] " prefix -> general accounting question raised from /ask.
//      Sessions without either prefix are produced by other surfaces (e.g. the
//      d6e web chat UI) and are not displayed by this app.
//
//   2. Completion state for AI Journal sessions.
//      - " #completed" suffix -> the user has marked this journal as finished
//        from the task detail dialog. The same dialog can remove the suffix.
//
// Keeping the conventions in pure helpers (rather than inlining string
// manipulation across pages) means the prefix / suffix tokens are
// trivially discoverable from the type definitions when reading the code
// for the first time, and the rules can be unit-tested in isolation if
// we ever decide to add tests.

import type { ParseResult } from './parse-journal';

export const KEIRI_PREFIX = '[keiri] ';
export const ASK_PREFIX = '[keiri-ask] ';
export const COMPLETED_SUFFIX = ' #completed';

// Cap titles to this many characters AFTER the prefix is stripped.
// Long titles wrap awkwardly in both d6e's web UI and the task card.
const MAX_BODY_CHARS = 64;

function truncate(value: string, maxChars: number): string {
	const cleaned = value.replace(/\s+/g, ' ').trim();
	if (cleaned.length <= maxChars) return cleaned;
	return `${cleaned.slice(0, maxChars - 1).trimEnd()}…`;
}

function formatJpy(value: number): string {
	return value.toLocaleString('ja-JP');
}

/**
 * Build the title used when persisting a new AI Journal session.
 *
 * When parse-journal succeeded we produce "{date} ¥{total} (N件)" because
 * it conveys at a glance what is inside the session; otherwise we fall
 * back to the first chunk of the user message so the row is still
 * recognisable while debugging in the d6e UI.
 */
export function buildJournalTitle(parsed: ParseResult, fallbackMessage: string): string {
	if (parsed.kind === 'journal' && parsed.result.entries.length > 0) {
		const entries = parsed.result.entries;
		const total = entries.reduce((sum, entry) => sum + entry.amount, 0);
		const date = entries[0].date || '日付不明';
		const body = `${date} ¥${formatJpy(total)} (${entries.length}件)`;
		return `${KEIRI_PREFIX}${truncate(body, MAX_BODY_CHARS)}`;
	}
	const body = truncate(fallbackMessage, MAX_BODY_CHARS) || 'untitled';
	return `${KEIRI_PREFIX}${body}`;
}

/**
 * Build the title used when persisting a /ask question. The title is
 * intentionally derived from the question text so it can serve as a
 * cheap preview in case we add a history sidebar later. The trailing
 * "?" is kept where present because it helps the row read as a question
 * at a glance.
 */
export function buildAskTitle(question: string): string {
	const body = truncate(question, MAX_BODY_CHARS) || 'untitled question';
	return `${ASK_PREFIX}${body}`;
}

export function isJournalTitle(title: string | null | undefined): boolean {
	return typeof title === 'string' && title.startsWith(KEIRI_PREFIX);
}

export function isCompletedTitle(title: string | null | undefined): boolean {
	return typeof title === 'string' && title.endsWith(COMPLETED_SUFFIX);
}

/**
 * Append the completion suffix to a journal title. Idempotent: applying
 * it twice has no effect, which matters because the detail dialog may
 * re-issue the PATCH if the user double-clicks.
 */
export function markCompletedTitle(title: string): string {
	if (isCompletedTitle(title)) return title;
	return `${title}${COMPLETED_SUFFIX}`;
}

/**
 * Strip the completion suffix from a journal title. Idempotent in the
 * same way as markCompletedTitle.
 */
export function unmarkCompletedTitle(title: string): string {
	if (!isCompletedTitle(title)) return title;
	return title.slice(0, title.length - COMPLETED_SUFFIX.length);
}
