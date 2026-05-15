// Server-side proxy for d6e's /api/chat-sessions/{id} surface.
//
// Forwards GET / PATCH / DELETE to the d6e SvelteKit endpoint, using
// the OAuth access token as the auth-token cookie. workspaceId is not
// touched here because the d6e endpoint resolves the session by id and
// enforces workspace membership server-side.
//
// PATCH body accepts:
//   - title: string | null  -> rename (or clear) the session title
//   - messages: array       -> overwrite the full messages jsonb
//
// We intentionally do NOT expose append-only semantics here; if a
// caller wants to append, it should GET the existing messages, append
// in memory, then PATCH the full array. The d6e endpoint also accepts
// jsonb concat at the DB level via the SNS persistence path, but that
// is internal and not part of /api/chat-sessions/{id}.

import { json } from '@sveltejs/kit';

import {
	D6eClientError,
	deleteChatSession,
	getChatSessionById,
	updateChatSession,
	type ChatSessionMessage
} from '$lib/server/d6e-client';

import type { RequestHandler } from './$types';

const CALLER_TAG_BASE = '/api/chat-sessions/[id]';

interface PatchChatSessionRequestBody {
	title?: unknown;
	messages?: unknown;
}

function validatePatchBody(
	body: PatchChatSessionRequestBody
): { title?: string | null; messages?: ChatSessionMessage[] } | string {
	const out: { title?: string | null; messages?: ChatSessionMessage[] } = {};

	if (body.title !== undefined) {
		if (body.title === null) {
			out.title = null;
		} else if (typeof body.title === 'string') {
			out.title = body.title;
		} else {
			return 'Field "title" must be a string or null';
		}
	}

	if (body.messages !== undefined) {
		if (!Array.isArray(body.messages)) {
			return 'Field "messages" must be an array';
		}
		for (let i = 0; i < body.messages.length; i += 1) {
			const m = body.messages[i];
			if (!m || typeof m !== 'object' || Array.isArray(m)) {
				return `messages[${i}] must be an object`;
			}
		}
		out.messages = body.messages as ChatSessionMessage[];
	}

	if (out.title === undefined && out.messages === undefined) {
		return 'PATCH body must include at least one of "title" or "messages"';
	}

	return out;
}

function handleClientError(method: string, sessionId: string, err: unknown) {
	if (err instanceof D6eClientError) {
		console.error(
			`[${CALLER_TAG_BASE}] ${method} failed sessionId=${sessionId} status=${err.status} message=${err.message}`
		);
		return json({ error: err.message }, { status: err.status });
	}
	const msg = err instanceof Error ? err.message : String(err);
	console.error(`[${CALLER_TAG_BASE}] ${method} unexpected error sessionId=${sessionId}: ${msg}`);
	return json({ error: msg }, { status: 500 });
}

export const GET: RequestHandler = async ({ params }) => {
	const sessionId = params.id ?? '';
	if (!sessionId) {
		return json({ error: 'Missing session id' }, { status: 400 });
	}
	try {
		const row = await getChatSessionById(`${CALLER_TAG_BASE} GET`, sessionId);
		return json(row);
	} catch (err) {
		return handleClientError('GET', sessionId, err);
	}
};

export const PATCH: RequestHandler = async ({ params, request }) => {
	const sessionId = params.id ?? '';
	if (!sessionId) {
		return json({ error: 'Missing session id' }, { status: 400 });
	}

	let raw: PatchChatSessionRequestBody;
	try {
		raw = (await request.json()) as PatchChatSessionRequestBody;
	} catch {
		return json({ error: 'Request body must be valid JSON' }, { status: 400 });
	}

	const parsed = validatePatchBody(raw);
	if (typeof parsed === 'string') {
		return json({ error: parsed }, { status: 400 });
	}

	try {
		const row = await updateChatSession(`${CALLER_TAG_BASE} PATCH`, sessionId, parsed);
		return json(row);
	} catch (err) {
		return handleClientError('PATCH', sessionId, err);
	}
};

export const DELETE: RequestHandler = async ({ params }) => {
	const sessionId = params.id ?? '';
	if (!sessionId) {
		return json({ error: 'Missing session id' }, { status: 400 });
	}
	try {
		await deleteChatSession(`${CALLER_TAG_BASE} DELETE`, sessionId);
		return json({ success: true });
	} catch (err) {
		return handleClientError('DELETE', sessionId, err);
	}
};
