// Thin server-side wrapper around the d6e REST endpoints used by this app.
//
// Purpose:
//   Every function here takes the caller's access token as an explicit
//   argument. The token is obtained from event.locals.accessToken,
//   which hooks.server.ts populates from the auth-access cookie
//   (with automatic refresh via auth-refresh). The wrapper never
//   reads cookies or env-stored credentials directly.
//
// Main specifications:
//   - uploadFile():   POST /api/v1/workspaces/{wsId}/files/multipart on
//                     the d6e Rust API as multipart/form-data.
//   - deleteFile():   DELETE /api/v1/workspaces/{wsId}/files/{fileId}.
//   - executeByIntent(): POST /api/workflows/execute-by-intent on the
//                     d6e SvelteKit frontend. Supports an external
//                     AbortSignal and a bounded timeout (default 270s,
//                     below Vercel's 300s cap) and surfaces timeout /
//                     abort as D6eClientError flags.
//   - listChatSessions() / getChatSessionById() / createChatSession() /
//     updateChatSession() / deleteChatSession(): CRUD against the d6e
//     SvelteKit /api/chat-sessions surface. These use COOKIE auth
//     (auth-token=<accessToken>) rather than Bearer because d6e's chat
//     session API resolves the user via locals.user, which only the
//     hooks.server cookie pipeline populates. The cookie value is the
//     same JWT we use as Bearer elsewhere.
//   - verifyWorkspaceMembership(): GET /api/v1/workspaces/{wsId} probe
//     used by /auth/callback to enforce the workspace allow-list.
//
// Errors are normalised into D6eClientError so the calling route
// handler can decide which HTTP status to surface.
//
// Limitations:
//   - On a 401 the wrapper does NOT silently refresh. The hook layer
//     already keeps the cookie token fresh, so a 401 here means the
//     token has been revoked server-side. Bubble it up; the calling
//     route handler will surface it to the browser, which will then
//     hit /auth/login the next time the user navigates.

import { getD6eUrl, getD6eWorkspaceId } from './env';

const UPLOAD_TIMEOUT_MS = 60_000;
const DELETE_TIMEOUT_MS = 10_000;
const DEFAULT_INTENT_TIMEOUT_MS = 270_000;
const CHAT_SESSIONS_TIMEOUT_MS = 30_000;
const MEMBERSHIP_TIMEOUT_MS = 10_000;

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

function isAbortLikeError(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	return error.name === 'AbortError' || error.name === 'TimeoutError';
}

// Combine an external AbortSignal (if any) with a timeout-based signal.
// AbortSignal.any() requires Node.js 20.3+, which Vercel functions
// already provide; locally this needs a Node 20+ runtime as declared
// in package.json.
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
 * and return its UUID plus the canonical content type and size.
 *
 * The size is recomputed from the buffer length so the caller does not
 * have to trust the incoming `Content-Length` header.
 */
