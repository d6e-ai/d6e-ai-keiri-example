// POST /api/intent - server-side proxy that forwards a natural-language
// task to d6e's /api/workflows/execute-by-intent endpoint.
//
// The workspace id is injected from environment variables, so the client
// never has to know it. Input file references uploaded via /api/upload
// can be passed through unchanged.
//
// The response shape is the raw IntentResponse from upstream; the AI
// journal page is responsible for running it through parse-journal to
// turn the assistant message into structured data when applicable.

import { json } from '@sveltejs/kit';

import { D6eClientError, executeByIntent, type IntentInputFileRef } from '$lib/server/d6e-client';

import type { RequestHandler } from './$types';

interface IntentRequestBody {
	message?: unknown;
	inputFileRefs?: unknown;
}

function validateInputFileRefs(value: unknown): IntentInputFileRef[] | string {
	if (value == null) return [];
	if (!Array.isArray(value)) return 'inputFileRefs must be an array';
	const refs: IntentInputFileRef[] = [];
	for (let i = 0; i < value.length; i += 1) {
		const ref = value[i];
		if (!ref || typeof ref !== 'object') {
			return `inputFileRefs[${i}] must be an object`;
		}
		const { fileId, filename, mimeType, sizeBytes } = ref as Record<string, unknown>;
		if (typeof fileId !== 'string' || fileId.length === 0) {
			return `inputFileRefs[${i}].fileId must be a non-empty string`;
		}
		if (typeof filename !== 'string' || filename.length === 0) {
			return `inputFileRefs[${i}].filename must be a non-empty string`;
		}
		if (typeof mimeType !== 'string' || mimeType.length === 0) {
			return `inputFileRefs[${i}].mimeType must be a non-empty string`;
		}
		if (typeof sizeBytes !== 'number' || !Number.isFinite(sizeBytes) || sizeBytes < 0) {
			return `inputFileRefs[${i}].sizeBytes must be a non-negative number`;
		}
		refs.push({ fileId, filename, mimeType, sizeBytes });
	}
	return refs;
}

export const POST: RequestHandler = async ({ request }) => {
	const callerTag = '/api/intent';

	let body: IntentRequestBody;
	try {
		body = (await request.json()) as IntentRequestBody;
	} catch {
		return json({ error: 'Request body must be valid JSON' }, { status: 400 });
	}

	if (typeof body.message !== 'string' || body.message.trim().length === 0) {
		return json({ error: 'Field "message" must be a non-empty string' }, { status: 400 });
	}

	const refsOrError = validateInputFileRefs(body.inputFileRefs);
	if (typeof refsOrError === 'string') {
		return json({ error: refsOrError }, { status: 400 });
	}

	try {
		const upstream = await executeByIntent(callerTag, {
			message: body.message,
			inputFileRefs: refsOrError
		});
		return json(upstream);
	} catch (err) {
		if (err instanceof D6eClientError) {
			return json({ error: err.message }, { status: err.status });
		}
		const msg = err instanceof Error ? err.message : String(err);
		console.error(`[${callerTag}] Unexpected error: ${msg}`);
		return json({ error: msg }, { status: 500 });
	}
};
