// GET /api/files/[fileId]/download — stream a workspace file from d6e Storage.
//
// Purpose:
//   The browser cannot attach Authorization: Bearer to d6e's Rust download
//   endpoint because the JWT lives in HTTP-only cookies. This same-origin
//   route reads the access token server-side, pins D6E_WORKSPACE_ID from env,
//   and streams upstream bytes back without exposing ${D6E_BASE_URL}.
//
// Main specifications:
//   - Authenticated via requireAccessToken() (auth-access cookie via hooks).
//   - fileId must be a UUID before forwarding upstream.
//   - Sets Authorization + X-Workspace-ID on upstream GET (path ws id ignored).
//   - Forwards Content-Type, Content-Disposition, Content-Length on success.
//   - Optional Accept header from the browser is relayed upstream.
//   - Upstream fetch is bounded by DOWNLOAD_TIMEOUT_MS combined with the
//     client abort signal (timeout -> 504, client abort -> 499), so a
//     stalled d6e cannot hold the function until the host's max duration.
//
// Limitations:
//   - Does not buffer the full file — streams upstream.body (see platform-timeouts).
//   - Upstream cap is 1 GB; this app typically serves smaller stored files.
//   - Never 302-redirect the browser to D6E_BASE_URL.

import { getD6eUrl, getD6eWorkspaceId } from '$lib/server/env';
import { requireAccessToken } from '$lib/server/session';

import type { RequestHandler } from './$types';

const CALLER_TAG = '/api/files/[fileId]/download';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Bounds the whole upstream transfer (headers + streamed body); sized per
// the platform-timeouts guidance (60-120s for tens of MB on slow links).
const DOWNLOAD_TIMEOUT_MS = 120_000;

export const GET: RequestHandler = async (event) => {
	const accessToken = requireAccessToken(event, CALLER_TAG);

	const fileId = event.params.fileId ?? '';
	if (!UUID_RE.test(fileId)) {
		return new Response('fileId must be a UUID', { status: 400 });
	}

	const apiUrl = getD6eUrl(CALLER_TAG);
	const workspaceId = getD6eWorkspaceId(CALLER_TAG);
	const upstreamUrl = `${apiUrl}/api/v1/workspaces/${workspaceId}/files/${fileId}/download`;

	const accept = event.request.headers.get('Accept');
	const upstreamHeaders: Record<string, string> = {
		Authorization: `Bearer ${accessToken}`,
		'X-Workspace-ID': workspaceId
	};
	if (accept) {
		upstreamHeaders.Accept = accept;
	}

	// AbortSignal.any() requires Node.js 20.3+, same as buildCombinedSignal
	// in src/lib/server/d6e-client.ts.
	const timeoutSignal = AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS);
	const upstreamSignal = AbortSignal.any([event.request.signal, timeoutSignal]);

	let upstream: Response;
	try {
		upstream = await fetch(upstreamUrl, {
			headers: upstreamHeaders,
			signal: upstreamSignal
		});
	} catch (err) {
		if (event.request.signal.aborted) {
			console.warn(`[${CALLER_TAG}] request aborted by client (fileId=${fileId})`);
			return new Response('Client Closed Request', { status: 499 });
		}
		if (timeoutSignal.aborted) {
			console.error(
				`[${CALLER_TAG}] upstream timed out after ${DOWNLOAD_TIMEOUT_MS / 1000}s (fileId=${fileId})`
			);
			return new Response('Storage API timed out', { status: 504 });
		}
		const msg = err instanceof Error ? err.message : String(err);
		console.error(`[${CALLER_TAG}] fetch failed (fileId=${fileId}): ${msg}`);
		return new Response('Failed to reach storage API', { status: 502 });
	}

	if (!upstream.ok) {
		const errText = await upstream.text();
		console.error(
			`[${CALLER_TAG}] upstream error (fileId=${fileId}, status=${upstream.status}): ${errText.slice(0, 500)}`
		);
		return new Response(errText || 'Download failed', { status: upstream.status });
	}

	const outHeaders = new Headers();
	for (const name of ['content-type', 'content-disposition', 'content-length']) {
		const value = upstream.headers.get(name);
		if (value) {
			outHeaders.set(name, value);
		}
	}

	if (!upstream.body) {
		return new Response('Empty response from storage API', { status: 502 });
	}

	return new Response(upstream.body, { status: 200, headers: outHeaders });
};
