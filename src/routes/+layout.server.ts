// Root layout server load.
//
// Purpose:
//   Surface event.locals.user (populated by hooks.server.ts from the
//   auth cookies) on page data so the sidebar component can render
//   the signed-in user's name without an extra round-trip.
//
// Main specifications:
//   - Returns { user } where user is either a SessionUser or undefined.
//     SvelteKit serialises this to the browser, but since the sidebar
//     uses the value purely for display it is acceptable to ship the
//     non-sensitive fields (id, email, name) to the client.
//
// Limitations:
//   - The auth-access / auth-refresh cookies are HTTP-only, so the
//     browser cannot read them; we only re-emit the safe display
//     fields here.

import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
	return {
		user: locals.user
	};
};
