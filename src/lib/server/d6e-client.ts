// Thin server-side wrapper around the d6e REST endpoints used by this app.
//
// Three surfaces are exposed:
//   - uploadFile():   POST /api/v1/workspaces/{wsId}/files/multipart on the
//                     d6e Rust API. Uploads a single binary as multipart/form-data
//                     and returns the storage UUID + mimeType + sizeBytes so the
//                     caller can immediately build an IntentInputFileRef.
//   - deleteFile():   DELETE /api/v1/workspaces/{wsId}/files/{fileId}. Best-effort
//                     cleanup used when execute-by-intent fails before consuming
//                     the file, mirroring the d6e-auth proxy behaviour.
//   - executeByIntent(): POST /api/workflows/execute-by-intent on the
//                     d6e SvelteKit frontend. Used by /api/intent to run a
//                     natural language workflow with the previously uploaded
//                     file references. Supports an external AbortSignal and a
//                     bounded timeout (default 270s, below Vercel's 300s cap)
//                     and surfaces timeout / abort as D6eClientError flags.
//
// All calls are made server-side so the user's browser never sees the
// d6e access token. The token itself is obtained from ./d6e-token.ts,
// which exchanges the long-lived refresh token in D6E_REFRESH_TOKEN for a
// short-lived access token via d6e-auth and caches it in memory. On a
// 401 we invalidate the cache and retry once so a server that has been
// running long enough for the upstream token to be revoked recovers
// without a process restart.
//
// Errors are normalised into D6eClientError so that the calling route
// handler can decide which HTTP status to surface.
//
// Why multipart upload?
//   The Rust API exposes both a JSON+base64 endpoint (`/files`) and a
//   multipart endpoint (`/files/multipart`). The multipart endpoint is what
//   the production d6e-auth SNS proxy uses and avoids 33% base64 overhead
//   on large attachments, which matters for receipt photos.

import { getAccessToken, invalidateAccessToken } from './d6e-token';
import { getD6eApiUrl, getD6eFrontendUrl, getD6eWorkspaceId } from './env';

// Default per-file upload timeout, matching the d6e-auth proxy contract.
const UPLOAD_TIMEOUT_MS = 60_000;

// Storage delete is a best-effort housekeeping call, so the timeout is short.
const DELETE_TIMEOUT_MS = 10_000;

// Default execute-by-intent timeout. Kept below Vercel's 300s function cap
// so the SvelteKit route handler has time to clean up before being killed.
const DEFAULT_INTENT_TIMEOUT_MS = 270_000;

// "Client Closed Request" — d6e returns this when the upstream stream aborts.
const HTTP_CLIENT_CLOSED_REQUEST = 499;

export interface UploadFileResult {
	id: string;
	filename: string;
	contentType: string;
	sizeBytes: number;
}

export interface IntentInputFileRef {
	fileId: string;
	filename: string;
	mimeType: string;
	sizeBytes: number;
}

export interface IntentResponseFile {
	data: string;
	filename: string;
	mimeType: string;
}

export interface IntentResponse {
	success: boolean;
	message: string;
	workflowName?: string;
	files?: IntentResponseFile[];
	result?: unknown;
}

export class D6eClientError extends Error {
	readonly status: number;
	readonly upstreamBody: string;
	readonly timedOut: boolean;
	readonly aborted: boolean;
	constructor(
		message: string,
		status: number,
		upstreamBody: string,
		options?: { timedOut?: boolean; aborted?: boolean }
	) {
		super(message);
		this.name = 'D6eClientError';
		this.status = status;
		this.upstreamBody = upstreamBody;
		this.timedOut = options?.timedOut ?? false;
		this.aborted = options?.aborted ?? false;
	}
}

async function readUpstreamBody(response: Response): Promise<string> {
	try {
		return await response.text();
	} catch {
		return '';
	}
}

// True when fetch threw due to AbortSignal.timeout() or controller.abort().
function isAbortLikeError(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	return error.name === 'AbortError' || error.name === 'TimeoutError';
}

// Combine an external AbortSignal (if any) with a timeout-based signal.
// AbortSignal.any() requires Node.js 20.3+, which Vercel functions already
// provide; locally this needs a Node 20+ runtime as declared in package.json.
function buildCombinedSignal(
	timeoutMs: number,
	externalSignal: AbortSignal | undefined
): AbortSignal {
	const timeoutSignal = AbortSignal.timeout(timeoutMs);
	if (!externalSignal) {
		return timeoutSignal;
	}
	return AbortSignal.any([externalSignal, timeoutSignal]);
}

