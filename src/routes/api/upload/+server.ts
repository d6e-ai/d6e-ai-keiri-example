// POST /api/upload -- server-side proxy that uploads a single receipt
// image to d6e's Storage API.
//
// Purpose:
//   The browser POSTs multipart/form-data with one "file" field. The
//   buffer is forwarded to d6e's /api/v1/workspaces/{wsId}/files/multipart
//   endpoint without base64 expansion. The response intentionally mirrors
//   IntentInputFileRef so the caller can pass it through to /api/intent
//   verbatim.
//
// Main specifications:
//   - Authenticated via event.locals.accessToken (populated by
//     hooks.server.ts from the auth-access cookie).
//   - Single file per request; the multi-file UI calls this endpoint in
//     parallel for each picked file.
//   - Max file size: 10 MB.

import { json } from '@sveltejs/kit';

import { D6eClientError, uploadFile } from '$lib/server/d6e-client';
import { requireAccessToken } from '$lib/server/session';

import type { RequestHandler } from './$types';

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const CALLER_TAG = '/api/upload';

export const POST: RequestHandler = async (event) => {
	const accessToken = requireAccessToken(event, CALLER_TAG);

	let form: FormData;
	try {
		form = await event.request.formData();
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		console.error(`[${CALLER_TAG}] Failed to parse multipart body: ${msg}`);
		return json({ error: 'Request body must be multipart/form-data' }, { status: 400 });
	}

	const file = form.get('file');
	if (!(file instanceof File)) {
		return json({ error: 'Missing required "file" field' }, { status: 400 });
	}
	if (file.size === 0) {
		return json({ error: 'Uploaded file is empty' }, { status: 400 });
	}
	if (file.size > MAX_FILE_BYTES) {
		return json(
			{
				error: `File too large (max ${MAX_FILE_BYTES} bytes, got ${file.size})`
			},
			{ status: 413 }
		);
	}

	const buffer = Buffer.from(await file.arrayBuffer());
	const filename = file.name || 'receipt';
	const contentType = file.type || 'application/octet-stream';

	try {
		const uploaded = await uploadFile(CALLER_TAG, accessToken, {
			filename,
			contentType,
			content: buffer,
			signal: event.request.signal
		});
		return json({
			fileId: uploaded.id,
			filename: uploaded.filename,
			mimeType: uploaded.contentType,
			sizeBytes: uploaded.sizeBytes
		});
	} catch (err) {
		if (err instanceof D6eClientError) {
			return json({ error: err.message }, { status: err.status });
		}
		const msg = err instanceof Error ? err.message : String(err);
		console.error(`[${CALLER_TAG}] Unexpected error: ${msg}`);
		return json({ error: msg }, { status: 500 });
	}
};
