// Server-side access token manager for the d6e Rust API and SvelteKit
// frontend.
//
// The app stores only a long-lived refresh token (D6E_REFRESH_TOKEN) on
// the server. Whenever a route handler needs to call into d6e, it asks
// this module for an access token via getAccessToken(). The token is
// held in memory and refreshed automatically when:
//   - the cache is empty (first request after process start), or
//   - the cached token is within EXPIRY_GRACE_MS of its `exp` claim.
//
// Refresh target:
//   We hit `${D6E_FRONTEND_URL}/api/v1/auth/token` (the d6e frontend's
//   own token endpoint) rather than a central d6e-auth instance. The
//   frontend (b-button) proxies refresh through to its own Rust API,
//   which:
//     - accepts only `grant_type` + `refresh_token` (no client_id /
//       client_secret required),
//     - issues tokens whose `aud` claim matches the OAuth client that
//       backs the configured `b-button` instance — exactly what
//       verifyAccessToken on the same instance expects.
//   Routing through `b-button` therefore removes a whole class of
//   "audience mismatch" / "invalid_client" failures that you get when
//   the central d6e-auth instance issues tokens for a different client
//   than the one validating them on the b-button side.
//
// Concurrent callers reuse a single in-flight refresh Promise so that
// simultaneous requests do not trigger multiple round-trips to d6e.
//
// Limitations:
//   - Cache lives in the Node process memory; serverless cold starts
//     will issue a fresh refresh on every cold invocation, but that is
//     fast (<200ms) and safe.
//   - Refresh failures (4xx) are surfaced verbatim to the caller. They
//     usually indicate that the refresh token rotated outside of this
//     process (e.g. someone logged in again in the same browser) and
//     the value in D6E_REFRESH_TOKEN must be updated.

import { getD6eFrontendUrl, getD6eRefreshToken } from './env';

interface CachedToken {
	accessToken: string;
	expiresAtMs: number;
}

// Refresh `EXPIRY_GRACE_MS` before the access token actually expires so
// that callers never get a 401 due to clock skew or in-flight network
// latency.
const EXPIRY_GRACE_MS = 60_000;

// Fallback TTL when the access token cannot be decoded (should not
// happen in practice, but keeps the cache from becoming permanently
// stale).
const DEFAULT_TTL_MS = 60 * 60 * 1000;

let cached: CachedToken | null = null;
let inflight: Promise<CachedToken> | null = null;

function decodeJwtExpMs(token: string): number | null {
	const parts = token.split('.');
	if (parts.length < 2) return null;
	const segment = parts[1];
	const padLen = (4 - (segment.length % 4)) % 4;
	const normalized = segment.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(padLen);
	let payload: { exp?: number };
	try {
		payload = JSON.parse(Buffer.from(normalized, 'base64').toString('utf8'));
	} catch {
		return null;
	}
	if (!payload.exp || !Number.isFinite(payload.exp)) return null;
	return payload.exp * 1000;
}

async function performRefresh(caller: string): Promise<CachedToken> {
	const frontendUrl = getD6eFrontendUrl(caller);
	const refreshToken = getD6eRefreshToken(caller);

	const target = `${frontendUrl}/api/v1/auth/token`;
	let response: Response;
	try {
		response = await fetch(target, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				grant_type: 'refresh_token',
				refresh_token: refreshToken
			})
		});
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		throw new Error(
			`[d6e-token] performRefresh: network error talking to ${target} (caller=${caller}): ${msg}`
		);
	}

	const responseText = await response.text().catch(() => '');
	if (!response.ok) {
		throw new Error(
			`[d6e-token] performRefresh: ${target} rejected refresh (caller=${caller}): ` +
				`status=${response.status} body=${responseText}. ` +
				`Likely cause: D6E_REFRESH_TOKEN was rotated in another session — ` +
				`copy the latest auth-refresh cookie value into .env.`
		);
	}

	let parsed: { access_token?: string; expires_in?: number };
	try {
		parsed = JSON.parse(responseText);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		throw new Error(
			`[d6e-token] performRefresh: ${target} returned non-JSON body (caller=${caller}): ${msg}`
		);
	}

	if (!parsed.access_token) {
		throw new Error(
			`[d6e-token] performRefresh: response missing access_token (caller=${caller}): ` +
				`body=${responseText}`
		);
	}

	const expFromJwt = decodeJwtExpMs(parsed.access_token);
	const ttlFromBody =
		typeof parsed.expires_in === 'number' && parsed.expires_in > 0
			? parsed.expires_in * 1000
			: DEFAULT_TTL_MS;
	const expiresAtMs = expFromJwt ?? Date.now() + ttlFromBody;

	return { accessToken: parsed.access_token, expiresAtMs };
}

/**
 * Return a currently-valid access token, refreshing it via the d6e
 * frontend's token endpoint when the cached value is missing or about
 * to expire. Concurrent callers share a single inflight refresh
 * promise.
 *
 * @param caller Short tag (e.g. "/api/upload") used in diagnostics so
 *               that a refresh failure can be traced back to the
 *               originating route.
 */
export async function getAccessToken(caller: string): Promise<string> {
	const now = Date.now();
	if (cached && cached.expiresAtMs - now > EXPIRY_GRACE_MS) {
		return cached.accessToken;
	}

	if (!inflight) {
		inflight = performRefresh(caller)
			.then((token) => {
				cached = token;
				return token;
			})
			.finally(() => {
				inflight = null;
			});
	}

	const token = await inflight;
	return token.accessToken;
}

/**
 * Drop the cached access token so the next caller forces a refresh.
 * Useful after an upstream 401 (the token might still look valid
 * locally but have been revoked by the server).
 */
export function invalidateAccessToken(): void {
	cached = null;
}
