// Thin server-side wrapper around the d6e REST endpoints used by this app.
//
// Two surfaces are exposed:
//   - uploadFile(): POST /api/v1/workspaces/{workspaceId}/files on the
//     d6e Rust API. Used by /api/upload to register a receipt image and
//     get back the storage UUID.
//   - executeByIntent(): POST /api/workflows/execute-by-intent on the
//     d6e SvelteKit frontend. Used by /api/intent to run the natural
//     language workflow with the previously uploaded file references.
//
// All calls are made server-side so the user's browser never sees the
// D6E_JWT Bearer token. Errors are normalised into a small HttpError so
// that the calling route handler can decide what status code to surface
// to its own client.

import { getD6eApiUrl, getD6eFrontendUrl, getD6eJwt, getD6eWorkspaceId } from './env';

export interface UploadFileResult {
	id: string;
	filename: string;
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
	constructor(message: string, status: number, upstreamBody: string) {
		super(message);
		this.name = 'D6eClientError';
		this.status = status;
		this.upstreamBody = upstreamBody;
	}
}

async function readUpstreamBody(response: Response): Promise<string> {
	try {
		return await response.text();
	} catch {
		return '';
	}
}

/**
 * Upload a single file to the d6e Storage API and return its UUID.
 *
 * @param caller Short tag (e.g. "/api/upload") used in error messages.
 * @param payload Filename / mime / base64 content.
 */
export async function uploadFile(
	caller: string,
	payload: { filename: string; contentType: string; contentBase64: string }
): Promise<UploadFileResult> {
	const apiUrl = getD6eApiUrl(caller);
	const workspaceId = getD6eWorkspaceId(caller);
	const jwt = getD6eJwt(caller);

	const requestBody = {
		filename: payload.filename,
		content_type: payload.contentType || 'application/octet-stream',
		content: payload.contentBase64
	};

	const response = await fetch(`${apiUrl}/api/v1/workspaces/${workspaceId}/files`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${jwt}`,
			'Content-Type': 'application/json',
			'X-Workspace-ID': workspaceId
		},
		body: JSON.stringify(requestBody)
	});

	if (!response.ok) {
		const body = await readUpstreamBody(response);
		console.error(
			`[d6e-client] uploadFile failed (${caller}): status=${response.status} filename=${payload.filename} body=${body}`
		);
		throw new D6eClientError(
			`Upload failed for ${payload.filename}: ${response.status} ${response.statusText}`,
			response.status,
			body
		);
	}

	const result = (await response.json()) as { id?: string; filename?: string };
	if (!result.id) {
		throw new D6eClientError(
			`Upload response missing id field for ${payload.filename}`,
			502,
			JSON.stringify(result)
		);
	}
	return { id: result.id, filename: result.filename ?? payload.filename };
}

/**
 * Run /api/workflows/execute-by-intent against the configured workspace.
 * The workspace id is injected here so the caller never has to pass it.
 *
 * @param caller Short tag for diagnostics.
 * @param body Free-form natural language message + optional file refs.
 */
export async function executeByIntent(
	caller: string,
	body: { message: string; inputFileRefs?: IntentInputFileRef[] }
): Promise<IntentResponse> {
	const frontendUrl = getD6eFrontendUrl(caller);
	const workspaceId = getD6eWorkspaceId(caller);
	const jwt = getD6eJwt(caller);

	const requestBody = {
		message: body.message,
		workspaceId,
		inputFileRefs: body.inputFileRefs
	};

	const response = await fetch(`${frontendUrl}/api/workflows/execute-by-intent`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${jwt}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify(requestBody)
	});

	const responseText = await readUpstreamBody(response);
	if (!response.ok) {
		console.error(
			`[d6e-client] executeByIntent failed (${caller}): status=${response.status} body=${responseText}`
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
