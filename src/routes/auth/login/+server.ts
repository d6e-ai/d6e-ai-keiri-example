// GET /auth/login -- starts the OAuth2 Authorization Code flow.
//
// Purpose:
//   Generates a CSRF state, writes it to a short-lived HTTP-only cookie,
//   and 302-redirects the user to d6e-auth's authorize page. The
//   ?returnTo= query (when present and a safe relative path) is folded
//   into the state cookie so /auth/callback can bounce the user back to
//   the deep link they originally tried to open.
//
// Main specifications:
//   - state cookie format: base64url(JSON({ state: string, returnTo: string }))
//   - Only same-origin paths starting with "/" (and not "//") are
//     accepted as returnTo to prevent open redirects.
//   - Paths under /auth/* are rejected as returnTo even though they
//     are same-origin: bouncing back to /auth/login after a successful
//     callback would just start a new OAuth round-trip, and because
//     d6e-auth's session cookie is still live, that round-trip would
//     complete silently and redirect to /auth/login again, looping
//     until the browser's redirect cap (~20 hops) trips
//     ERR_TOO_MANY_REDIRECTS.
//
// Limitations:
//   - This endpoint always issues a 302 and never renders HTML. If you
//     need a styled login splash, add +page.svelte and have it submit a
//     form to this URL.

import { redirect } from '@sveltejs/kit';

import { buildAuthorizeUrl, createOauthState } from '$lib/server/oauth';
import { writeOauthStateCookie } from '$lib/server/session';

import type { RequestHandler } from './$types';

const CALLER_TAG = '/auth/login';

function isSafeReturnTo(value: string): boolean {
	if (!value.startsWith('/')) return false;
	if (value.startsWith('//') || value.startsWith('/\\')) return false;
	// Block /auth and /auth/* so a crafted returnTo cannot trap the
	// post-login redirect inside the auth flow itself.
	if (value === '/auth' || value.startsWith('/auth/')) return false;
	return true;
}

function encodeStateCookieValue(state: string, returnTo: string): string {
	const payload = JSON.stringify({ state, returnTo });
	return Buffer.from(payload, 'utf8').toString('base64');
}

export const GET: RequestHandler = async (event) => {
	const requestedReturnTo = event.url.searchParams.get('returnTo') ?? '';
	const returnTo = isSafeReturnTo(requestedReturnTo) ? requestedReturnTo : '/';

	const state = createOauthState();
	writeOauthStateCookie(event, encodeStateCookieValue(state, returnTo));

	const authorizeUrl = buildAuthorizeUrl(CALLER_TAG, state);
	throw redirect(302, authorizeUrl);
};
