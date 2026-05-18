// DELETE /api/upload/[fileId] -- release a previously uploaded file.
//
// Purpose:
//   The multi-file upload UI uploads each picked file to d6e Storage
//   immediately so the user can review the queue before triggering
//   /api/intent. When the user removes a file from the queue, we have
//   to call back here so the orphaned blob does not stay in storage
//   forever.
//
// Main specifications:
//   - Authenticated via event.locals.accessToken.
//   - fileId is validated as a UUID before being forwarded to d6e to
//     avoid path traversal / odd characters.
//   - The underlying d6e DELETE is best-effort (matches the cleanup
//     path in /api/intent on failed runs): 404 is treated as success
//     because the file is already gone.

import { json } from '@sveltejs/kit';

import { deleteFile } from '$lib/server/d6e-client';
import { requireAccessToken } from '$lib/server/session';

import type { RequestHandler } from './$types';

const CALLER_TAG = '/api/upload/[fileId]';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const DELETE: RequestHandler = async (event) => {
	const accessToken = requireAccessToken(event, CALLER_TAG);

	const fileId = event.params.fileId ?? '';
	if (!UUID_RE.test(fileId)) {
		return json({ error: 'fileId must be a UUID' }, { status: 400 });
	}

	await deleteFile(CALLER_TAG, accessToken, fileId);
	return json({ ok: true });
};
