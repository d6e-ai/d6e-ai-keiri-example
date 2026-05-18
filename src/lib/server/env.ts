// Server-only environment variable accessors.
//
// Purpose:
//   Centralise every D6E_* / D6E_AUTH_* variable behind small helpers so
//   the variables are validated at the point of first use (not at module
//   load time) and error messages clearly identify which variable was
//   missing and which caller was asking for it.
//
// Main specifications:
//   - getD6eUrl(): base URL of the b-button d6e instance hosting file
//     storage, execute-by-intent, chat-sessions, etc.
//   - getD6eWorkspaceId(): UUID of the workspace this app operates on.
//   - getD6eAuthUrl(): base URL of the d6e-auth service that issues
//     OAuth2 authorization codes and JWT access tokens.
//   - getD6eAuthClientId() / getD6eAuthClientSecret(): credentials of
//     the registered_client row that maps this app to d6e-auth.
//   - getD6eAuthRedirectUri(): callback URL registered with d6e-auth's
//     registered_client.redirectUris array.
//
// Limitations:
//   - Access tokens are NOT exposed here. They are obtained via the
//     server-side OAuth2 flow in src/lib/server/oauth.ts and stored
//     in HTTP-only cookies; route handlers read them through
//     event.locals.accessToken populated by hooks.server.ts.
//   - Only $env/dynamic/private is used so that nothing here can be
//     bundled into the client.

import { env } from '$env/dynamic/private';

function requireEnv(name: string, caller: string): string {
	const value = env[name];
	if (!value || value.length === 0) {
		throw new Error(
			`[env] Missing required environment variable ${name} (requested by ${caller}). Copy .env.example to .env and fill it in.`
		);
	}
	return value;
}

// Base URL of the d6e instance that hosts the Rust API (file storage,
// workspaces, workflows) and the SvelteKit frontend (chat-sessions,
// workspace-prompt-rules) on the same origin.
export function getD6eUrl(caller: string): string {
	return requireEnv('D6E_BASE_URL', caller).replace(/\/+$/, '');
}

export function getD6eWorkspaceId(caller: string): string {
	const value = requireEnv('D6E_WORKSPACE_ID', caller);
	const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
	if (!uuidRe.test(value)) {
		throw new Error(`[env] D6E_WORKSPACE_ID must be a valid UUID (got "${value}" from ${caller}).`);
	}
	return value;
}

// Base URL of the d6e-auth service (e.g. https://www.d6e.ai). It hosts
// the OAuth2 authorize page (/auth/login) and the token endpoint
// (/api/v1/auth/token) used to exchange authorization codes for JWTs.
export function getD6eAuthUrl(caller: string): string {
	return requireEnv('D6E_AUTH_URL', caller).replace(/\/+$/, '');
}

// Client ID of the registered_client row that represents this app on
// d6e-auth. The d6e-auth admin must create this row and add the
// callback URL to its redirectUris array before login can succeed.
export function getD6eAuthClientId(caller: string): string {
	return requireEnv('D6E_AUTH_CLIENT_ID', caller);
}

// Client secret paired with D6E_AUTH_CLIENT_ID. Never exposed to the
// browser; only used server-side when POSTing to the token endpoint.
export function getD6eAuthClientSecret(caller: string): string {
	return requireEnv('D6E_AUTH_CLIENT_SECRET', caller);
}

// Callback URL registered with d6e-auth. Must match exactly one of the
// strings stored in registered_client.redirectUris, otherwise d6e-auth
// will reject the authorize request with redirect_uri mismatch.
export function getD6eAuthRedirectUri(caller: string): string {
	return requireEnv('D6E_AUTH_REDIRECT_URI', caller);
}
