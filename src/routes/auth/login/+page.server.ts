// /auth/login -- server side of the deliberate login splash page.
//
// Purpose:
//   Replaces the previous GET +server.ts that immediately bounced the
//   browser to d6e-auth. The page now renders a real login screen and
//   only kicks off the OAuth2 Authorization Code flow when the user
//   actively submits the "Sign in with d6e" form. Combined with the
//   logout button on /auth/no-access this lets a user who logged in
//   with the wrong account switch to a different one (d6e-auth's own
//   session cookie is destroyed first by /auth/logout, so the login
//   page no longer silently re-authenticates them).
//
// Main specifications:
//   - load({ url }): reads ?returnTo=<safe relative path> and exposes it
//     to +page.svelte as data.returnTo so the value survives across the
//     form submission via a hidden input. Unsafe values fall back to '/'.
//   - actions.default(event): re-validates the returnTo carried in the
//     form, generates an OAuth state value, writes the encoded
//     (state, returnTo) tuple to the short-lived CSRF cookie, then
//     303-redirects to d6e-auth's authorize page. The state cookie
//     format matches what /auth/callback's decodeStateCookieValue
//     expects so the existing callback handler keeps working unchanged.
//   - isSafeReturnTo() blocks open-redirect attempts: only same-origin
//     paths starting with "/" are allowed, and /auth/* targets are
//     rejected so a crafted returnTo cannot trap the post-login
//     redirect inside the auth flow itself.
//
// Limitations:
//   - There is no rate-limit guard here; excessive traffic is handled
//     upstream by d6e-auth's /auth/authorize endpoint.
//   - The action does not surface upstream failures back to the page;
//     it always throws a redirect. The OAuth state mismatch / token
//     exchange failure paths are handled inside /auth/callback.

import { redirect } from '@sveltejs/kit';

import { buildAuthorizeUrl, createOauthState } from '$lib/server/oauth';
import { writeOauthStateCookie } from '$lib/server/session';

import type { Actions, PageServerLoad } from './$types';

const CALLER_TAG = '/auth/login';

function isSafeReturnTo(value: string): boolean {
	if (!value.startsWith('/')) return false;
	if (value.startsWith('//') || value.startsWith('/\\')) return false;
	if (value === '/auth' || value.startsWith('/auth/')) return false;
	return true;
}

function sanitizeReturnTo(raw: string | null | undefined): string {
	if (!raw) return '/';
	return isSafeReturnTo(raw) ? raw : '/';
}

function encodeStateCookieValue(state: string, returnTo: string): string {
	const payload = JSON.stringify({ state, returnTo });
	return Buffer.from(payload, 'utf8').toString('base64');
}

export const load: PageServerLoad = async ({ url }) => {
	const returnTo = sanitizeReturnTo(url.searchParams.get('returnTo'));
	return { returnTo };
};

export const actions: Actions = {
	default: async (event) => {
		const formData = await event.request.formData();
		const rawReturnTo = formData.get('returnTo');
		const returnTo = sanitizeReturnTo(typeof rawReturnTo === 'string' ? rawReturnTo : null);

		const state = createOauthState();
		writeOauthStateCookie(event, encodeStateCookieValue(state, returnTo));

		const authorizeUrl = buildAuthorizeUrl(CALLER_TAG, state);
		throw redirect(303, authorizeUrl);
	}
};
