// Derives display-ready summaries of journal sessions from raw d6e
// chat_session rows.
//
// The chat_session row stores `messages` as a jsonb array that may be
// either:
//   - AI SDK UIMessage[] shape: each entry has `role` + `parts: [{ type:
//     'text', text }]` (this is what we persist in /api/intent).
//   - Legacy Message[] shape: each entry has `role` + `content` (string).
//     This is what older rows produced by other d6e surfaces look like;
//     d6e's web UI converts them on the fly via oldMessagesToUIMessages.
//
// extractAssistantText walks both shapes so the example app can render
// rows that originated elsewhere without crashing. parse-journal is
// re-run here so the task card can show the same "(N件)" / "¥total"
// summary that the JournalResult table renders.

import type { JournalResult } from './journal-schema';
import { COMPLETED_SUFFIX, isCompletedTitle, isJournalTitle, KEIRI_PREFIX } from './journal-title';
import { parseJournalMessage, type ParseResult } from './parse-journal';
import type { ChatSessionMessage, ChatSessionRow, IntentInputFileRef } from './server/d6e-client';
import { isUploadedFileView } from './upload-types';

/**
 * Shared shape returned by the SSR loaders for the AI Journal page and
 * the Completed Tasks page. Both pages fetch the same chat_session
 * rows; filtering happens on the client via filterJournalSessions().
 */
export interface TasksFetchResult {
	ok: boolean;
	rows: ChatSessionRow[];
	error?: string;
}

export interface JournalTaskSummary {
	id: string;
	title: string;
	updatedAt: string;
	isCompleted: boolean;
	/**
	 * Title with the [keiri] prefix and " #completed" suffix removed so
	 * the UI can display it as plain user-facing text without leaking
	 * the internal status convention.
	 */
	displayTitle: string;
	/**
	 * Parsed journal payload from the last assistant message, when the
	 * LLM emitted a valid JSON code block. Null when no valid journal
	 * JSON could be recovered (e.g. /ask-style markdown only, or a
	 * conversation that has not received an assistant reply yet).
	 */
	journal: JournalResult | null;
	/**
	 * Raw assistant text used for the parse attempt. Kept around so the
	 * detail dialog can pass it to <JournalResult parsed={...} /> for the
	 * fallback rendering branch.
	 */
	rawAssistantText: string;
	parseResult: ParseResult | null;
	/**
	 * Receipt files that the most recent user turn referenced via
	 * inputFileRefs. Used when re-entering the AI Journal page via
	 * ?chatSessionId=<uuid> so the upload list can be re-hydrated with
	 * exactly the files that produced the current journal. Empty when
	 * no user turn carried an inputFileRefs snapshot (e.g. legacy rows
	 * persisted before this field was introduced).
	 */
	uploadedRefs: IntentInputFileRef[];
}

interface FilterJournalSessionsOptions {
	completed: boolean;
}

/**
 * Reduce a chat_session row's `messages` jsonb into the most recent
 * assistant text. Returns the empty string when no assistant turn has
 * been recorded yet — the caller treats that as "parse failed" and the
 * card just shows the title.
 */
function extractLatestAssistantText(messages: ChatSessionMessage[] | undefined): string {
	if (!Array.isArray(messages) || messages.length === 0) return '';
	for (let i = messages.length - 1; i >= 0; i -= 1) {
		const msg = messages[i];
		if (!msg || typeof msg !== 'object') continue;
		if (msg.role !== 'assistant') continue;

		// UIMessage shape: { role, parts: [{ type: 'text', text }] }
		const parts = msg.parts;
		if (Array.isArray(parts)) {
			const buf: string[] = [];
			for (const part of parts) {
				if (!part || typeof part !== 'object') continue;
				const rec = part as Record<string, unknown>;
				if (rec.type === 'text' && typeof rec.text === 'string') {
					buf.push(rec.text);
				}
			}
			if (buf.length > 0) return buf.join('\n');
		}

		// Legacy Message shape: { role, content: string }
		if (typeof msg.content === 'string') {
			return msg.content;
		}
	}
	return '';
}

function stripTitlePrefix(title: string): string {
	let body = title;
	if (body.startsWith(KEIRI_PREFIX)) body = body.slice(KEIRI_PREFIX.length);
	if (body.endsWith(COMPLETED_SUFFIX)) {
		body = body.slice(0, body.length - COMPLETED_SUFFIX.length);
	}
	return body.trim();
}

