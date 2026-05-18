// GET /auth/callback -- finishes the OAuth2 Authorization Code flow.
//
// Purpose:
//   Verifies the CSRF state, exchanges the authorization code for a JWT
//   pair, RE-MINTS that pair at the b-button instance so the access
//   token has the audience expected by every Bearer endpoint under
//   ${D6E_BASE_URL}, then probes d6e (GET /api/v1/workspaces/{id}) to
//   make sure the user is a member of the workspace this app is tied
//   to. On success the b-button pair is written to HTTP-only cookies
//   and the user is bounced to the originally-requested URL. On
//   membership failure the user is sent to /auth/no-access (cookies
//   are cleared so they cannot see app data with a token that the d6e
//   API would reject anyway).
//
// Main specifications:
//   - state cookie format must match what /auth/login wrote:
//     base64url(JSON({ state, returnTo })). Mismatched / missing state
//     is treated as an open-redirect attempt and returns 400.
//   - Token exchange runs in TWO stages:
//       1. d6e-auth (${D6E_AUTH_URL}/api/v1/auth/token, authorization_code)
//          -> returns a pair signed with `iss=d6e-auth`.
//       2. b-button (${D6E_BASE_URL}/api/v1/auth/token, refresh_token)
//          -> returns a pair signed with the audience the API expects.
//     This mirrors how scripts/init-workspace.mjs upgrades its admin
//     refresh token before talking to the b-button API.
//   - Membership probe timeout: 10 seconds. Hard upstream errors fold
//     into /auth/no-access too, since we cannot prove membership.
//
// Limitations:
//   - We trust the JWT's sub/email/name claims for display purposes.
//     The Rust API still verifies the signature on every subsequent
//     call, so even a forged cookie would be rejected at that layer.

import { error, redirect } from '@sveltejs/kit';

import { D6eClientError, verifyWorkspaceMembership } from '$lib/server/d6e-client';
import {
	constantTimeEqual,
	exchangeAuthorizationCode,
	OauthError,
	refreshAccessTokenViaBaseUrl
} from '$lib/server/oauth';
import {
	clearOauthStateCookie,
	clearSession,
	decodeUserFromAccessToken,
	readOauthStateCookie,
	storeSession
} from '$lib/server/session';

import type { RequestHandler } from './$types';

const CALLER_TAG = '/auth/callback';

interface StateCookiePayload {
	state: string;
	returnTo: string;
}

function decodeStateCookieValue(raw: string | undefined): StateCookiePayload | null {
	if (!raw) return null;
	try {
		const json = Buffer.from(raw, 'base64').toString('utf8');
		const parsed = JSON.parse(json) as Partial<StateCookiePayload>;
		if (typeof parsed.state !== 'string' || typeof parsed.returnTo !== 'string') return null;
		if (
			!parsed.returnTo.startsWith('/') ||
			parsed.returnTo.startsWith('//') ||
			parsed.returnTo.startsWith('/\\')
		) {
			return { state: parsed.state, returnTo: '/' };
		}
		return { state: parsed.state, returnTo: parsed.returnTo };
	} catch {
		return null;
	}
}

export const GET: RequestHandler = async (event) => {
	const queryError = event.url.searchParams.get('error');
	if (queryError) {
		const description = event.url.searchParams.get('error_description') ?? '';
		console.warn(
			`[${CALLER_TAG}] d6e-auth returned error=${queryError} description=${description}`
		);
		clearOauthStateCookie(event);
		clearSession(event);
		throw redirect(302, '/auth/login');
	}

	const code = event.url.searchParams.get('code');
	const stateFromQuery = event.url.searchParams.get('state');
	if (!code || !stateFromQuery) {
		throw error(400, 'Missing code or state in callback URL');
	}

	const decoded = decodeStateCookieValue(readOauthStateCookie(event));
	clearOauthStateCookie(event);
	if (!decoded) {
		throw error(400, 'OAuth state cookie missing or unreadable');
	}
	if (!constantTimeEqual(decoded.state, stateFromQuery)) {
		throw error(400, 'OAuth state mismatch');
	}

	// Stage 1: d6e-auth issues a pair signed with `iss=d6e-auth`. The
	// b-button API rejects these as Bearer credentials (audience
	// mismatch), so we cannot use them directly.
	let authTokens;
	try {
		authTokens = await exchangeAuthorizationCode(CALLER_TAG, code);
	} catch (err) {
		if (err instanceof OauthError) {
			console.error(`[${CALLER_TAG}] token exchange failed: ${err.message}`);
		} else {
			const msg = err instanceof Error ? err.message : String(err);
			console.error(`[${CALLER_TAG}] token exchange unexpected error: ${msg}`);
		}
		throw redirect(302, '/auth/login');
	}

	// Stage 2: hand the d6e-auth refresh token to b-button, which
	// re-mints the pair against its own keypair. From this point on
	// every cookie value is a b-button-signed JWT.
	let tokens;
	try {
		tokens = await refreshAccessTokenViaBaseUrl(CALLER_TAG, authTokens.refreshToken);
	} catch (err) {
		if (err instanceof OauthError) {
			console.error(`[${CALLER_TAG}] b-button token exchange failed: ${err.message}`);
		} else {
			const msg = err instanceof Error ? err.message : String(err);
			console.error(`[${CALLER_TAG}] b-button token exchange unexpected error: ${msg}`);
		}
		throw redirect(302, '/auth/login');
	}

	let memberOk: boolean;
	try {
		memberOk = await verifyWorkspaceMembership(CALLER_TAG, tokens.accessToken);
	} catch (err) {
		const msg =
			err instanceof D6eClientError
				? err.message
				: err instanceof Error
					? err.message
					: String(err);
		console.error(`[${CALLER_TAG}] membership probe failed: ${msg}`);
		clearSession(event);
		throw redirect(302, '/auth/no-access');
	}
	if (!memberOk) {
		clearSession(event);
		throw redirect(302, '/auth/no-access');
	}

	const user = decodeUserFromAccessToken(tokens.accessToken);
	if (!user) {
		console.error(`[${CALLER_TAG}] could not decode user claims from access_token; aborting login`);
		clearSession(event);
		throw redirect(302, '/auth/login');
	}

	storeSession(event, tokens, user);
	throw redirect(302, decoded.returnTo || '/');
};
