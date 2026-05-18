// POST /api/intent — server-side proxy that forwards a natural-language
// task to d6e's /api/workflows/execute-by-intent endpoint AND persists
// the turn into a d6e chat_session row so the AI Journal page and the
// Completed Tasks page can list it.
//
// The workspace id is injected from environment variables, so the client
// never has to know it. File references uploaded via /api/upload are passed
// through unchanged.
//
// Persistence model:
//   - On a fresh turn (no chatSessionId): create a new chat_session row
//     after execute-by-intent succeeds, with `title` derived from the
//     parsed journal payload (or the user message, on parse failure).
//     The "[keiri] " or "[keiri-ask] " prefix is chosen by `persistAs`.
//   - On a revise turn (chatSessionId present): fetch the existing row,
//     append a user UIMessage + an assistant UIMessage, then PATCH the
//     whole array. The title is preserved.
//
// Persistence failures are isolated from the LLM response: we still
// return success / message / files to the browser even if the
// chat_session write blew up, and we log the failure server-side. That
// avoids a situation where the receipt was OCR'd successfully but the
// UX explodes because of a transient DB error.
//
// Failure semantics for execute-by-intent itself remain unchanged:
//   - 504: upstream timed out (the workflow may still be running on d6e).
//   - 499: the browser navigated away / aborted the fetch.
//   - other 4xx/5xx: bubbled up from d6e's response.
//
// Cleanup policy:
//   This handler does NOT delete inputFileRefs on failure. In the
//   multi-file upload flow, the client uploads files independently
//   into a user-visible queue before pressing "Generate journal", so
//   the client still holds those fileIds and expects to retry against
//   the same files. The queue owns the lifecycle: users remove files
//   via DELETE /api/upload/{fileId}, which is the only path that
//   should delete storage records.

import { json } from '@sveltejs/kit';

import {
	buildAskTitle,
	buildJournalTitle,
	isCompletedTitle,
	isJournalTitle,
	markCompletedTitle
} from '$lib/journal-title';
import { parseJournalMessage } from '$lib/parse-journal';
import {
	createChatSession,
	D6eClientError,
	executeByIntent,
	getChatSessionById,
	updateChatSession,
	type ChatSessionMessage,
	type IntentInputFileRef,
	type IntentResponse
} from '$lib/server/d6e-client';
import { getD6eWorkspaceId } from '$lib/server/env';
import { requireAccessToken } from '$lib/server/session';

import type { RequestHandler } from './$types';

interface IntentRequestBody {
	message?: unknown;
	inputFileRefs?: unknown;
	chatSessionId?: unknown;
	persistAs?: unknown;
}

type PersistKind = 'journal' | 'ask';

function validateInputFileRefs(value: unknown): IntentInputFileRef[] | string {
	if (value == null) return [];
	if (!Array.isArray(value)) return 'inputFileRefs must be an array';
	const refs: IntentInputFileRef[] = [];
	for (let i = 0; i < value.length; i += 1) {
		const ref = value[i];
		if (!ref || typeof ref !== 'object') {
			return `inputFileRefs[${i}] must be an object`;
		}
		const { fileId, filename, mimeType, sizeBytes } = ref as Record<string, unknown>;
		if (typeof fileId !== 'string' || fileId.length === 0) {
			return `inputFileRefs[${i}].fileId must be a non-empty string`;
		}
		if (typeof filename !== 'string' || filename.length === 0) {
			return `inputFileRefs[${i}].filename must be a non-empty string`;
		}
		if (typeof mimeType !== 'string' || mimeType.length === 0) {
			return `inputFileRefs[${i}].mimeType must be a non-empty string`;
		}
		if (typeof sizeBytes !== 'number' || !Number.isFinite(sizeBytes) || sizeBytes < 0) {
			return `inputFileRefs[${i}].sizeBytes must be a non-negative number`;
		}
		refs.push({ fileId, filename, mimeType, sizeBytes });
	}
	return refs;
}

function validatePersistAs(value: unknown): PersistKind | string {
	if (value == null) return 'journal';
	if (value === 'journal' || value === 'ask') return value;
	return 'persistAs must be "journal" or "ask" when provided';
}

// crypto.randomUUID is available in both Node 20+ and modern browsers,
// and SvelteKit server handlers run on Node. Wrap it so callers can
// stay synchronous and we only have one UUID source to swap if needed.
function makeUuid(): string {
	return crypto.randomUUID();
}

function buildUserUiMessage(message: string): ChatSessionMessage {
	return {
		id: makeUuid(),
		role: 'user',
		parts: [{ type: 'text', text: message }]
	};
}

function buildAssistantUiMessage(text: string): ChatSessionMessage {
	return {
		id: makeUuid(),
		role: 'assistant',
		parts: [{ type: 'text', text }]
	};
}

/**
 * Persist a freshly completed intent turn to chat_session.
 *
 * Failures are caught locally so the calling route handler can still
 * return the LLM response to the browser. We log the failure and the
 * chat_session id (when one already existed) so it can be reconciled
 * by hand if necessary.
 */
