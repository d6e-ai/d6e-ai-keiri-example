// Cookie-backed session storage for end-user OAuth tokens.
//
// Purpose:
//   Hide the cookie naming, attributes, and refresh logic behind a
//   single API. hooks.server.ts calls loadSession() at the top of every
//   request to populate event.locals.accessToken; /auth/callback calls
//   storeSession() after a successful authorization_code exchange;
//   /auth/logout (and any failure path) calls clearSession().
//
// Main specifications:
//   - storeSession(event, tokens, user): writes auth-access / auth-refresh
//     / auth-user cookies (HTTP-only, SameSite=Lax, Secure outside dev).
//   - clearSession(event): deletes all three cookies.
//   - loadSession(event): returns the current access token + user when
//     valid, transparently refreshing against the b-button instance
//     when the access token is within REFRESH_GRACE_MS of its expiry.
//     Refresh is intentionally aimed at the b-button token endpoint
//     (not d6e-auth) so the resulting access_token has the audience
//     every ${D6E_BASE_URL} Bearer endpoint expects. Returns null when
//     there is no session or refresh failed (caller should redirect
//     to /auth/login).
//   - OAUTH_STATE_COOKIE / readOauthStateCookie() / writeOauthStateCookie()
//     / clearOauthStateCookie() handle the short-lived CSRF state for
//     the /auth/login -> /auth/callback round-trip.
//
// Limitations:
//   - The user record (id / email / name) is stored as base64-encoded
//     JSON in the auth-user cookie. We do not re-fetch /api/v1/auth/userinfo
//     on every request because the JWT already authenticates the user
//     server-side; the cookie copy is purely for rendering "Hi <name>"
//     in the sidebar.
//   - JWT signature is not verified locally. d6e's API verifies it on
//     each call.

import { error, type RequestEvent } from '@sveltejs/kit';
import { dev } from '$app/environment';

import {
	decodeJwtExpMs,
	decodeJwtPayload,
	OauthError,
	refreshAccessTokenViaBaseUrl,
	type OauthTokens
} from './oauth';

const ACCESS_TOKEN_COOKIE = 'auth-access';
const REFRESH_TOKEN_COOKIE = 'auth-refresh';
const USER_COOKIE = 'auth-user';
export const OAUTH_STATE_COOKIE = 'auth-oauth-state';

// Refresh the access token this many milliseconds before its real exp
// so a slow upstream call cannot race the expiry.
const REFRESH_GRACE_MS = 60_000;

// Maximum lifetime of the refresh token cookie. d6e-auth issues refresh
// tokens with no built-in expiry today, but we still cap the cookie to
// 30 days so a forgotten cookie eventually disappears on its own.
const REFRESH_COOKIE_MAX_AGE_S = 60 * 60 * 24 * 30;

// Lifetime of the access token cookie when we cannot decode the exp.
// d6e-auth currently issues 1h tokens, so the fallback matches that.
const ACCESS_COOKIE_FALLBACK_MAX_AGE_S = 60 * 60;

// Short-lived state cookie that lives only between /auth/login and
// /auth/callback. 10 minutes is generous enough to cover a Google
// OAuth detour.
const OAUTH_STATE_COOKIE_MAX_AGE_S = 60 * 10;

// Module-level deduplication of concurrent refresh attempts, keyed by
// refresh token value. The b-button token endpoint rotates the
// refresh token on every successful use, so parallel requests
// carrying the same auth-refresh cookie (e.g. a multi-file upload
// firing several /api/upload calls while the access token sits in
// its grace window) would otherwise race: only one POST to
// ${D6E_BASE_URL}/api/v1/auth/token would succeed and the rest
// would fail, calling clearSession() and emitting cookie-delete
// Set-Cookie headers that can clobber the successful sibling's
// fresh-token headers and log the user out. Sharing a single
// in-flight Promise means every concurrent caller receives the same
// OauthTokens and writes identical cookies to their own response.
const inflightRefreshes = new Map<string, Promise<OauthTokens>>();

function refreshAccessTokenDeduped(caller: string, refreshToken: string): Promise<OauthTokens> {
	const existing = inflightRefreshes.get(refreshToken);
	if (existing) return existing;
	// Refresh against b-button (not d6e-auth) so the new access
	// token is signed for the audience that ${D6E_BASE_URL}'s
	// Bearer endpoints verify.
	const promise = refreshAccessTokenViaBaseUrl(caller, refreshToken).finally(() => {
		inflightRefreshes.delete(refreshToken);
	});
	inflightRefreshes.set(refreshToken, promise);
	return promise;
}

export interface SessionUser {
	id: string;
	email: string;
	name: string;
}

export interface Session {
	accessToken: string;
	user: SessionUser;
}

const cookieDefaults = (maxAgeSeconds: number) =>
	({
		path: '/',
		httpOnly: true,
		sameSite: 'lax' as const,
		secure: !dev,
		maxAge: maxAgeSeconds
	}) satisfies Parameters<RequestEvent['cookies']['set']>[2];

function maxAgeFromAccessToken(token: string): number {
	const expMs = decodeJwtExpMs(token);
	if (!expMs) return ACCESS_COOKIE_FALLBACK_MAX_AGE_S;
	const remainingMs = expMs - Date.now();
	if (remainingMs <= 0) return ACCESS_COOKIE_FALLBACK_MAX_AGE_S;
	return Math.floor(remainingMs / 1000);
}

