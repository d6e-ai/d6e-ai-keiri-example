// POST /api/intent — server-side proxy that forwards a natural-language
// task to d6e's /api/workflows/execute-by-intent endpoint.
//
// The workspace id is injected from environment variables, so the client
// never has to know it. File references uploaded via /api/upload are passed
// through unchanged.
//
// Failure semantics:
//   - 504: upstream timed out (the workflow may still be running on d6e).
//   - 499: the browser navigated away / aborted the fetch.
//   - other 4xx/5xx: bubbled up from d6e's response.
//
// Cleanup policy:
//   When execute-by-intent fails with a *hard* error (non-success, not a
//   timeout and not an abort) and the request carried inputFileRefs, we
//   best-effort DELETE those storage records so the workspace does not
//   accumulate orphaned uploads. Timeouts deliberately leave the files in
//   place because the workflow may still be running and consuming them
//   (mirrors d6e-auth's SNS proxy behaviour).

import { json } from '@sveltejs/kit';

import {
	D6eClientError,
	deleteFile,
	executeByIntent,
	type IntentInputFileRef
} from '$lib/server/d6e-client';

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

async function bestEffortCleanup(callerTag: string, refs: IntentInputFileRef[]): Promise<void> {
	for (const ref of refs) {
		await deleteFile(callerTag, ref.fileId);
	}
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
	const inputFileRefs = refsOrError;

	try {
		const upstream = await executeByIntent(
			callerTag,
			{ message: body.message, inputFileRefs },
			{ signal: request.signal }
		);
		return json(upstream);
	} catch (err) {
		if (err instanceof D6eClientError) {
			// Hard failure (not a timeout, not an abort) — orphaned uploads
			// should be released. Timeouts intentionally skip cleanup because
			// the workflow may still be running on the d6e side.
			if (!err.timedOut && !err.aborted && inputFileRefs.length > 0) {
				await bestEffortCleanup(callerTag, inputFileRefs);
			}
			// NOTE: err.upstreamBody is intentionally NOT echoed back to the
			// browser. It can contain internal d6e response bodies that the
			// browser has no business seeing (see commit dbe6747). Server-side
			// logs in d6e-client.ts already record it for diagnostics.
			return json(
				{
					error: err.message,
					timedOut: err.timedOut || undefined,
					aborted: err.aborted || undefined
				},
				{ status: err.status }
			);
		}
		const msg = err instanceof Error ? err.message : String(err);
		console.error(`[${callerTag}] Unexpected error: ${msg}`);
		if (inputFileRefs.length > 0) {
			await bestEffortCleanup(callerTag, inputFileRefs);
		}
		return json({ error: msg }, { status: 500 });
	}
};
