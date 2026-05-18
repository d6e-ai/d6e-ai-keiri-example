// OAuth2 Authorization Code Flow against d6e-auth + b-button.
//
// Purpose:
//   This module is the single place that knows how to talk to BOTH
//   the central d6e-auth (https://www.d6e.ai) token endpoint AND the
//   per-instance b-button (${D6E_BASE_URL}) token endpoint. Login
//   happens at d6e-auth; the resulting refresh token is then exchanged
//   at b-button so the access_token has the audience b-button itself
//   accepts on every Bearer call.
//
// Main specifications:
//   - buildAuthorizeUrl(state): returns the absolute URL of the login
//     page on d6e-auth with the client_id / redirect_uri / state query
//     parameters that d6e-auth's /auth/login page expects.
//   - exchangeAuthorizationCode(caller, code): POSTs to
//     ${D6E_AUTH_URL}/api/v1/auth/token with grant_type=authorization_code
//     and returns the resulting tokens + expiry. The access_token in the
//     response has `iss=d6e-auth` and is NOT a valid Bearer for b-button.
//   - refreshAccessTokenViaBaseUrl(caller, refreshToken): POSTs to
//     ${D6E_BASE_URL}/api/v1/auth/token with grant_type=refresh_token.
//     b-button accepts d6e-auth-issued refresh tokens here and returns
//     a fresh pair signed for its own audience. This is the variant
//     /auth/callback and session.ts use.
//   - createOauthState(): cryptographically random opaque string used
//     as the CSRF state parameter; stored in a short-lived cookie by
//     /auth/login and verified by /auth/callback.
//   - decodeJwtExpMs(token): pulls the JWT exp claim out of an access
//     token (milliseconds since epoch). Returns null if the token is
//     not a parseable JWT.
//
// Limitations:
//   - We do NOT verify the JWT signature locally. d6e's Rust API
//     verifies it on every request, and the cookie is HTTP-only so an
//     attacker cannot forge one client-side. Local exp parsing is for
//     deciding when to refresh proactively, not for authorization.
//   - Both token endpoints are treated as synchronous; we apply a
//     30 second timeout so a hung upstream does not block the
//     SvelteKit hook pipeline indefinitely.

import {
	getD6eAuthClientId,
	getD6eAuthClientSecret,
	getD6eAuthRedirectUri,
	getD6eAuthUrl,
	getD6eUrl
} from './env';

const TOKEN_REQUEST_TIMEOUT_MS = 30_000;

export interface OauthTokens {
	accessToken: string;
	refreshToken: string;
	// Wall-clock time (ms since epoch) when the access_token expires.
	// Computed from the JWT exp claim when present, otherwise fell back
	// to (now + expires_in * 1000) using the value reported by d6e-auth.
	accessExpiresAtMs: number;
}

export class OauthError extends Error {
	readonly status: number;
	readonly upstreamBody: string;
	constructor(message: string, status: number, upstreamBody: string) {
		super(message);
		this.name = 'OauthError';
		this.status = status;
		this.upstreamBody = upstreamBody;
	}
}

// Build the URL the user should be redirected to in order to log in.
// d6e-auth's /auth/login page renders the email/password form when
// client_id + redirect_uri are present and posts an authorization_code
// back to redirect_uri once login succeeds.
export function buildAuthorizeUrl(caller: string, state: string): string {
	const authUrl = getD6eAuthUrl(caller);
	const clientId = getD6eAuthClientId(caller);
	const redirectUri = getD6eAuthRedirectUri(caller);
	const params = new URLSearchParams({
		client_id: clientId,
		redirect_uri: redirectUri,
		state,
		response_type: 'code'
	});
	return `${authUrl}/auth/login?${params.toString()}`;
}

// Generate a cryptographically random opaque string used as the OAuth
// state parameter. 32 random bytes, base64url-encoded -> ~43 chars.
export function createOauthState(): string {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	return base64UrlEncode(bytes);
}

