#!/usr/bin/env node
// Bootstrap script that registers this app's workspace prompt rule on a
// running d6e instance.
//
// Usage:
//   D6E_BASE_URL=... \
//   D6E_WORKSPACE_ID=... \
//   D6E_REFRESH_TOKEN=... \
//   npm run init
//
// What it does:
//   1. Exchanges D6E_REFRESH_TOKEN for a fresh access token via
//      ${D6E_BASE_URL}/api/v1/auth/token. This endpoint accepts the
//      refresh token on its own (no client_id / client_secret needed)
//      and issues a token whose audience matches the same b-button
//      instance that verifyAccessToken will validate against.
//   2. Reads scripts/prompts/ai-keiri-prompt.md (the single source of
//      truth for this app's LLM behaviour).
//   3. POSTs the content to
//      {D6E_BASE_URL}/api/workspace-prompt-rules with the new
//      access token as a Cookie header. This endpoint requires
//      cookie-based auth (not Bearer).
//   4. The new rule is appended at the end of the existing rule list -
//      run this script repeatedly only if you intend to layer multiple
//      copies.
//
// Exit codes:
//   0  success
//   1  missing/invalid environment variables, file read error, refresh
//      failure, or any non-2xx response from d6e
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PROMPT_PATH = resolve(SCRIPT_DIR, 'prompts/ai-keiri-prompt.md');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PROMPT_CHARS = 50000;

function fail(message) {
	console.error(`[init-workspace] ${message}`);
	process.exit(1);
}

function readEnv(name) {
	const value = process.env[name];
	if (!value || value.length === 0) {
		fail(
			`Missing required environment variable ${name}. Copy .env.example to .env and fill it in.`
		);
	}
	return value;
}

function trimTrailingSlashes(value) {
	return value.replace(/\/+$/, '');
}

async function refreshAccessToken({ baseUrl, refreshToken }) {
	const target = `${baseUrl}/api/v1/auth/token`;
	let response;
	try {
		response = await fetch(target, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				grant_type: 'refresh_token',
				refresh_token: refreshToken
			})
		});
	} catch (err) {
		fail(`Network error contacting ${target}: ${err.message}`);
	}

	const text = await response.text();
	if (!response.ok) {
		fail(
			`${target} rejected refresh (status=${response.status}): ${text}\n` +
				`Likely cause: D6E_REFRESH_TOKEN was rotated in another session — ` +
				`re-copy the auth-refresh cookie value from your browser dev tools.`
		);
	}

	let parsed;
	try {
		parsed = JSON.parse(text);
	} catch {
		fail(`${target} returned non-JSON body: ${text}`);
	}

	if (!parsed.access_token) {
		fail(`${target} response missing access_token: ${text}`);
	}
	return parsed.access_token;
}

const baseUrl = trimTrailingSlashes(readEnv('D6E_BASE_URL'));
const workspaceId = readEnv('D6E_WORKSPACE_ID');
const refreshToken = readEnv('D6E_REFRESH_TOKEN');

if (!UUID_RE.test(workspaceId)) {
	fail(`D6E_WORKSPACE_ID must be a valid UUID, got "${workspaceId}".`);
}

let promptBody;
try {
	promptBody = readFileSync(PROMPT_PATH, 'utf8').trim();
} catch (err) {
	fail(`Failed to read ${PROMPT_PATH}: ${err.message}`);
}

if (promptBody.length === 0) {
	fail(`Prompt file ${PROMPT_PATH} is empty.`);
}

if (Array.from(promptBody).length > MAX_PROMPT_CHARS) {
	fail(
		`Prompt exceeds the ${MAX_PROMPT_CHARS} character limit enforced by /api/workspace-prompt-rules.`
	);
}

console.log(`[init-workspace] refreshing access token via ${baseUrl}/api/v1/auth/token`);
const accessToken = await refreshAccessToken({
	baseUrl,
	refreshToken
});

const target = `${baseUrl}/api/workspace-prompt-rules`;
console.log(`[init-workspace] POST ${target} (workspaceId=${workspaceId})`);
console.log(`[init-workspace] prompt size: ${promptBody.length} characters`);

const response = await fetch(target, {
	method: 'POST',
	headers: {
		'Content-Type': 'application/json',
		Cookie: `auth-token=${accessToken}`
	},
	body: JSON.stringify({ workspaceId, content: promptBody })
});

const responseText = await response.text();
if (!response.ok) {
	fail(
		`Upstream returned ${response.status} ${response.statusText}: ${responseText}\n` +
			`Hint: the d6e frontend uses cookie auth for this endpoint. ` +
			`Ensure the freshly-issued access token has admin rights on the workspace.`
	);
}

let parsed;
try {
	parsed = JSON.parse(responseText);
} catch {
	fail(`Upstream returned non-JSON body: ${responseText}`);
}

console.log(
	`[init-workspace] OK - rule id=${parsed.id ?? '<unknown>'} sort_order=${parsed.sortOrder ?? '<unknown>'}`
);
console.log('[init-workspace] Verify in the d6e frontend: Settings > Workspace > Prompt rules.');