async function persistTurn(args: {
	callerTag: string;
	accessToken: string;
	workspaceId: string;
	userMessage: string;
	assistantText: string;
	chatSessionId: string | undefined;
	persistAs: PersistKind;
}): Promise<{ chatSessionId: string | undefined; persistError?: string }> {
	const {
		callerTag,
		accessToken,
		workspaceId,
		userMessage,
		assistantText,
		chatSessionId,
		persistAs
	} = args;

	const userUiMessage = buildUserUiMessage(userMessage);
	const assistantUiMessage = buildAssistantUiMessage(assistantText);

	if (chatSessionId) {
		try {
			const existing = await getChatSessionById(callerTag, accessToken, chatSessionId);
			const messages: ChatSessionMessage[] = [
				...(Array.isArray(existing.messages) ? existing.messages : []),
				userUiMessage,
				assistantUiMessage
			];

			const patch: { title?: string; messages: ChatSessionMessage[] } = { messages };

			// Regenerate the title from the new assistant text so the card's
			// "{date} ¥{total} (N件)" stays in sync with the latest journal.
			// Without this, a revise turn that changes entry count / amount
			// would leave the stored title pointing at the original values
			// while task_card_summary (re-parsed from the new message) shows
			// the updated ones, producing a visible contradiction. /ask
			// sessions and any third-party (non-[keiri]) sessions keep
			// their original title.
			const existingTitle = existing.title ?? '';
			if (persistAs === 'journal' && isJournalTitle(existingTitle)) {
				const parsed = parseJournalMessage(assistantText);
				if (parsed.kind === 'journal' && parsed.result.entries.length > 0) {
					let regenerated = buildJournalTitle(parsed, userMessage);
					if (isCompletedTitle(existingTitle)) {
						regenerated = markCompletedTitle(regenerated);
					}
					if (regenerated !== existingTitle) {
						patch.title = regenerated;
					}
				}
			}

			await updateChatSession(callerTag, accessToken, chatSessionId, patch);
			return { chatSessionId };
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			console.error(
				`[${callerTag}] chat-session append failed sessionId=${chatSessionId} persistAs=${persistAs}: ${msg}`
			);
			return { chatSessionId, persistError: msg };
		}
	}

	// New session: derive title from the parsed journal payload (or the
	// question text in the /ask case).
	let title: string;
	if (persistAs === 'ask') {
		title = buildAskTitle(userMessage);
	} else {
		const parsed = parseJournalMessage(assistantText);
		title = buildJournalTitle(parsed, userMessage);
	}

	try {
		const created = await createChatSession(callerTag, accessToken, {
			workspaceId,
			title,
			messages: [userUiMessage, assistantUiMessage]
		});
		return { chatSessionId: created.id };
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		console.error(
			`[${callerTag}] chat-session create failed persistAs=${persistAs} title="${title}": ${msg}`
		);
		return { chatSessionId: undefined, persistError: msg };
	}
}

export const POST: RequestHandler = async (event) => {
	const callerTag = '/api/intent';
	const accessToken = requireAccessToken(event, callerTag);
	const request = event.request;

	let body: IntentRequestBody;
	try {
		body = (await request.json()) as IntentRequestBody;
	} catch {
		return json({ error: 'Request body must be valid JSON' }, { status: 400 });
	}

	if (typeof body.message !== 'string' || body.message.trim().length === 0) {
		return json({ error: 'Field "message" must be a non-empty string' }, { status: 400 });
	}

	const refsOrError = validateInputFileRefs(body.inputFileRefs);
	if (typeof refsOrError === 'string') {
		return json({ error: refsOrError }, { status: 400 });
	}
	const inputFileRefs = refsOrError;

	let chatSessionId: string | undefined;
	if (body.chatSessionId !== undefined && body.chatSessionId !== null) {
		if (typeof body.chatSessionId !== 'string' || body.chatSessionId.length === 0) {
			return json({ error: 'Field "chatSessionId" must be a non-empty string' }, { status: 400 });
		}
		chatSessionId = body.chatSessionId;
	}

	const persistKindOrError = validatePersistAs(body.persistAs);
	if (persistKindOrError !== 'journal' && persistKindOrError !== 'ask') {
		// validatePersistAs returns either 'journal' / 'ask' or an error
		// message string explaining what was wrong.
		return json({ error: persistKindOrError }, { status: 400 });
	}
	const persistAs: PersistKind = persistKindOrError;

	try {
		const upstream = await executeByIntent(
			callerTag,
			accessToken,
			{ message: body.message, inputFileRefs },
			{ signal: request.signal }
		);

		// Persist whether or not the LLM call returned success=true. A
		// failed-but-200 response (e.g. policy blocked) is still part of
		// the conversation history; the title will just contain the
		// fallback prefix because parse-journal will not find any JSON.
		const workspaceId = getD6eWorkspaceId(callerTag);
		const persistResult = await persistTurn({
			callerTag,
			accessToken,
			workspaceId,
			userMessage: body.message,
			assistantText: upstream.message ?? '',
			chatSessionId,
			persistAs
		});

		const response: IntentResponse & {
			chatSessionId?: string;
			persistError?: string;
		} = {
			...upstream
		};
		if (persistResult.chatSessionId) response.chatSessionId = persistResult.chatSessionId;
		if (persistResult.persistError) response.persistError = persistResult.persistError;

		return json(response);
	} catch (err) {
		if (err instanceof D6eClientError) {
			return json(
				{
					error: err.message,
					timedOut: err.timedOut || undefined,
					aborted: err.aborted || undefined
				},
				{ status: err.status }
			);
		}
		const msg = err instanceof Error ? err.message : String(err);
		console.error(`[${callerTag}] Unexpected error: ${msg}`);
		return json({ error: msg }, { status: 500 });
	}
};
