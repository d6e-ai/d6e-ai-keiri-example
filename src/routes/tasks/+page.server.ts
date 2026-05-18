// Server load for the Tasks page (route "/tasks").
//
// Streams the full chat_session row list once (Promise streaming) so
// both the "pending" and "completed" tabs share a single d6e
// round-trip. Filtering happens client-side via toFilteredTasks()
// using the title prefix conventions in journal-title.ts.
//
// The initial active tab is taken from `?status=pending|completed`,
// defaulting to "pending" so the page opens on the in-progress list
// most users want to act on first.

import type { TasksFetchResult } from '$lib/journal-task';
import { fetchChatSessionsForCaller } from '$lib/server/d6e-client';
import { requireAccessToken } from '$lib/server/session';

import type { PageServerLoad } from './$types';

const CALLER_TAG = '/tasks/+page.server.ts';

export type TaskStatus = 'pending' | 'completed';

export const load: PageServerLoad = async (event) => {
	const accessToken = requireAccessToken(event, CALLER_TAG);
	const tasks$: Promise<TasksFetchResult> = fetchChatSessionsForCaller(CALLER_TAG, accessToken);

	const statusParam = event.url.searchParams.get('status');
	const initialStatus: TaskStatus = statusParam === 'completed' ? 'completed' : 'pending';

	return { tasks$, initialStatus };
};
