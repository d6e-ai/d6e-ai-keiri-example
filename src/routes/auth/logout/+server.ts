// /auth/logout -- clear local session cookies AND d6e-auth's session,
// then bounce back to /auth/login.
//
// Purpose:
//   A bare local cookie wipe is not enough for an OAuth flow: d6e-auth
//   still holds the user's own session cookie, so the very next
//   /auth/login -> ${D6E_AUTH_URL}/auth/login hop would silently
//   re-issue an authorization_code and put the user right back in.
//   To break that loop we delegate to d6e-auth's own logout endpoint,
//   which deletes its session row + cookie before sending the browser
//   back to a URL we choose via `redirect_uri`.
//
// Main specifications:
//   - GET is supported for plain <a href> links.
//   - POST is supported so the sidebar can submit a CSRF-safe form.
//   - Both verbs:
//       1. Wipe the auth-access / auth-refresh / auth-user / auth-oauth-state
//          cookies on THIS origin.
//       2. 303-redirect the browser to
//          ${D6E_AUTH_URL}/auth/logout?redirect_uri=<this app's /auth/login>.
//          d6e-auth deletes its own session cookie and forwards the
//          browser to the supplied `redirect_uri`.
//       3. The user lands on /auth/login here, which kicks off a fresh
//          OAuth round-trip — but because d6e-auth no longer has a
//          session for the user, they actually see the login form.
//   - The terminal log line `[/auth/logout]` makes it obvious in dev
//     whether the form submission reached the server at all.
//
// Limitations:
//   - If `D6E_AUTH_URL` is unreachable, the user is still locally
//     signed out (cookies are cleared synchronously), they just
//     cannot complete the d6e-auth-side cleanup until the upstream
//     comes back. The browser will see a regular network error in
//     that case.

import { redirect } from '@sveltejs/kit';

import { getD6eAuthUrl } from '$lib/server/env';
import { clearOauthStateCookie, clearSession } from '$lib/server/session';

import type { RequestHandler } from './$types';

const CALLER_TAG = '/auth/logout';

function buildUpstreamLogoutUrl(event: Parameters<RequestHandler>[0]): string {
	const authUrl = getD6eAuthUrl(CALLER_TAG);
	const redirectUri = `${event.url.origin}/auth/login`;
	const params = new URLSearchParams({ redirect_uri: redirectUri });
	return `${authUrl}/auth/logout?${params.toString()}`;
}

function handle(event: Parameters<RequestHandler>[0], method: 'GET' | 'POST'): never {
	const had = {
		access: Boolean(event.cookies.get('auth-access')),
		refresh: Boolean(event.cookies.get('auth-refresh')),
		user: Boolean(event.cookies.get('auth-user'))
	};
	console.info(
		`[${CALLER_TAG}] ${method} received; clearing cookies (had access=${had.access} refresh=${had.refresh} user=${had.user})`
	);
	clearSession(event);
	clearOauthStateCookie(event);

	const target = buildUpstreamLogoutUrl(event);
	console.info(`[${CALLER_TAG}] redirecting browser to upstream logout: ${target}`);
	throw redirect(303, target);
}

export const GET: RequestHandler = async (event) => handle(event, 'GET');
export const POST: RequestHandler = async (event) => handle(event, 'POST');
