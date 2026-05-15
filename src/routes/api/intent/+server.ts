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
//   When execute-by-intent fails with a *hard* error (non-success, not a
//   timeout and not an abort) and the request carried inputFileRefs, we
//   best-effort DELETE those storage records so the workspace does not
//   accumulate orphaned uploads. Timeouts deliberately leave the files
//   in place because the workflow may still be running and consuming
//   them (mirrors d6e-auth's SNS proxy behaviour).

import { json } from '@sveltejs/kit';

import { buildAskTitle, buildJournalTitle } from '$lib/journal-title';
import { parseJournalMessage } from '$lib/parse-journal';
import {
	createChatSession,
	D6eClientError,
	deleteFile,
	executeByIntent,
	getChatSessionById,
	updateChatSession,
	type ChatSessionMessage,
	type IntentInputFileRef,
	type IntentResponse
} from '$lib/server/d6e-client';
import { getD6eWorkspaceId } from '$lib/server/env';

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

async function bestEffortCleanup(callerTag: string, refs: IntentInputFileRef[]): Promise<void> {
	for (const ref of refs) {
		await deleteFile(callerTag, ref.fileId);
	}
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
	workspaceId: string;
	userMessage: string;
	assistantText: string;
	chatSessionId: string | undefined;
	persistAs: PersistKind;
}): Promise<{ chatSessionId: string | undefined; persistError?: string }> {
	const { callerTag, workspaceId, userMessage, assistantText, chatSessionId, persistAs } = args;

	const userUiMessage = buildUserUiMessage(userMessage);
	const assistantUiMessage = buildAssistantUiMessage(assistantText);

	if (chatSessionId) {
		try {
			const existing = await getChatSessionById(callerTag, chatSessionId);
			const messages: ChatSessionMessage[] = [
				...(Array.isArray(existing.messages) ? existing.messages : []),
				userUiMessage,
				assistantUiMessage
			];
			await updateChatSession(callerTag, chatSessionId, { messages });
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
		const created = await createChatSession(callerTag, {
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

export const POST: RequestHandler = async ({ request }) => {
	const callerTag = '/api/intent';

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
			if (!err.timedOut && !err.aborted && inputFileRefs.length > 0) {
				await bestEffortCleanup(callerTag, inputFileRefs);
			}
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
		if (inputFileRefs.length > 0) {
			await bestEffortCleanup(callerTag, inputFileRefs);
		}
		return json({ error: msg }, { status: 500 });
	}
};
