// OAuth2 Authorization Code Flow brokered through the d6e instance.
//
// Purpose:
//   This module drives the login that backs every Bearer call to the
//   d6e instance (${D6E_BASE_URL}). The user logs in on d6e-auth's
//   hosted page, but BOTH the authorization-code exchange and every
//   later refresh hit the d6e INSTANCE's own token endpoint
//   (${D6E_BASE_URL}/api/v1/auth/token). The instance injects its own
//   OAuth client credentials when relaying to d6e-auth, so the pair it
//   returns already carries the audience the instance accepts on Bearer
//   calls. This frontend therefore never holds a client secret.
//
// Main specifications:
//   - buildAuthorizeUrl(state): returns the absolute URL of the login
//     page on d6e-auth. client_id is the d6e INSTANCE's OAuth client id
//     (D6E_AUTH_CLIENT_ID mirrors the instance's own value); redirect_uri
//     must be registered on d6e-auth (per-workspace or instance-wide).
//   - exchangeAuthorizationCode(caller, code): POSTs grant_type=
//     authorization_code to ${D6E_BASE_URL}/api/v1/auth/token. No client
//     credentials are sent; the instance adds them before forwarding to
//     d6e-auth and returns a pair signed for its own audience.
//   - refreshAccessTokenViaBaseUrl(caller, refreshToken): POSTs
//     grant_type=refresh_token to the same instance endpoint. Used by
//     session.ts for proactive refresh near expiry.
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
//   - The token endpoint is treated as synchronous; we apply a 30
//     second timeout so a hung upstream does not block the SvelteKit
//     hook pipeline indefinitely.
//   - A standalone-client variant (the frontend registers its own
//     d6e-auth client and re-mints via refresh) is documented in
//     skills/d6e-auth-integration/SKILL.md for deployments that cannot
//     register a redirect URI on the d6e instance they use.

import { getD6eAuthClientId, getD6eAuthRedirectUri, getD6eAuthUrl, getD6eUrl } from './env';

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
// back to redirect_uri once login succeeds. client_id here is the d6e
// INSTANCE's OAuth client id (D6E_AUTH_CLIENT_ID mirrors the instance's
// own value) so the code can later be exchanged at the instance.
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

// Decode (without verifying) the payload segment of a JWT and return
// it as a plain object. Returns null when the token does not have at
// least two dot-separated segments or the middle segment fails to
// parse as JSON. Centralising the base64url normalisation here means
// any future fix (e.g. handling additional edge cases) only has to
// land in one place.
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
	const parts = token.split('.');
	if (parts.length < 2) return null;
	const segment = parts[1];
	const padLen = (4 - (segment.length % 4)) % 4;
	const normalized = segment.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(padLen);
	try {
		const parsed: unknown = JSON.parse(Buffer.from(normalized, 'base64').toString('utf8'));
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
		return parsed as Record<string, unknown>;
	} catch {
		return null;
	}
}

// Decode the exp claim from a JWT without verifying the signature.
// Returns the expiry in milliseconds since epoch, or null when the
// token does not look like a JWT or carries no exp claim.
export function decodeJwtExpMs(token: string): number | null {
	const payload = decodeJwtPayload(token);
	if (!payload) return null;
	const exp = payload.exp;
	if (typeof exp !== 'number' || !Number.isFinite(exp) || exp <= 0) return null;
	return exp * 1000;
}

// Exchange the authorization code for a token pair at the d6e instance.
// The instance relays the code to d6e-auth with its OWN client
// credentials, so the pair it returns is already signed for the
// audience every ${D6E_BASE_URL} Bearer endpoint accepts -- this
// frontend holds no client secret. redirect_uri must be present; d6e-auth
// validates it (instance-wide or per-workspace registration).
export async function exchangeAuthorizationCode(
	caller: string,
	code: string
): Promise<OauthTokens> {
	const baseUrl = getD6eUrl(caller);
	const redirectUri = getD6eAuthRedirectUri(caller);

	return postTokenEndpoint(caller, `${baseUrl}/api/v1/auth/token`, {
		grant_type: 'authorization_code',
		code,
		redirect_uri: redirectUri
	});
}

/**
 * Refresh the session at the d6e instance's token endpoint. session.ts
 * calls this when the access token nears expiry. The instance accepts
 * the stored refresh token and returns a fresh pair signed for its own
 * audience -- the same endpoint exchangeAuthorizationCode uses. No
 * client_id / client_secret is sent: the instance injects its own
 * credentials before relaying the grant to d6e-auth.
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