/**
 * Walk a chat_session row's messages from newest to oldest and return
 * the inputFileRefs array carried by the most recent user UIMessage.
 * /api/intent embeds this snapshot when persisting a turn so the AI
 * Journal page can rehydrate `uploadedRefs` from `?chatSessionId=...`.
 *
 * The function only inspects `role: 'user'` messages. Legacy rows that
 * do not carry the field are returned as an empty array; the caller
 * treats that as "no receipts to restore" and the page renders an
 * empty read-only list (the user can still send follow-up comments).
 */
export function extractLatestInputFileRefs(
	messages: ChatSessionMessage[] | undefined
): IntentInputFileRef[] {
	if (!Array.isArray(messages) || messages.length === 0) return [];
	for (let i = messages.length - 1; i >= 0; i -= 1) {
		const msg = messages[i];
		if (!msg || typeof msg !== 'object') continue;
		if ((msg as Record<string, unknown>).role !== 'user') continue;

		const refsRaw = (msg as Record<string, unknown>).inputFileRefs;
		if (!Array.isArray(refsRaw) || refsRaw.length === 0) continue;

		const refs: IntentInputFileRef[] = [];
		for (const entry of refsRaw) {
			if (isUploadedFileView(entry)) {
				refs.push({
					fileId: entry.fileId,
					filename: entry.filename,
					mimeType: entry.mimeType,
					sizeBytes: entry.sizeBytes
				});
			}
		}
		if (refs.length > 0) return refs;
	}
	return [];
}

export function deriveJournalTaskSummary(row: ChatSessionRow): JournalTaskSummary {
	const title = row.title ?? '';
	const rawAssistantText = extractLatestAssistantText(row.messages);
	const parseResult = rawAssistantText ? parseJournalMessage(rawAssistantText) : null;
	const journal = parseResult && parseResult.kind === 'journal' ? parseResult.result : null;
	const uploadedRefs = extractLatestInputFileRefs(row.messages);

	return {
		id: row.id,
		title,
		displayTitle: stripTitlePrefix(title),
		updatedAt: row.updatedAt,
		isCompleted: isCompletedTitle(title),
		journal,
		rawAssistantText,
		parseResult,
		uploadedRefs
	};
}

/**
 * Filter chat_session rows down to journal sessions for either the
 * pending or the completed view. Non-journal rows (no [keiri] prefix)
 * are dropped here so /ask sessions and any d6e-web sessions are not
 * leaked into either page.
 */
export function filterJournalSessions(
	rows: ChatSessionRow[],
	options: FilterJournalSessionsOptions
): JournalTaskSummary[] {
	const summaries: JournalTaskSummary[] = [];
	for (const row of rows) {
		if (!isJournalTitle(row.title)) continue;
		const completed = isCompletedTitle(row.title);
		if (completed !== options.completed) continue;
		summaries.push(deriveJournalTaskSummary(row));
	}
	// Most recent activity first. d6e returns rows in updatedAt desc
	// already, but we re-sort defensively so future ordering bugs in
	// either side cannot scramble the task list.
	summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
	return summaries;
}

/**
 * Sum the entry amounts inside a journal payload. Returned as a number
 * so the UI can format it with formatJpyAmount(). Returns null when no
 * journal is available so the card can render "—" rather than ¥0.
 */
export function totalJournalAmount(summary: JournalTaskSummary): number | null {
	if (!summary.journal) return null;
	return summary.journal.entries.reduce((sum, entry) => sum + entry.amount, 0);
}

/**
 * Resolved shape consumed by the `{#await}` blocks on the AI Journal
 * and Completed Tasks pages. Folding the fetch result + filter step
 * into one shared helper keeps the two pages from drifting apart.
 */
export type FilteredTasksResult =
	| { ok: true; tasks: JournalTaskSummary[] }
	| { ok: false; tasks: JournalTaskSummary[]; error?: string };

/**
 * Apply the pending / completed filter to a TasksFetchResult and shape
 * it for the `{#await}` consumer. Shared by both task-list pages so
 * the filter contract stays in one place.
 */
export function toFilteredTasks(
	result: TasksFetchResult,
	options: FilterJournalSessionsOptions
): FilteredTasksResult {
	if (!result.ok) {
		return { ok: false, tasks: [], error: result.error };
	}
	return { ok: true, tasks: filterJournalSessions(result.rows, options) };
}

/**
 * Locate the freshest version of a previously-opened task summary
 * inside a TasksFetchResult, re-deriving it from the matching row.
 * Returns null when the row is gone (e.g. deleted in another tab) or
 * the fetch itself failed. Shared by both task-list pages so the
 * dialog-sync effect stays in lockstep.
 */
export function findFreshTaskSummary(
	result: TasksFetchResult,
	currentId: string
): JournalTaskSummary | null {
	if (!result.ok) return null;
	const match = result.rows.find((row) => row.id === currentId);
	return match ? deriveJournalTaskSummary(match) : null;
}
