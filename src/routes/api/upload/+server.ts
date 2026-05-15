// POST /api/upload — server-side proxy that uploads a single receipt image
// to d6e's Storage API via multipart/form-data and returns the file
// reference shape that execute-by-intent expects in inputFileRefs[].
//
// The browser POSTs multipart/form-data with one "file" field. The buffer
// is forwarded to d6e's /api/v1/workspaces/{wsId}/files/multipart endpoint
// without base64 expansion (saves ~33% bandwidth vs. JSON+base64 upload).
//
// The response intentionally mirrors IntentInputFileRef so the caller can
// pass it through to /api/intent verbatim.

import { json } from '@sveltejs/kit';

import { D6eClientError, uploadFile } from '$lib/server/d6e-client';

import type { RequestHandler } from './$types';

const MAX_FILE_BYTES = 10 * 1024 * 1024;

export const POST: RequestHandler = async ({ request }) => {
	const callerTag = '/api/upload';

	let form: FormData;
	try {
		form = await request.formData();
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		console.error(`[${callerTag}] Failed to parse multipart body: ${msg}`);
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
		const uploaded = await uploadFile(callerTag, {
			filename,
			contentType,
			content: buffer,
			signal: request.signal
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
		console.error(`[${callerTag}] Unexpected error: ${msg}`);
		return json({ error: msg }, { status: 500 });
	}
};