function encodeUserCookie(user: SessionUser): string {
	return Buffer.from(JSON.stringify(user), 'utf8').toString('base64');
}

function decodeUserCookie(value: string): SessionUser | null {
	try {
		const json = Buffer.from(value, 'base64').toString('utf8');
		const parsed = JSON.parse(json) as Partial<SessionUser>;
		if (
			typeof parsed.id !== 'string' ||
			typeof parsed.email !== 'string' ||
			typeof parsed.name !== 'string'
		) {
			return null;
		}
		return { id: parsed.id, email: parsed.email, name: parsed.name };
	} catch {
		return null;
	}
}

// Decode the sub/email/name JWT claims so /auth/callback can build a
// SessionUser without an extra round trip to /api/v1/auth/userinfo.
export function decodeUserFromAccessToken(token: string): SessionUser | null {
	const claims = decodeJwtPayload(token);
	if (!claims) return null;
	if (typeof claims.sub !== 'string') return null;
	const email = typeof claims.email === 'string' ? claims.email : '';
	const name = typeof claims.name === 'string' ? claims.name : email;
	return { id: claims.sub, email, name };
}

export function storeSession(event: RequestEvent, tokens: OauthTokens, user: SessionUser): void {
	event.cookies.set(
		ACCESS_TOKEN_COOKIE,
		tokens.accessToken,
		cookieDefaults(maxAgeFromAccessToken(tokens.accessToken))
	);
	event.cookies.set(
		REFRESH_TOKEN_COOKIE,
		tokens.refreshToken,
		cookieDefaults(REFRESH_COOKIE_MAX_AGE_S)
	);
	event.cookies.set(USER_COOKIE, encodeUserCookie(user), cookieDefaults(REFRESH_COOKIE_MAX_AGE_S));
}

export function clearSession(event: RequestEvent): void {
	for (const name of [ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE, USER_COOKIE]) {
		event.cookies.delete(name, { path: '/' });
	}
}

/**
 * Read the current session from cookies. When the access token is
 * about to expire (within REFRESH_GRACE_MS) and a refresh token is
 * available, transparently exchange it for a fresh pair and update
 * the cookies in-place. Returns null if there is no session or the
 * refresh round-trip failed; the caller (hooks.server.ts) should then
 * redirect to /auth/login.
 */
export async function loadSession(event: RequestEvent): Promise<Session | null> {
	const accessToken = event.cookies.get(ACCESS_TOKEN_COOKIE);
	const refreshToken = event.cookies.get(REFRESH_TOKEN_COOKIE);
	const userCookie = event.cookies.get(USER_COOKIE);

	if (!accessToken && !refreshToken) {
		return null;
	}

	let user = userCookie ? decodeUserCookie(userCookie) : null;

	if (accessToken) {
		const expMs = decodeJwtExpMs(accessToken);
		// A null exp means the JWT lacks a parseable expiry claim. Treat
		// it as "expires now" rather than "permanently fresh" so we still
		// attempt a proactive refresh; otherwise a malformed token would
		// keep flowing to d6e and fail with 401 until the cookie naturally
		// expires.
		const expiresSoon = expMs === null || expMs - Date.now() <= REFRESH_GRACE_MS;
		if (!expiresSoon) {
			// Access token is still good. Fall back to claims if we lost
			// the user cookie for some reason.
			if (!user) user = decodeUserFromAccessToken(accessToken);
			if (!user) {
				clearSession(event);
				return null;
			}
			return { accessToken, user };
		}
	}

	if (!refreshToken) {
		clearSession(event);
		return null;
	}

	let refreshed: OauthTokens;
	try {
		refreshed = await refreshAccessTokenDeduped('session.loadSession', refreshToken);
	} catch (err) {
		const msg =
			err instanceof OauthError ? err.message : err instanceof Error ? err.message : String(err);
		console.error(`[session] refresh failed; clearing cookies: ${msg}`);
		clearSession(event);
		return null;
	}

	if (!user) {
		user = decodeUserFromAccessToken(refreshed.accessToken);
	}
	if (!user) {
		clearSession(event);
		return null;
	}

	storeSession(event, refreshed, user);
	return { accessToken: refreshed.accessToken, user };
}

export function writeOauthStateCookie(event: RequestEvent, state: string): void {
	event.cookies.set(OAUTH_STATE_COOKIE, state, cookieDefaults(OAUTH_STATE_COOKIE_MAX_AGE_S));
}

export function readOauthStateCookie(event: RequestEvent): string | undefined {
	return event.cookies.get(OAUTH_STATE_COOKIE);
}

export function clearOauthStateCookie(event: RequestEvent): void {
	event.cookies.delete(OAUTH_STATE_COOKIE, { path: '/' });
}

/**
 * Route-handler convenience: return event.locals.accessToken or throw
 * a 401 SvelteKit error. hooks.server.ts already redirects browsers
 * that arrive without a session, but fetch() calls from the client
 * (e.g. /api/intent) hit the route handler directly with a 401-able
 * response instead.
 */
export function requireAccessToken(event: RequestEvent, caller: string): string {
	const token = event.locals.accessToken;
	if (!token) {
		console.warn(`[session] requireAccessToken: no access token on event.locals (${caller})`);
		throw error(401, 'Not authenticated');
	}
	return token;
}
