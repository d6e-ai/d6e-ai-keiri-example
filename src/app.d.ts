// See https://svelte.dev/docs/kit/types#app.d.ts
import type { SessionUser } from '$lib/server/session';

declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			// JWT access token of the currently logged-in user. Populated by
			// hooks.server.ts from the auth-access cookie (with automatic
			// refresh via the auth-refresh cookie when about to expire).
			// Undefined on unauthenticated requests; route handlers under
			// /auth/* are the only places that should observe undefined.
			accessToken?: string;
			// Display-only user record decoded from the JWT's sub/email/name
			// claims. Same caveats as accessToken.
			user?: SessionUser;
		}
		interface PageData {
			// Mirrors locals.user so client-side layouts can render the
			// signed-in user's name without an extra fetch.
			user?: SessionUser;
		}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
