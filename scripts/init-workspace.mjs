#!/usr/bin/env node
// Bootstrap script that registers this app's workspace prompt rule on a
// running d6e instance.
//
// Usage:
//   D6E_FRONTEND_URL=http://localhost:5173 \
//   D6E_WORKSPACE_ID=<uuid> \
//   D6E_AUTH_COOKIE=<auth-token cookie value> \
//   npm run init
//
// What it does:
//   1. Reads scripts/prompts/ai-keiri-prompt.md (the single source of
//      truth for this app's LLM behaviour).
//   2. POSTs the content to
//      {D6E_FRONTEND_URL}/api/workspace-prompt-rules with a Cookie
//      header. This endpoint requires cookie-based auth (not Bearer),
//      so you must copy the `auth-token` cookie value from the d6e
//      frontend in your browser dev tools. See README.md for the full
//      procedure.
//   3. The new rule is appended at the end of the existing rule list -
//      run this script repeatedly only if you intend to layer multiple
//      copies.
//
// Exit codes:
//   0  success
//   1  missing/invalid environment variables, file read error, or any
//      non-2xx response from d6e
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

const frontendUrl = readEnv('D6E_FRONTEND_URL').replace(/\/+$/, '');
const workspaceId = readEnv('D6E_WORKSPACE_ID');
const authCookie = readEnv('D6E_AUTH_COOKIE');

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

const target = `${frontendUrl}/api/workspace-prompt-rules`;
console.log(`[init-workspace] POST ${target} (workspaceId=${workspaceId})`);
console.log(`[init-workspace] prompt size: ${promptBody.length} characters`);

const response = await fetch(target, {
	method: 'POST',
	headers: {
		'Content-Type': 'application/json',
		Cookie: `auth-token=${authCookie}`
	},
	body: JSON.stringify({ workspaceId, content: promptBody })
});

const responseText = await response.text();
if (!response.ok) {
	fail(
		`Upstream returned ${response.status} ${response.statusText}: ${responseText}\n` +
			`Hint: the d6e frontend uses cookie auth for this endpoint. ` +
			`Make sure D6E_AUTH_COOKIE is the value of the auth-token cookie ` +
			`from a logged-in admin session on D6E_FRONTEND_URL.`
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
