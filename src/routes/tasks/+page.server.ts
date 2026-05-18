// Server load for the Completed Tasks page (route "/tasks").
//
// Same streaming pattern as the AI Journal page (see ../+page.server.ts).
// We hand back the full chat_session row array and let the page
// component filter / shape it with filterJournalSessions — that keeps
// the [keiri] / #completed conventions in one place (src/lib/journal-title.ts).

import type { TasksFetchResult } from '$lib/journal-task';
import { fetchChatSessionsForCaller } from '$lib/server/d6e-client';
import { requireAccessToken } from '$lib/server/session';

import type { PageServerLoad } from './$types';

const CALLER_TAG = '/tasks/+page.server.ts (completed)';

export const load: PageServerLoad = async (event) => {
	const accessToken = requireAccessToken(event, CALLER_TAG);
	const completedTasks$: Promise<TasksFetchResult> = fetchChatSessionsForCaller(
		CALLER_TAG,
		accessToken
	);
	return { completedTasks$ };
};