/**
 * Upload a single file buffer to the d6e Storage API as multipart/form-data
 * and return its UUID plus the canonical content type and size. The size is
 * recomputed from the buffer length so the caller does not have to trust the
 * incoming `Content-Length` header.
 *
 * @param caller Short tag (e.g. "/api/upload") used in error messages.
 * @param payload Filename / mime / raw buffer / optional external abort signal.
 */
export async function uploadFile(
	caller: string,
	payload: {
		filename: string;
		contentType: string;
		content: Buffer;
		signal?: AbortSignal;
	}
): Promise<UploadFileResult> {
	const apiUrl = getD6eApiUrl(caller);
	const workspaceId = getD6eWorkspaceId(caller);

	const contentType = payload.contentType || 'application/octet-stream';
	const sizeBytes = payload.content.byteLength;

	// FormData itself is reusable across retries because it does not consume
	// its underlying blobs until fetch() reads them, but we still need a
	// fresh AbortSignal per attempt so the timeout is reset on the retry.
	const formData = new FormData();
	const blob = new Blob([new Uint8Array(payload.content)], { type: contentType });
	formData.append('file', blob, payload.filename);
	formData.append('metadata', JSON.stringify({ source: 'd6e-ai-keiri-example' }));

	const url = `${apiUrl}/api/v1/workspaces/${workspaceId}/files/multipart`;
	const doFetch = async (): Promise<Response> => {
		const accessToken = await getAccessToken(caller);
		return fetch(url, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${accessToken}`,
				'X-Workspace-ID': workspaceId
			},
			body: formData,
			signal: buildCombinedSignal(UPLOAD_TIMEOUT_MS, payload.signal)
		});
	};

	let response: Response;
	try {
		response = await doFetch();
		// 401 usually means the cached access token expired between the
		// last refresh check and the upstream call (clock skew or aggressive
		// revocation). Drop the cache and retry once with a fresh token.
		if (response.status === 401) {
			invalidateAccessToken();
			response = await doFetch();
		}
	} catch (err) {
		if (payload.signal?.aborted) {
			throw new D6eClientError(
				`uploadFile aborted by caller (${caller}, filename=${payload.filename})`,
				HTTP_CLIENT_CLOSED_REQUEST,
				'',
				{ aborted: true }
			);
		}
		if (isAbortLikeError(err)) {
			throw new D6eClientError(
				`uploadFile timed out after ${UPLOAD_TIMEOUT_MS / 1000}s (${caller}, filename=${payload.filename})`,
				504,
				'',
				{ timedOut: true }
			);
		}
		throw err;
	}

	if (!response.ok) {
		const body = await readUpstreamBody(response);
		console.error(
			`[d6e-client] uploadFile failed (${caller}): status=${response.status} filename=${payload.filename} body=${body.slice(0, 500)}`
		);
		throw new D6eClientError(
			`Upload failed for ${payload.filename}: ${response.status} ${response.statusText}`,
			response.status,
			body
		);
	}

	const result = (await response.json()) as {
		id?: string;
		filename?: string;
		content_type?: string;
		size?: number;
	};
	if (!result.id) {
		throw new D6eClientError(
			`Upload response missing id field for ${payload.filename}`,
			502,
			JSON.stringify(result)
		);
	}
	return {
		id: result.id,
		filename: result.filename ?? payload.filename,
		contentType: result.content_type ?? contentType,
		sizeBytes: typeof result.size === 'number' ? result.size : sizeBytes
	};
}

/**
 * Best-effort delete of a previously uploaded file. Used by /api/intent to
 * release storage space when execute-by-intent failed outright (and therefore
 * never consumed the file). Failures are logged but do not throw so that the
 * caller can still propagate the original error.
 */
export async function deleteFile(caller: string, fileId: string): Promise<void> {
	const apiUrl = getD6eApiUrl(caller);
	const workspaceId = getD6eWorkspaceId(caller);

	const url = `${apiUrl}/api/v1/workspaces/${workspaceId}/files/${fileId}`;
	try {
		const accessToken = await getAccessToken(caller);
		const response = await fetch(url, {
			method: 'DELETE',
			headers: {
				Authorization: `Bearer ${accessToken}`,
				'X-Workspace-ID': workspaceId
			},
			signal: AbortSignal.timeout(DELETE_TIMEOUT_MS)
		});
		// Best-effort: a 401 here means the cached token expired but cleanup
		// is not worth the round-trip to refresh — the caller is already
		// raising a separate error to the user. Just log and move on.
		if (!response.ok && response.status !== 404) {
			const body = await readUpstreamBody(response);
			console.error(
				`[d6e-client] deleteFile failed (${caller}): status=${response.status} fileId=${fileId} body=${body.slice(0, 300)}`
			);
		}
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		console.error(`[d6e-client] deleteFile error (${caller}): fileId=${fileId} message=${msg}`);
	}
}

/**
 * Run /api/workflows/execute-by-intent against the configured workspace.
 * The workspace id is injected here so the caller never has to pass it.
 *
 * Throws D6eClientError on transport failure, non-2xx upstream, timeout
 * (`timedOut === true`, status 504) or abort (`aborted === true`, status 499).
 *
 * Successful 200 responses where `success === false` are returned as-is so
 * the caller can decide how to render a logical failure (e.g. policy blocked
 * the run) vs. a transport failure.
 *
 * @param caller Short tag for diagnostics.
 * @param body Free-form natural language message + optional file refs.
 * @param options Optional timeout override and external abort signal.
 */
export async function executeByIntent(
	caller: string,
	body: { message: string; inputFileRefs?: IntentInputFileRef[] },
	options?: { timeoutMs?: number; signal?: AbortSignal }
): Promise<IntentResponse> {
	const frontendUrl = getD6eFrontendUrl(caller);
	const workspaceId = getD6eWorkspaceId(caller);

	const timeoutMs = options?.timeoutMs ?? DEFAULT_INTENT_TIMEOUT_MS;
	const externalSignal = options?.signal;

	if (externalSignal?.aborted) {
		throw new D6eClientError(
			`execute-by-intent skipped because caller already aborted (${caller})`,
			HTTP_CLIENT_CLOSED_REQUEST,
			'',
			{ aborted: true }
		);
	}

	const requestBody = {
		message: body.message,
		workspaceId,
		inputFileRefs:
			body.inputFileRefs && body.inputFileRefs.length > 0 ? body.inputFileRefs : undefined
	};

	const requestUrl = `${frontendUrl}/api/workflows/execute-by-intent`;
	const doFetch = async (): Promise<Response> => {
		const accessToken = await getAccessToken(caller);
		return fetch(requestUrl, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${accessToken}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(requestBody),
			signal: buildCombinedSignal(timeoutMs, externalSignal)
		});
	};

	let response: Response;
	try {
		response = await doFetch();
		// Same auto-recovery as uploadFile: if the upstream token was revoked
		// while we were idle, drop the cache and retry once.
		if (response.status === 401) {
			invalidateAccessToken();
			response = await doFetch();
		}
	} catch (err) {
		if (externalSignal?.aborted) {
			throw new D6eClientError(
				`execute-by-intent aborted by caller (${caller})`,
				HTTP_CLIENT_CLOSED_REQUEST,
				'',
				{ aborted: true }
			);
		}
		if (isAbortLikeError(err)) {
			throw new D6eClientError(
				`execute-by-intent timed out after ${Math.round(timeoutMs / 1000)}s (${caller})`,
				504,
				'',
				{ timedOut: true }
			);
		}
		throw err;
	}

	if (response.status === HTTP_CLIENT_CLOSED_REQUEST) {
		throw new D6eClientError(
			`execute-by-intent returned 499 Client Closed Request (${caller})`,
			HTTP_CLIENT_CLOSED_REQUEST,
			'',
			{ aborted: true }
		);
	}

	const responseText = await readUpstreamBody(response);
	if (!response.ok) {
		console.error(
			`[d6e-client] executeByIntent failed (${caller}): status=${response.status} body=${responseText.slice(0, 500)}`
		);
		throw new D6eClientError(
			`execute-by-intent failed: ${response.status} ${response.statusText}`,
			response.status,
			responseText
		);
	}

	try {
		return JSON.parse(responseText) as IntentResponse;
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		throw new D6eClientError(`execute-by-intent returned non-JSON body: ${msg}`, 502, responseText);
	}
}
