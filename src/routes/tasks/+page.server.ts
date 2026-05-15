// Server load for the Completed Tasks page (route "/tasks").
//
// Same streaming pattern as the AI Journal page (see ../+page.server.ts).
// We hand back the full chat_session row array and let the page
// component filter / shape it with filterJournalSessions — that keeps
// the [keiri] / #completed conventions in one place (src/lib/journal-title.ts).

import type { TasksFetchResult } from '$lib/journal-task';
import { fetchChatSessionsForCaller } from '$lib/server/d6e-client';

import type { PageServerLoad } from './$types';

const CALLER_TAG = '/tasks/+page.server.ts (completed)';

export const load: PageServerLoad = async () => {
	const completedTasks$: Promise<TasksFetchResult> = fetchChatSessionsForCaller(CALLER_TAG);
	return { completedTasks$ };
};
