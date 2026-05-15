// Server load for the AI Journal page (route "/").
//
// Streams the list of "pending" journal sessions (chat_session rows whose
// title starts with "[keiri] " AND does NOT end with " #completed") down
// to the page so the UI can render a Skeleton placeholder until the d6e
// round-trip resolves. Per the project convention the Promise variable
// is named with a trailing $ so the consumer can tell it apart from
// resolved values at a glance.
//
// We deliberately do NOT await the Promise here. SvelteKit's load
// returns a Promise as part of `data` and the framework streams the
// resolved value to the browser as soon as it is ready, keeping
// time-to-first-byte tight even when d6e is slow.
//
// Errors are NOT thrown out of load so the rest of the page (upload
// area, form) keeps rendering. Instead they are folded into the
// resolved value as { ok: false, error } and rendered as an inline
// banner by the page component.

import type { TasksFetchResult } from '$lib/journal-task';
import { D6eClientError, listChatSessions } from '$lib/server/d6e-client';
import { getD6eWorkspaceId } from '$lib/server/env';

import type { PageServerLoad } from './$types';

const CALLER_TAG = '/+page.server.ts (pending)';

async function loadPendingRows(): Promise<TasksFetchResult> {
	let workspaceId: string;
	try {
		workspaceId = getD6eWorkspaceId(CALLER_TAG);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		console.error(`[${CALLER_TAG}] env error: ${msg}`);
		return { ok: false, rows: [], error: msg };
	}

	try {
		const rows = await listChatSessions(CALLER_TAG, workspaceId);
		return { ok: true, rows };
	} catch (err) {
		const msg =
			err instanceof D6eClientError
				? `[${err.status}] ${err.message}`
				: err instanceof Error
					? err.message
					: String(err);
		console.error(`[${CALLER_TAG}] listChatSessions failed: ${msg}`);
		return { ok: false, rows: [], error: msg };
	}
}

export const load: PageServerLoad = async () => {
	// Kick off the network call but do NOT await it; SvelteKit will
	// stream the resolved value to the browser when it lands.
	const pendingTasks$ = loadPendingRows();
	return { pendingTasks$ };
};