export async function uploadFile(
	caller: string,
	accessToken: string,
	payload: {
		filename: string;
		contentType: string;
		content: Buffer;
		signal?: AbortSignal;
	}
): Promise<UploadFileResult> {
	const apiUrl = getD6eUrl(caller);
	const workspaceId = getD6eWorkspaceId(caller);

	const contentType = payload.contentType || 'application/octet-stream';
	const sizeBytes = payload.content.byteLength;

	const formData = new FormData();
	const blob = new Blob([new Uint8Array(payload.content)], { type: contentType });
	formData.append('file', blob, payload.filename);
	formData.append('metadata', JSON.stringify({ source: 'd6e-ai-keiri-example' }));

	const url = `${apiUrl}/api/v1/workspaces/${workspaceId}/files/multipart`;
	let response: Response;
	try {
		response = await fetch(url, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${accessToken}`,
				'X-Workspace-ID': workspaceId
			},
			body: formData,
			signal: buildCombinedSignal(UPLOAD_TIMEOUT_MS, payload.signal)
		});
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
 * Delete a previously uploaded file. Called both for explicit user
 * removal (DELETE /api/upload/[fileId]) and for best-effort cleanup
 * after a failed execute-by-intent run.
 *
 * Failures are logged but never throw so the caller can keep
 * propagating its primary error.
 */
export async function deleteFile(
	caller: string,
	accessToken: string,
	fileId: string
): Promise<void> {
	const apiUrl = getD6eUrl(caller);
	const workspaceId = getD6eWorkspaceId(caller);

	const url = `${apiUrl}/api/v1/workspaces/${workspaceId}/files/${fileId}`;
	try {
		const response = await fetch(url, {
			method: 'DELETE',
			headers: {
				Authorization: `Bearer ${accessToken}`,
				'X-Workspace-ID': workspaceId
			},
			signal: AbortSignal.timeout(DELETE_TIMEOUT_MS)
		});
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
 */
export async function executeByIntent(
	caller: string,
	accessToken: string,
	body: { message: string; inputFileRefs?: IntentInputFileRef[] },
	options?: { timeoutMs?: number; signal?: AbortSignal }
): Promise<IntentResponse> {
	const frontendUrl = getD6eUrl(caller);
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
	let response: Response;
	try {
		response = await fetch(requestUrl, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${accessToken}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(requestBody),
			signal: buildCombinedSignal(timeoutMs, externalSignal)
		});
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

/**
 * Confirm that the logged-in user is a member of the workspace.
 *
 * Used by /auth/callback after token exchange to enforce the per-app
 * workspace allow-list. Returns true on HTTP 200, false on 403/404,
 * and throws D6eClientError on transport failure so the caller can
 * decide whether to bounce to /auth/no-access or /auth/login.
 */
export async function verifyWorkspaceMembership(
	caller: string,
	accessToken: string
): Promise<boolean> {
	const baseUrl = getD6eUrl(caller);
	const workspaceId = getD6eWorkspaceId(caller);
	const url = `${baseUrl}/api/v1/workspaces/${workspaceId}`;

	let response: Response;
	try {
		response = await fetch(url, {
			method: 'GET',
			headers: {
				Authorization: `Bearer ${accessToken}`,
				Accept: 'application/json'
			},
			signal: AbortSignal.timeout(MEMBERSHIP_TIMEOUT_MS)
		});
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		throw new D6eClientError(
			`verifyWorkspaceMembership: network error talking to ${url} (${caller}): ${msg}`,
			502,
			''
		);
	}

	if (response.status === 200) {
		await readUpstreamBody(response);
		return true;
	}
	if (response.status === 403 || response.status === 404) {
		const body = await readUpstreamBody(response);
		console.warn(
			`[d6e-client] verifyWorkspaceMembership rejected (${caller}): status=${response.status} body=${body.slice(0, 300)}`
		);
		return false;
	}
	const body = await readUpstreamBody(response);
	throw new D6eClientError(
		`verifyWorkspaceMembership unexpected status ${response.status} (${caller})`,
		response.status,
		body
	);
}

// Loose UIMessage shape. We do not validate the structure here because
// d6e accepts both legacy Message[] rows and AI SDK v5 UIMessage[]; the
// caller (journal-task.ts) is responsible for narrowing.
export type ChatSessionMessage = Record<string, unknown>;

export interface ChatSessionRow {
	id: string;
	workspaceId: string;
	title: string | null;
	messages: ChatSessionMessage[];
	snsSource: 'slack' | 'discord' | 'line' | null;
	externalConversationKey: string | null;
	createdAt: string;
	updatedAt: string;
}

/**
 * Internal helper: JSON request against the d6e SvelteKit chat-session
 * endpoints, using the access token as the auth-token cookie value.
 *
 * The path is appended to D6E_BASE_URL exactly as given so callers stay
 * explicit about which sub-route they are hitting.
 */
async function chatSessionsRequest(
	caller: string,
	accessToken: string,
	path: string,
	init: { method: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown }
): Promise<Response> {
	const frontendUrl = getD6eUrl(caller);
	const url = `${frontendUrl}${path}`;

	const headers: Record<string, string> = {
		Cookie: `auth-token=${accessToken}`,
		Accept: 'application/json'
	};
	const fetchInit: RequestInit = {
		method: init.method,
		headers,
		signal: AbortSignal.timeout(CHAT_SESSIONS_TIMEOUT_MS)
	};
	if (init.body !== undefined) {
		headers['Content-Type'] = 'application/json';
		fetchInit.body = JSON.stringify(init.body);
	}

	let response: Response;
	try {
		response = await fetch(url, fetchInit);
	} catch (err) {
		if (isAbortLikeError(err)) {
			throw new D6eClientError(
				`chat-sessions ${init.method} ${path} timed out after ${CHAT_SESSIONS_TIMEOUT_MS / 1000}s (${caller})`,
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
			`[d6e-client] chat-sessions ${init.method} ${path} failed (${caller}): status=${response.status} body=${body.slice(0, 500)}`
		);
		throw new D6eClientError(
			`chat-sessions ${init.method} ${path} failed: ${response.status} ${response.statusText}`,
			response.status,
			body
		);
	}

	return response;
}

export async function listChatSessions(
	caller: string,
	accessToken: string,
	workspaceId: string
): Promise<ChatSessionRow[]> {
	const path = `/api/chat-sessions?workspaceId=${encodeURIComponent(workspaceId)}`;
	const response = await chatSessionsRequest(caller, accessToken, path, { method: 'GET' });
	const body = (await response.json()) as ChatSessionRow[];
	return Array.isArray(body) ? body : [];
}

export async function getChatSessionById(
	caller: string,
	accessToken: string,
	sessionId: string
): Promise<ChatSessionRow> {
	const path = `/api/chat-sessions/${encodeURIComponent(sessionId)}`;
	const response = await chatSessionsRequest(caller, accessToken, path, { method: 'GET' });
	return (await response.json()) as ChatSessionRow;
}

export async function createChatSession(
	caller: string,
	accessToken: string,
	args: {
		workspaceId: string;
		title: string | null;
		messages: ChatSessionMessage[];
	}
): Promise<ChatSessionRow> {
	const response = await chatSessionsRequest(caller, accessToken, '/api/chat-sessions', {
		method: 'POST',
		body: args
	});
	return (await response.json()) as ChatSessionRow;
}

export async function updateChatSession(
	caller: string,
	accessToken: string,
	sessionId: string,
	patch: { title?: string | null; messages?: ChatSessionMessage[] }
): Promise<ChatSessionRow> {
	const path = `/api/chat-sessions/${encodeURIComponent(sessionId)}`;
	const response = await chatSessionsRequest(caller, accessToken, path, {
		method: 'PATCH',
		body: patch
	});
	return (await response.json()) as ChatSessionRow;
}

export async function deleteChatSession(
	caller: string,
	accessToken: string,
	sessionId: string
): Promise<void> {
	const path = `/api/chat-sessions/${encodeURIComponent(sessionId)}`;
	await chatSessionsRequest(caller, accessToken, path, { method: 'DELETE' });
}

/**
 * Shared loader used by SSR loaders to stream the chat_session row
 * list to the page. Folds any failure into the returned shape so
 * load() can render an inline error banner without the rest of the
 * page crashing.
 */
export async function fetchChatSessionsForCaller(
	caller: string,
	accessToken: string
): Promise<{ ok: boolean; rows: ChatSessionRow[]; error?: string }> {
	let workspaceId: string;
	try {
		workspaceId = getD6eWorkspaceId(caller);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		console.error(`[${caller}] env error: ${msg}`);
		return { ok: false, rows: [], error: msg };
	}

	try {
		const rows = await listChatSessions(caller, accessToken, workspaceId);
		return { ok: true, rows };
	} catch (err) {
		const msg =
			err instanceof D6eClientError
				? `[${err.status}] ${err.message}`
				: err instanceof Error
					? err.message
					: String(err);
		console.error(`[${caller}] listChatSessions failed: ${msg}`);
		return { ok: false, rows: [], error: msg };
	}
}
