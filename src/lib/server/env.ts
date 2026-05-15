// Server-only environment variable accessors.
//
// Centralises every D6E_* variable behind small helpers so that:
//   1. The variables are validated at the point of first use, not at
//      module load time (so `npm run build` and `npm run check` still
//      work without a populated .env file).
//   2. Error messages clearly identify which variable was missing and
//      which caller was looking for it (per the project's error-handling
//      guidelines).
//
// Access tokens are intentionally NOT exposed here. They are obtained
// through src/lib/server/d6e-token.ts which exchanges the long-lived
// refresh token below for a short-lived access token via the d6e
// frontend's token endpoint.
//
// Only $env/dynamic/private is used so that nothing here can be
// inadvertently bundled into the client.

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

export function getD6eApiUrl(caller: string): string {
	return requireEnv('D6E_API_URL', caller).replace(/\/+$/, '');
}

export function getD6eFrontendUrl(caller: string): string {
	return requireEnv('D6E_FRONTEND_URL', caller).replace(/\/+$/, '');
}

export function getD6eWorkspaceId(caller: string): string {
	const value = requireEnv('D6E_WORKSPACE_ID', caller);
	const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
	if (!uuidRe.test(value)) {
		throw new Error(`[env] D6E_WORKSPACE_ID must be a valid UUID (got "${value}" from ${caller}).`);
	}
	return value;
}

export function getD6eRefreshToken(caller: string): string {
	return requireEnv('D6E_REFRESH_TOKEN', caller);
}
