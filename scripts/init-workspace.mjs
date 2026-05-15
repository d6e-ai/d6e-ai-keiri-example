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
//   3. GETs the current prompt rule list for D6E_WORKSPACE_ID and
//      hashes the content of each existing rule. If any of them
//      matches the SHA-256 of the prompt we are about to upload, the
//      script logs that fact and exits 0 without POSTing. This makes
//      `npm run init` idempotent: running it twice in a row no longer
//      produces duplicate rules.
//   4. If no identical rule exists yet, POSTs the content to
//      {D6E_BASE_URL}/api/workspace-prompt-rules with the new access
//      token as a Cookie header. This endpoint requires cookie-based
//      auth (not Bearer) and appends the new rule at the next
//      sortOrder slot.
//
// Notes on de-duplication:
//   - The check is content-based (SHA-256 over the trimmed prompt
//     body). It will NOT detect "near-duplicate" rules (e.g. someone
//     hand-edited the prompt in the d6e admin UI). It is here to
//     guard against the most common case — running `npm run init`
//     repeatedly on the same checkout.
//   - When the prompt file changes, the new content hashes differently
//     and a fresh rule is POSTed. The old rule keeps living at a lower
//     sortOrder until you delete it (DELETE
//     /api/workspace-prompt-rules/{ruleId} or via the d6e admin UI).
//
// Exit codes:
//   0  success (POSTed, OR skipped because an identical rule already
//      exists)
//   1  missing/invalid environment variables, file read error, refresh
//      failure, or any non-2xx response from d6e
import { createHash } from 'node:crypto';
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

function sha256Hex(value) {
	return createHash('sha256').update(value, 'utf8').digest('hex');
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

/**
 * Fetch every existing prompt rule for the workspace.
 *
 * Returns the parsed JSON array on success and fails the process on any
 * non-2xx response. We accept either a raw array or a `{ rules: [...] }`
 * envelope because the upstream shape has changed before; tolerating
 * both keeps this script forward-compatible with minor API tweaks.
 */
async function listExistingRules({ baseUrl, workspaceId, accessToken }) {
	const target = `${baseUrl}/api/workspace-prompt-rules?workspaceId=${encodeURIComponent(workspaceId)}`;
	let response;
	try {
		response = await fetch(target, {
			method: 'GET',
			headers: {
				Accept: 'application/json',
				Cookie: `auth-token=${accessToken}`
			}
		});
	} catch (err) {
		fail(`Network error contacting ${target}: ${err.message}`);
	}

	const text = await response.text();
	if (!response.ok) {
		fail(
			`Failed to list existing rules (status=${response.status}): ${text}\n` +
				`Confirm the access token has admin rights on the workspace.`
		);
	}

	let parsed;
	try {
		parsed = JSON.parse(text);
	} catch {
		fail(`Upstream returned non-JSON body on rule list: ${text}`);
	}

	if (Array.isArray(parsed)) return parsed;
	if (Array.isArray(parsed?.rules)) return parsed.rules;

	fail(
		`Unexpected response shape from ${target}. Expected an array or { rules: [...] }, got: ` +
			JSON.stringify(parsed).slice(0, 300)
	);
	return [];
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

const desiredSha = sha256Hex(promptBody);

console.log(`[init-workspace] refreshing access token via ${baseUrl}/api/v1/auth/token`);
const accessToken = await refreshAccessToken({
	baseUrl,
	refreshToken
});

console.log(
	`[init-workspace] checking existing rules for workspaceId=${workspaceId} (desiredSha=${desiredSha.slice(0, 12)})`
);
const existingRules = await listExistingRules({ baseUrl, workspaceId, accessToken });
const duplicate = existingRules.find((rule) => {
	const content = (rule?.content ?? '').trim();
	return content.length > 0 && sha256Hex(content) === desiredSha;
});

if (duplicate) {
	console.log(
		`[init-workspace] OK - identical rule already registered ` +
			`(id=${duplicate.id ?? '<unknown>'}, sortOrder=${duplicate.sortOrder ?? '<unknown>'}). ` +
			`Skipping POST.`
	);
	console.log(
		'[init-workspace] To force a fresh registration, delete the existing rule first ' +
			'via the d6e admin UI or DELETE /api/workspace-prompt-rules/{ruleId}.'
	);
	process.exit(0);
}

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
