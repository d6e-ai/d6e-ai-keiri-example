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

export function getD6eFrontendUrl(caller: string): string {
	return requireEnv('D6E_FRONTEND_URL', caller).replace(/\/+$/, '');
}

// On managed deployments (e.g. https://b-button.d6e.ai) the Rust API and the
// SvelteKit frontend share a single origin, so D6E_API_URL can be omitted and
// we fall back to D6E_FRONTEND_URL. Set D6E_API_URL explicitly only when the
// Rust API is reachable on a different host (e.g. a separated local dev
// setup where the API runs on http://localhost:8000).
export function getD6eApiUrl(caller: string): string {
	const explicit = env.D6E_API_URL;
	if (explicit && explicit.length > 0) {
		return explicit.replace(/\/+$/, '');
	}
	return getD6eFrontendUrl(caller);
}

export function getD6eJwt(caller: string): string {
	return requireEnv('D6E_JWT', caller);
}

export function getD6eWorkspaceId(caller: string): string {
	const value = requireEnv('D6E_WORKSPACE_ID', caller);
	const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
	if (!uuidRe.test(value)) {
		throw new Error(`[env] D6E_WORKSPACE_ID must be a valid UUID (got "${value}" from ${caller}).`);
	}
	return value;
}
