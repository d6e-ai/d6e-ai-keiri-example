// Server-side proxy for d6e's /api/chat-sessions list / create surface.
//
// Why proxy at all?
//   - The browser never sees the d6e OAuth access token. All requests
//     flow through this SvelteKit handler which adds the auth-token
//     cookie and pins workspaceId to D6E_WORKSPACE_ID. This keeps the
//     example app aligned with the same trust boundary d6e-auth uses
//     for its SNS bots: secrets stay on the server.
//   - Pinning workspaceId here means the client cannot accidentally (or
//     maliciously) request sessions from a different workspace; the
//     query string passed by the caller is intentionally ignored.
//
// Methods:
//   GET  -> list every chat_session row in the configured workspace.
//           Filtering by title prefix / completion suffix is done by
//           the caller (see src/lib/journal-task.ts), not here, so this
//           surface stays composable.
//   POST -> create a new chat_session row with a title and an initial
//           UIMessage[] array. workspaceId is injected.

import { json } from '@sveltejs/kit';

import {
	createChatSession,
	D6eClientError,
	listChatSessions,
	type ChatSessionMessage
} from '$lib/server/d6e-client';
import { getD6eWorkspaceId } from '$lib/server/env';

import type { RequestHandler } from './$types';

const CALLER_TAG = '/api/chat-sessions';

interface CreateChatSessionRequestBody {
	title?: unknown;
	messages?: unknown;
}

function validateCreateBody(
	body: CreateChatSessionRequestBody
): { title: string | null; messages: ChatSessionMessage[] } | string {
	let title: string | null = null;
	if (body.title !== undefined && body.title !== null) {
		if (typeof body.title !== 'string') {
			return 'Field "title" must be a string or null';
		}
		title = body.title;
	}

	let messages: ChatSessionMessage[] = [];
	if (body.messages !== undefined && body.messages !== null) {
		if (!Array.isArray(body.messages)) {
			return 'Field "messages" must be an array';
		}
		for (let i = 0; i < body.messages.length; i += 1) {
			const m = body.messages[i];
			if (!m || typeof m !== 'object' || Array.isArray(m)) {
				return `messages[${i}] must be an object`;
			}
		}
		messages = body.messages as ChatSessionMessage[];
	}

	return { title, messages };
}

export const GET: RequestHandler = async () => {
	const workspaceId = getD6eWorkspaceId(CALLER_TAG);
	try {
		const sessions = await listChatSessions(CALLER_TAG, workspaceId);
		return json(sessions);
	} catch (err) {
		if (err instanceof D6eClientError) {
			console.error(
				`[${CALLER_TAG}] GET failed: status=${err.status} timedOut=${err.timedOut} aborted=${err.aborted} message=${err.message}`
			);
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
		console.error(`[${CALLER_TAG}] GET unexpected error: ${msg}`);
		return json({ error: msg }, { status: 500 });
	}
};

export const POST: RequestHandler = async ({ request }) => {
	let raw: CreateChatSessionRequestBody;
	try {
		raw = (await request.json()) as CreateChatSessionRequestBody;
	} catch {
		return json({ error: 'Request body must be valid JSON' }, { status: 400 });
	}

	const parsed = validateCreateBody(raw);
	if (typeof parsed === 'string') {
		return json({ error: parsed }, { status: 400 });
	}

	const workspaceId = getD6eWorkspaceId(CALLER_TAG);
	try {
		const row = await createChatSession(CALLER_TAG, {
			workspaceId,
			title: parsed.title,
			messages: parsed.messages
		});
		return json(row, { status: 201 });
	} catch (err) {
		if (err instanceof D6eClientError) {
			console.error(`[${CALLER_TAG}] POST failed: status=${err.status} message=${err.message}`);
			return json({ error: err.message }, { status: err.status });
		}
		const msg = err instanceof Error ? err.message : String(err);
		console.error(`[${CALLER_TAG}] POST unexpected error: ${msg}`);
		return json({ error: msg }, { status: 500 });
	}
};
