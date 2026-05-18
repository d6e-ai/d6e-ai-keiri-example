// Server load for the AI Journal page (route "/").
//
// Purpose:
//   When the URL carries `?chatSessionId=<uuid>`, fetch that chat_session
//   row from d6e and return a `restoredSession` shape so the page can
//   re-hydrate the upload list, the chat session id, and the parsed
//   assistant payload. Without the query parameter the loader returns
//   `restoredSession: null` and the page renders the fresh-start UI.
//
// Why no pendingTasks$ here anymore:
//   In the previous design the journal page also rendered a "pending"
//   task list. That section moved to /tasks (as a tab) so the AI Journal
//   page can focus on the active session. Listing chat_session rows for
//   every page load was also wasteful — most journal turns do not need
//   the list at all.
//
// Errors:
//   getChatSessionById failures (404, network, etc.) are folded into
//   the returned shape as `restoreError`; the page logs the detail and
//   falls back to the fresh-start UI so the user is never stranded on
//   a blank screen because a stale URL pointed at a deleted session.

import { deriveJournalTaskSummary } from '$lib/journal-task';
import { D6eClientError, getChatSessionById } from '$lib/server/d6e-client';
import type { IntentInputFileRef } from '$lib/server/d6e-client';
import { requireAccessToken } from '$lib/server/session';

import type { PageServerLoad } from './$types';

const CALLER_TAG = '/+page.server.ts (journal-page-server)';

export interface RestoredSession {
	id: string;
	title: string;
	displayTitle: string;
	isCompleted: boolean;
	rawAssistantText: string;
	uploadedRefs: IntentInputFileRef[];
}

export const load: PageServerLoad = async (event) => {
	const accessToken = requireAccessToken(event, CALLER_TAG);
	const chatSessionId = event.url.searchParams.get('chatSessionId');

	if (!chatSessionId) {
		return {
			restoredSession: null as RestoredSession | null,
			restoreError: null as string | null
		};
	}

	try {
		const row = await getChatSessionById(CALLER_TAG, accessToken, chatSessionId);
		const summary = deriveJournalTaskSummary(row);
		const restoredSession: RestoredSession = {
			id: summary.id,
			title: summary.title,
			displayTitle: summary.displayTitle,
			isCompleted: summary.isCompleted,
			rawAssistantText: summary.rawAssistantText,
			uploadedRefs: summary.uploadedRefs
		};
		return {
			restoredSession,
			restoreError: null as string | null
		};
	} catch (err) {
		const detail =
			err instanceof D6eClientError
				? `[${err.status}] ${err.message}`
				: err instanceof Error
					? err.message
					: String(err);
		console.error(`[${CALLER_TAG}] failed to restore chatSessionId=${chatSessionId}: ${detail}`);
		return {
			restoredSession: null as RestoredSession | null,
			restoreError: detail
		};
	}
};
