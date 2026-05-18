// /auth/logout -- clear the session cookies and bounce to /auth/login.
//
// Purpose:
//   Allow the user to drop their access / refresh token cookies. The
//   actual JWTs remain valid on d6e-auth's side until the refresh
//   token rotates, but the local cookies are gone so the browser
//   immediately stops being able to talk to the d6e API.
//
// Main specifications:
//   - GET is supported for plain <a href> links.
//   - POST is supported so the sidebar can submit a CSRF-safe form.
//   - Both verbs delete the same three cookies and return 302 to
//     /auth/login.

import { redirect } from '@sveltejs/kit';

import { clearOauthStateCookie, clearSession } from '$lib/server/session';

import type { RequestHandler } from './$types';

function handle(event: Parameters<RequestHandler>[0]): never {
	clearSession(event);
	clearOauthStateCookie(event);
	throw redirect(302, '/auth/login');
}

export const GET: RequestHandler = async (event) => handle(event);
export const POST: RequestHandler = async (event) => handle(event);
