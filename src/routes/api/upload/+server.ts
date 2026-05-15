// POST /api/upload - server-side proxy that uploads a single receipt image
// to d6e's Storage API and returns the resulting file reference.
//
// The client should POST a multipart/form-data body with a single "file"
// field. We re-encode the binary as base64 and call d6e's JSON-only
// /api/v1/workspaces/{wsId}/files endpoint via lib/server/d6e-client.
//
// The response payload mirrors the shape that execute-by-intent expects
// in its inputFileRefs[] argument so the caller can immediately forward
// it on without any field renaming.

import { json } from '@sveltejs/kit';

import { D6eClientError, uploadFile } from '$lib/server/d6e-client';

import type { RequestHandler } from './$types';

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MiB - matches d6e default

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
	const contentBase64 = buffer.toString('base64');
	const filename = file.name || 'receipt';
	const contentType = file.type || 'application/octet-stream';

	try {
		const uploaded = await uploadFile(callerTag, {
			filename,
			contentType,
			contentBase64
		});
		return json({
			fileId: uploaded.id,
			filename: uploaded.filename,
			mimeType: contentType,
			sizeBytes: file.size
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
