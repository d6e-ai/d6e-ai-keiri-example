// SvelteKit server hook -- runs on every server-side request.
//
// Purpose:
//   - Loads the OAuth session from cookies and exposes the access
//     token + user record via event.locals so route handlers and
//     SSR loaders can read them without re-implementing cookie /
//     refresh logic.
//   - Forces unauthenticated page navigations onto /auth/login with
//     a returnTo so the user resumes where they intended after login.
//
// Main specifications:
//   - Skips redirect for any path under /auth/* so /auth/login,
//     /auth/callback, /auth/logout, and /auth/no-access can run
//     anonymously.
//   - Skips redirect for /api/* so client-side fetch() calls (e.g.
//     /api/intent, /api/upload) reach their route handlers and get a
//     clean 401 JSON response via requireAccessToken() instead of a
//     302 to /auth/login. Following the redirect chain from the
//     browser would cross origins (to d6e-auth) and produce CORS
//     errors or HTML responses that the client cannot recover from.
//   - Also skips for SvelteKit internal asset paths (/.well-known
//     and immutable assets are served before this hook anyway, but
//     we leave a small safety net for /favicon.ico).
//   - Refresh failures inside loadSession() already clear the
//     cookies; the hook just observes session === null and
//     redirects to /auth/login when needed.
//
// Limitations:
//   - There is no per-request workspace membership probe. We only
//     check membership at /auth/callback. If the user gets removed
//     from the workspace mid-session the d6e API will start
//     returning 403, and the next refresh / 401 retry will not
//     bring them back; manual logout will be required.

import { redirect, type Handle } from '@sveltejs/kit';

import { loadSession } from '$lib/server/session';

const PUBLIC_PATH_PREFIXES = ['/auth/'];
const PUBLIC_EXACT_PATHS = new Set<string>(['/favicon.ico']);
const API_PATH_PREFIX = '/api/';

function isPublicPath(pathname: string): boolean {
	if (PUBLIC_EXACT_PATHS.has(pathname)) return true;
	for (const prefix of PUBLIC_PATH_PREFIXES) {
		if (pathname.startsWith(prefix)) return true;
	}
	return false;
}

function isApiPath(pathname: string): boolean {
	return pathname.startsWith(API_PATH_PREFIX);
}

export const handle: Handle = async ({ event, resolve }) => {
	const session = await loadSession(event);
	if (session) {
		event.locals.accessToken = session.accessToken;
		event.locals.user = session.user;
	}

	if (!session && !isPublicPath(event.url.pathname) && !isApiPath(event.url.pathname)) {
		const returnTo = `${event.url.pathname}${event.url.search}`;
		const params = new URLSearchParams();
		if (returnTo && returnTo !== '/') params.set('returnTo', returnTo);
		const query = params.toString();
		throw redirect(302, `/auth/login${query ? `?${query}` : ''}`);
	}

	return resolve(event);
};
