// Server load for the Completed Tasks page (route "/tasks").
//
// Same streaming pattern as the AI Journal page (see ../+page.server.ts).
// We hand back the full chat_session row array and let the page
// component filter / shape it with filterJournalSessions — that keeps
// the [keiri] / #completed conventions in one place (src/lib/journal-title.ts).

import type { TasksFetchResult } from '$lib/journal-task';
import { D6eClientError, listChatSessions } from '$lib/server/d6e-client';
import { getD6eWorkspaceId } from '$lib/server/env';

import type { PageServerLoad } from './$types';

const CALLER_TAG = '/tasks/+page.server.ts (completed)';

async function loadCompletedRows(): Promise<TasksFetchResult> {
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
	const completedTasks$ = loadCompletedRows();
	return { completedTasks$ };
};