// Constant-time string comparison so a malicious client cannot probe
// the state value with timing attacks. We deliberately avoid an early
// return on length mismatch so the loop always walks the longer of
// the two strings; charCodeAt() returns NaN past the end of a string,
// which coerces to 0 under bitwise XOR, and the length XOR seeded
// into `diff` ensures unequal-length inputs still compare unequal.
export function constantTimeEqual(a: string, b: string): boolean {
	let diff = a.length ^ b.length;
	const len = Math.max(a.length, b.length);
	for (let i = 0; i < len; i += 1) {
		diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	return diff === 0;
}

// Decode the exp claim from a JWT without verifying the signature.
// Returns the expiry in milliseconds since epoch, or null when the
// token does not look like a JWT or carries no exp claim.
export function decodeJwtExpMs(token: string): number | null {
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

export async function exchangeAuthorizationCode(
	caller: string,
	code: string
): Promise<OauthTokens> {
	const authUrl = getD6eAuthUrl(caller);
	const clientId = getD6eAuthClientId(caller);
	const clientSecret = getD6eAuthClientSecret(caller);
	const redirectUri = getD6eAuthRedirectUri(caller);

	return postTokenEndpoint(caller, `${authUrl}/api/v1/auth/token`, {
		grant_type: 'authorization_code',
		code,
		client_id: clientId,
		client_secret: clientSecret,
		redirect_uri: redirectUri
	});
}

/**
 * Re-mint a refresh token at the b-button instance so the resulting
 * access_token has the audience expected by all `${D6E_BASE_URL}`
 * Bearer endpoints (file storage, workspaces, execute-by-intent).
 *
 * b-button's `/api/v1/auth/token` accepts a d6e-auth-issued refresh
 * token as input and returns a fresh pair signed for itself — the
 * same trick `scripts/init-workspace.mjs` uses. No `client_id` /
 * `client_secret` is required against this endpoint because the
 * b-button instance already knows which OAuth client backs it.
 */
export async function refreshAccessTokenViaBaseUrl(
	caller: string,
	refreshToken: string
): Promise<OauthTokens> {
	const baseUrl = getD6eUrl(caller);
	return postTokenEndpoint(caller, `${baseUrl}/api/v1/auth/token`, {
		grant_type: 'refresh_token',
		refresh_token: refreshToken
	});
}

interface RawTokenResponse {
	access_token?: string;
	refresh_token?: string;
	expires_in?: number;
}

async function postTokenEndpoint(
	caller: string,
	url: string,
	body: Record<string, string>
): Promise<OauthTokens> {
	let response: Response;
	try {
		response = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS)
		});
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		throw new OauthError(
			`[oauth] postTokenEndpoint: network error talking to ${url} (caller=${caller}, grant=${body.grant_type}): ${msg}`,
			502,
			''
		);
	}

	const text = await response.text().catch(() => '');
	if (!response.ok) {
		throw new OauthError(
			`[oauth] postTokenEndpoint: ${url} rejected request (caller=${caller}, grant=${body.grant_type}): status=${response.status} body=${text.slice(0, 500)}`,
			response.status,
			text
		);
	}

	let parsed: RawTokenResponse;
	try {
		parsed = JSON.parse(text);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		throw new OauthError(
			`[oauth] postTokenEndpoint: ${url} returned non-JSON body (caller=${caller}): ${msg}`,
			502,
			text
		);
	}

	if (!parsed.access_token || !parsed.refresh_token) {
		throw new OauthError(
			`[oauth] postTokenEndpoint: response missing access_token or refresh_token (caller=${caller}): body=${text.slice(0, 500)}`,
			502,
			text
		);
	}

	const expFromJwt = decodeJwtExpMs(parsed.access_token);
	const ttlFromBody =
		typeof parsed.expires_in === 'number' && parsed.expires_in > 0
			? parsed.expires_in * 1000
			: 60 * 60 * 1000;
	const accessExpiresAtMs = expFromJwt ?? Date.now() + ttlFromBody;

	return {
		accessToken: parsed.access_token,
		refreshToken: parsed.refresh_token,
		accessExpiresAtMs
	};
}

function base64UrlEncode(bytes: Uint8Array): string {
	const b64 = Buffer.from(bytes).toString('base64');
	return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
