<script lang="ts">
	// AI Journal page (route "/").
	//
	// End-to-end flow:
	//   1. User picks (or drops) one or more receipt files. Each file
	//      is POSTed to /api/upload in parallel; on success the
	//      returned IntentInputFileRef is appended to `uploadedRefs`.
	//      Files that fail upload stay in `pendingUploads` with an
	//      error status so the user can retry.
	//   2. The user clicks the "Generate journal" button. We then call
	//      POST /api/intent with the full uploadedRefs array as
	//      inputFileRefs[] and persistAs='journal'. The chat_session id
	//      that comes back is stored so subsequent revise / register
	//      turns append to the same row.
	//   3. The assistant message is parsed via parse-journal; success
	//      renders either the journal table (kind:"journal") or the
	//      registration result card (kind:"registration"). Anything else
	//      falls back to raw markdown.
	//   4. The "revise" form posts a follow-up message. Its wrapping tag
	//      depends on the current parse kind:
	//        - kind:"journal"       -> <previous_journal>...</previous_journal>
	//        - kind:"registration"  -> <additional_comment>...</additional_comment>
	//      The same uploadedRefs and chatSessionId are re-sent so the
	//      server appends to the same chat_session row.
	//   5. The "freee に登録" button (rendered inside JournalResult when
	//      kind:"journal") triggers handleRegister(), which sends a
	//      <registration_request> message so the LLM dispatches to
	//      scenario D (freee + Drive). The response is parsed as
	//      kind:"registration".
	//   6. Once kind:"registration" returns with status:"success", a
	//      "完了にする" button (rendered inside RegistrationResult)
	//      triggers handleComplete(). That PATCHes the chat_session
	//      title to include the #completed suffix and resets the page
	//      to the fresh-start state so the user can start the next
	//      journal.
	//
	// State persistence:
	//   The active chat_session id is round-tripped through the URL as
	//   ?chatSessionId=<uuid>. The SSR loader in +page.server.ts fetches
	//   the corresponding chat_session row and exposes it as
	//   `data.restoredSession`. We hydrate `uploadedRefs`,
	//   `currentChatSessionId`, `currentTitle`, `isCurrentCompleted`
	//   and `parseResult` from that snapshot so a reload (or a click
	//   from /tasks pending tab) puts the user back into the same
	//   session.
	//
	//   Within a single browser session, action handlers (handleExecute /
	//   handleRevise / handleRegister) update `currentChatSessionId` and
	//   `currentTitle` directly from the /api/intent response, NOT via
	//   invalidateAll(). The $effect below therefore only fires on a
	//   genuine session swap (initial mount, or a different chatSessionId
	//   in the URL). This avoids a race where the reactive re-run of the
	//   loader would clobber the freshly-populated `parseResult`, which
	//   manifested as "the journal only appears after a manual reload".
	//
	// Note: the previous "pending tasks" section that used to render on
	// this page has been moved to /tasks (under the "Pending" tab). The
	// AI Journal page now focuses on the active session only.

	import { untrack } from 'svelte';

	import AlertCircleIcon from '@lucide/svelte/icons/alert-circle';
	import CheckCircle2Icon from '@lucide/svelte/icons/check-circle-2';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import PlayIcon from '@lucide/svelte/icons/play';
	import { replaceState } from '$app/navigation';

	import JournalResult from '$lib/components/journal-result.svelte';
	import ReceiptUploader from '$lib/components/receipt-uploader.svelte';
	import ReviseCommentForm from '$lib/components/revise-comment-form.svelte';
	import UploadedFileList from '$lib/components/uploaded-file-list.svelte';
	import { markCompletedTitle } from '$lib/journal-title';
	import * as m from '$lib/paraglide/messages.js';
	import { parseJournalMessage, type ParseResult } from '$lib/parse-journal';
	import {
		isUploadedFileView,
		type PendingUploadView,
		type UploadedFileView
	} from '$lib/upload-types';
	import { cn } from '$lib/utils';

	import type { PageData } from './$types';

	const CREATE_PROMPT =
		'添付した領収書画像を解析して、freee 登録用の仕訳一覧を作成してください。' +
		'複数の領収書がある場合はすべて読み取って 1 つの仕訳一覧にまとめてください。';
	const REGISTER_PROMPT_HEADER =
		'下記の仕訳を freee に登録し、添付の領収書を Google Drive にアップロードしてください。';
	// How long the "Journal completed" banner stays visible after the
	// user marks a session as completed. Long enough to register the
	// transition but short enough that it does not block the next
	// upload flow.
	const COMPLETED_BANNER_DURATION_MS = 5000;

	let { data }: { data: PageData } = $props();

	// The following $state declarations seed their initial value from
	// `data` so the SSR-rendered HTML and the post-hydration client
	// state agree. Subsequent navigations that re-run the loader are
	// reconciled by the $effect below (search for `data.restoredSession`).
	// We silence Svelte's `state_referenced_locally` warning here because
	// the "only captures the initial value" semantics are intentional —
	// after the first hydration the state is owned by the user's edits.
	let pendingUploads = $state<PendingUploadView[]>([]);
	// svelte-ignore state_referenced_locally
	let uploadedRefs = $state<UploadedFileView[]>(data.restoredSession?.uploadedRefs ?? []);
	// Counter of in-flight DELETE /api/upload/{fileId} round-trips.
	// Folded into canExecute so the user cannot race a pending delete
	// against "Generate journal".
	let deletesInFlight = $state(0);

	let isExecuting = $state(false);
	// Independent flag so the freee register button can show its own
	// spinner / loading text inside the page banner while the rest of
	// the page stays in the generic "isExecuting" state.
	let registerInFlight = $state(false);
	let isCompleting = $state(false);
	// svelte-ignore state_referenced_locally
	let errorMessage = $state<string | null>(data.restoreError);
	// svelte-ignore state_referenced_locally
	let currentChatSessionId = $state<string | null>(data.restoredSession?.id ?? null);
	// svelte-ignore state_referenced_locally
	let currentTitle = $state<string | null>(data.restoredSession?.title ?? null);
	// svelte-ignore state_referenced_locally
	let isCurrentCompleted = $state<boolean>(data.restoredSession?.isCompleted ?? false);
	// svelte-ignore state_referenced_locally
	let parseResult = $state<ParseResult | null>(
		data.restoredSession?.rawAssistantText
			? parseJournalMessage(data.restoredSession.rawAssistantText)
			: null
	);
	let completedBannerVisible = $state(false);
	let completedBannerTimeout: ReturnType<typeof setTimeout> | null = null;

	// The revise form switches between two modes depending on the most
	// recent assistant payload kind. Derive it once so the form and the
	// outgoing message wrapper stay in sync.
	const reviseMode = $derived<'journal' | 'followup'>(
		parseResult?.kind === 'registration' ? 'followup' : 'journal'
	);

	const hasUploadInFlight = $derived(pendingUploads.some((entry) => entry.status === 'uploading'));
	const hasDeleteInFlight = $derived(deletesInFlight > 0);
	const canExecute = $derived(
		uploadedRefs.length > 0 && !hasUploadInFlight && !hasDeleteInFlight && !isExecuting
	);
	const executeBlockedHint = $derived.by(() => {
		if (isExecuting) return null;
		if (hasUploadInFlight || hasDeleteInFlight) return m.journal_upload_run_disabled_uploading();
		if (uploadedRefs.length === 0) return m.journal_upload_run_disabled_empty();
		return null;
	});

	// Completion is only meaningful once freee + Drive reported success.
	// Anything else (journal-only, registration with status !== 'success',
	// or in-flight work) hides the button. The title check rejects both
	// null AND empty string because deriveJournalTaskSummary coerces a
	// null chat_session.title to ''. Without the truthiness check
	// canComplete would flip true while handleComplete's `!currentTitle`
	// guard silently bails, leaving the button visibly enabled but inert.
	const canComplete = $derived(
		currentChatSessionId !== null &&
			!!currentTitle &&
			!isCurrentCompleted &&
			parseResult?.kind === 'registration' &&
			parseResult.result.status === 'success' &&
			!isExecuting &&
			!isCompleting
	);

	// Re-hydrate editable state when the SSR loader returns a *different*
	// session than the client currently holds. This fires only on real
	// session swaps:
	//   - initial mount with `?chatSessionId=...` in the URL,
	//   - URL change after navigating from /tasks pending tab.
	// Action handlers (handleExecute / handleRevise / handleRegister)
	// no longer call invalidateAll(), so the "same id" branch reliably
	// short-circuits and the freshly-populated parseResult is preserved.
	// untrack() guards the read of `currentChatSessionId` because the
	// effect must not re-fire when its own writes update that signal.
	$effect(() => {
		const restored = data.restoredSession;
		const restoredId = restored?.id ?? null;
		const currentId = untrack(() => currentChatSessionId);

		if (restoredId === currentId) {
			// Same session as the client already holds. Do nothing on
			// purpose: rewriting parseResult / uploadedRefs from a
			// stale snapshot would clobber whatever the latest action
			// handler just set. `currentTitle` / `isCurrentCompleted`
			// are also kept in sync by the action handlers themselves
			// (via the /api/intent response or via handleComplete), so
			// there is no remaining server-only field that this effect
			// needs to copy over.
			return;
		}

		if (restored) {
			currentChatSessionId = restored.id;
			currentTitle = restored.title;
			isCurrentCompleted = restored.isCompleted;
			uploadedRefs = restored.uploadedRefs;
			pendingUploads = [];
			parseResult = restored.rawAssistantText
				? parseJournalMessage(restored.rawAssistantText)
				: null;
			completedBannerVisible = false;
			errorMessage = data.restoreError;
		} else {
			currentChatSessionId = null;
			currentTitle = null;
			isCurrentCompleted = false;
			uploadedRefs = [];
			pendingUploads = [];
			parseResult = null;
			errorMessage = data.restoreError;
		}
	});

	function generateLocalId(): string {
		return typeof crypto !== 'undefined' && 'randomUUID' in crypto
			? crypto.randomUUID()
			: `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
	}

	function syncChatSessionIdToUrl(sessionId: string | null): void {
		if (typeof window === 'undefined') return;
		const params = new URLSearchParams(window.location.search);
		if (sessionId) {
			params.set('chatSessionId', sessionId);
		} else {
			params.delete('chatSessionId');
		}
		const queryString = params.toString();
		const nextHref = queryString
			? `${window.location.pathname}?${queryString}`
			: window.location.pathname;
		const currentHref = window.location.pathname + window.location.search;
		if (currentHref === nextHref) return;
		// Use replaceState (not pushState) because the chat session id is
		// a refinement of the "AI Journal" page rather than a new history
		// entry; we don't want the back button to step through every
		// turn of the same session.
		replaceState(nextHref, {});
	}

	function showCompletedBanner(): void {
		completedBannerVisible = true;
		if (typeof window === 'undefined') return;
		if (completedBannerTimeout) {
			clearTimeout(completedBannerTimeout);
		}
		completedBannerTimeout = setTimeout(() => {
			completedBannerVisible = false;
			completedBannerTimeout = null;
		}, COMPLETED_BANNER_DURATION_MS);
	}

	async function uploadOne(file: File, localId: string): Promise<void> {
		const formData = new FormData();
		formData.append('file', file);

		let response: Response;
		try {
			response = await fetch('/api/upload', { method: 'POST', body: formData });
		} catch (err) {
			const detail = err instanceof Error ? err.message : String(err);
			pendingUploads = pendingUploads.map((entry) =>
				entry.localId === localId ? { ...entry, status: 'error', errorMessage: detail } : entry
			);
			errorMessage = m.journal_upload_failed({ filename: file.name, detail });
			console.error('[ai-journal-page] uploadOne network error:', detail);
			return;
		}

		// If hooks.server.ts redirected the request to /auth/login (e.g. the
		// session expired between page load and the upload), the browser may
		// follow the chain into a 200 HTML response. response.ok is then
		// true but the body is not JSON — guard against that by validating
		// the parsed payload shape before accepting it as an UploadedFileView.
		const payload: unknown = await response.json().catch(() => null);
		if (!response.ok) {
			const err = payload as { error?: string } | null | undefined;
			const detail = err && typeof err.error === 'string' ? err.error : `HTTP ${response.status}`;
			pendingUploads = pendingUploads.map((entry) =>
				entry.localId === localId ? { ...entry, status: 'error', errorMessage: detail } : entry
			);
			errorMessage = m.journal_upload_failed({ filename: file.name, detail });
			console.error('[ai-journal-page] uploadOne server error:', detail);
			return;
		}

		if (!isUploadedFileView(payload)) {
			const detail = `HTTP ${response.status} returned an unexpected body (session may have expired)`;
			pendingUploads = pendingUploads.map((entry) =>
				entry.localId === localId ? { ...entry, status: 'error', errorMessage: detail } : entry
			);
			errorMessage = m.journal_upload_failed({ filename: file.name, detail });
			console.error('[ai-journal-page] uploadOne invalid payload:', detail);
			return;
		}

		uploadedRefs = [...uploadedRefs, payload];
		pendingUploads = pendingUploads.filter((entry) => entry.localId !== localId);
	}

	function handleFiles(files: File[]): void {
		errorMessage = null;

		const newPending: PendingUploadView[] = files.map((file) => ({
			localId: generateLocalId(),
			filename: file.name,
			status: 'uploading'
		}));
		pendingUploads = [...pendingUploads, ...newPending];

		newPending.forEach((entry, index) => {
			void uploadOne(files[index], entry.localId);
		});
	}

	function handleDismissPending(localId: string): void {
		pendingUploads = pendingUploads.filter((entry) => entry.localId !== localId);
	}

	async function handleRemove(fileId: string): Promise<void> {
		const targetIndex = uploadedRefs.findIndex((ref) => ref.fileId === fileId);
		if (targetIndex === -1) return;
		const target = uploadedRefs[targetIndex];
		// Snapshot the file ids that preceded the target so a later
		// restore can reconstruct the original ordering even if other
		// concurrent removes have mutated the array in the meantime.
		const predecessorIds = uploadedRefs.slice(0, targetIndex).map((ref) => ref.fileId);
		uploadedRefs = uploadedRefs.filter((ref) => ref.fileId !== fileId);

		const restore = () => {
			if (uploadedRefs.some((ref) => ref.fileId === fileId)) return;
			const predecessorSet = new Set(predecessorIds);
			let insertAt = 0;
			for (let i = uploadedRefs.length - 1; i >= 0; i -= 1) {
				if (predecessorSet.has(uploadedRefs[i].fileId)) {
					insertAt = i + 1;
					break;
				}
			}
			uploadedRefs = [...uploadedRefs.slice(0, insertAt), target, ...uploadedRefs.slice(insertAt)];
		};

		deletesInFlight += 1;
		try {
			const response = await fetch(`/api/upload/${encodeURIComponent(fileId)}`, {
				method: 'DELETE'
			});
			const payload: unknown = await response.json().catch(() => null);
			if (!response.ok) {
				const detail = `HTTP ${response.status}`;
				errorMessage = m.journal_upload_remove_failed();
				console.error('[ai-journal-page] handleRemove failed:', detail);
				restore();
			} else if (
				!payload ||
				typeof payload !== 'object' ||
				(payload as { ok?: unknown }).ok !== true
			) {
				const detail = `HTTP ${response.status} returned an unexpected body (session may have expired)`;
				errorMessage = m.journal_upload_remove_failed();
				console.error('[ai-journal-page] handleRemove invalid payload:', detail);
				restore();
			}
		} catch (err) {
			const detail = err instanceof Error ? err.message : String(err);
			errorMessage = m.journal_upload_remove_failed();
			console.error('[ai-journal-page] handleRemove network error:', detail);
			restore();
		} finally {
			deletesInFlight -= 1;
		}
	}

	async function callIntent(
		message: string,
		fileRefs: UploadedFileView[],
		chatSessionId: string | null
	): Promise<{ rawMessage: string; chatSessionId: string | null; title: string | null }> {
		const requestBody: Record<string, unknown> = {
			message,
			inputFileRefs: fileRefs,
			persistAs: 'journal'
		};
		if (chatSessionId) requestBody.chatSessionId = chatSessionId;

		const response = await fetch('/api/intent', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(requestBody)
		});
		const payload: unknown = await response.json().catch(() => ({}));
		if (!response.ok) {
			const errPayload = payload as { error?: string } | null | undefined;
			const detail = errPayload && typeof errPayload.error === 'string' ? errPayload.error : '';
			throw new Error(`Execute-by-intent failed (${response.status}): ${detail}`);
		}
		// `title` is included by the server when chat_session persistence
		// succeeded; it is the post-PATCH value of chat_session.title so
		// the caller can update `currentTitle` directly. Falls back to
		// null when persistence failed or title was unchanged and null
		// at rest.
		const ok = payload as {
			success?: boolean;
			message?: string;
			chatSessionId?: string;
			title?: string;
		};
		if (!ok.success) {
			throw new Error(ok.message ?? 'execute-by-intent returned success=false');
		}
		return {
			rawMessage: ok.message ?? '',
			chatSessionId: ok.chatSessionId ?? null,
			title: ok.title ?? null
		};
	}

	async function handleExecute(): Promise<void> {
		if (!canExecute) return;
		errorMessage = null;
		isExecuting = true;
		parseResult = null;
		currentChatSessionId = null;
		currentTitle = null;
		isCurrentCompleted = false;
		completedBannerVisible = false;
		try {
			const { rawMessage, chatSessionId, title } = await callIntent(
				CREATE_PROMPT,
				uploadedRefs,
				null
			);
			parseResult = parseJournalMessage(rawMessage);
			currentChatSessionId = chatSessionId;
			// `title` comes from the /api/intent response and tells us
			// the freshly created chat_session.title. Setting it here
			// (instead of going through invalidateAll() + the restore
			// $effect) is what stopped the "results only appear after a
			// reload" bug — see the header comment on this file.
			currentTitle = title;
			// A newly created session is never completed by construction:
			// the title is built via buildJournalTitle, which never adds
			// the #completed suffix.
			isCurrentCompleted = false;
			if (chatSessionId) {
				syncChatSessionIdToUrl(chatSessionId);
			}
		} catch (err) {
			const detail = err instanceof Error ? err.message : String(err);
			errorMessage = detail;
			console.error('[ai-journal-page] handleExecute failed:', detail);
		} finally {
			isExecuting = false;
		}
	}

	async function handleRevise(comment: string): Promise<void> {
		// Note: uploadedRefs may legitimately be empty here when a legacy
		// chat_session (persisted before inputFileRefs were embedded in
		// user UIMessages) is restored via ?chatSessionId=<uuid>. The
		// revise form is still meaningful in that case — the user can
		// nudge the LLM about the existing journal without re-attaching
		// receipts — so we only gate on parseResult.
		if (!parseResult) {
			errorMessage = 'No previous assistant response to revise.';
			return;
		}
		errorMessage = null;
		isExecuting = true;
		try {
			let message: string;
			if (parseResult.kind === 'journal') {
				const previousJson = JSON.stringify(parseResult.result, null, 2);
				message = [
					'前回生成した仕訳に対する修正依頼です。',
					'<previous_journal>',
					previousJson,
					'</previous_journal>',
					'',
					`修正指示: ${comment}`,
					'',
					'仕訳全体を再生成し、変更を反映した完全な JSON を返してください。'
				].join('\n');
			} else if (parseResult.kind === 'registration') {
				message = [
					'直前の freee 登録ターンへの追加コメントです。',
					'<additional_comment>',
					comment,
					'</additional_comment>',
					'',
					'必要に応じて未完了の登録 / Drive アップロードを実行し、最新の状態を kind:"registration" JSON で返してください。'
				].join('\n');
			} else {
				// fallback parseResult: rare, but keep the form usable so
				// the user can nudge the LLM back on track instead of being
				// stuck. Send the comment verbatim.
				message = comment;
			}

			const { rawMessage, chatSessionId, title } = await callIntent(
				message,
				uploadedRefs,
				currentChatSessionId
			);
			parseResult = parseJournalMessage(rawMessage);
			if (chatSessionId) {
				currentChatSessionId = chatSessionId;
				syncChatSessionIdToUrl(chatSessionId);
			}
			// The server regenerates the title when a revise turn
			// changes the parsed payload (entry count / total). Apply
			// the new value so the [keiri] header card stays in sync
			// without going through invalidateAll().
			if (title !== null) {
				currentTitle = title;
			}
		} catch (err) {
			const detail = err instanceof Error ? err.message : String(err);
			errorMessage = detail;
			console.error('[ai-journal-page] handleRevise failed:', detail);
		} finally {
			isExecuting = false;
		}
	}

	async function handleRegister(): Promise<void> {
		if (uploadedRefs.length === 0 || !parseResult || parseResult.kind !== 'journal') {
			errorMessage = 'No journal payload to register.';
			return;
		}
		errorMessage = null;
		isExecuting = true;
		registerInFlight = true;
		try {
			const journalJson = JSON.stringify(parseResult.result, null, 2);
			const message = [
				REGISTER_PROMPT_HEADER,
				'<registration_request>',
				journalJson,
				'</registration_request>'
			].join('\n');

			const { rawMessage, chatSessionId, title } = await callIntent(
				message,
				uploadedRefs,
				currentChatSessionId
			);
			parseResult = parseJournalMessage(rawMessage);
			if (chatSessionId) {
				currentChatSessionId = chatSessionId;
				syncChatSessionIdToUrl(chatSessionId);
			}
			// The register turn rarely changes the journal payload (and
			// therefore the title), but apply whatever the server
			// reports so the local view stays authoritative.
			if (title !== null) {
				currentTitle = title;
			}
		} catch (err) {
			const detail = err instanceof Error ? err.message : String(err);
			errorMessage = detail;
			console.error('[ai-journal-page] handleRegister failed:', detail);
		} finally {
			registerInFlight = false;
			isExecuting = false;
		}
	}

	async function handleComplete(): Promise<void> {
		if (!canComplete || !currentChatSessionId || !currentTitle) return;
		errorMessage = null;
		isCompleting = true;
		try {
			const targetTitle = markCompletedTitle(currentTitle);
			const response = await fetch(
				`/api/chat-sessions/${encodeURIComponent(currentChatSessionId)}`,
				{
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ title: targetTitle })
				}
			);
			const payload = await response.json().catch(() => ({}));
			if (!response.ok) {
				const detail =
					payload && typeof (payload as { error?: unknown }).error === 'string'
						? (payload as { error: string }).error
						: `HTTP ${response.status}`;
				throw new Error(detail);
			}

			// Reset client state immediately so the page returns to the
			// fresh-start UI. There is no need to re-fetch the loader
			// data here: the cleared `currentChatSessionId` and the
			// URL update below already produce the correct $effect
			// behaviour on the next genuine navigation, and the /tasks
			// page does its own fetch when the user opens it.
			parseResult = null;
			uploadedRefs = [];
			pendingUploads = [];
			currentChatSessionId = null;
			currentTitle = null;
			isCurrentCompleted = false;
			showCompletedBanner();

			syncChatSessionIdToUrl(null);
		} catch (err) {
			const detail = err instanceof Error ? err.message : String(err);
			errorMessage = detail;
			console.error('[ai-journal-page] handleComplete failed:', detail);
		} finally {
			isCompleting = false;
		}
	}
</script>

<div class="space-y-8 p-6 lg:p-10">
	<section class="space-y-2">
		<h1 class="text-3xl font-bold tracking-tight text-foreground">{m.journal_title()}</h1>
		<p class="text-sm text-muted-foreground">{m.journal_description()}</p>
	</section>

	{#if completedBannerVisible}
		<!--
			Use `text-success` (the success accent) rather than
			`text-success-foreground` (which is the near-white meant to
			sit on top of a filled success button). The previous setup
			put near-white text on the `bg-success/10` tinted background
			and was effectively unreadable. The destructive error banner
			at the bottom of this page uses the same pattern.
		-->
		<div
			class={cn(
				'flex items-center gap-3 rounded-xl border border-success/40 bg-success/10 p-4 text-sm font-medium text-success'
			)}
			role="status"
		>
			<CheckCircle2Icon class="size-5 text-success" aria-hidden="true" />
			<span>{m.journal_complete_banner()}</span>
		</div>
	{/if}

	{#if !parseResult && !isExecuting}
		<section class="space-y-4">
			<h2 class="text-lg font-semibold">{m.journal_upload_heading()}</h2>
			<ReceiptUploader onfiles={handleFiles} disabled={isExecuting} />

			<UploadedFileList
				pending={pendingUploads}
				uploaded={uploadedRefs}
				disabled={isExecuting}
				readonly={false}
				onremove={handleRemove}
				ondismiss={handleDismissPending}
			/>

			<div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
				<p class="text-xs text-muted-foreground">{m.journal_upload_run_hint()}</p>
				<div class="flex items-center gap-3">
					{#if executeBlockedHint}
						<span class="text-xs text-muted-foreground">{executeBlockedHint}</span>
					{/if}
					<button
						type="button"
						class={cn(
							'inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors',
							canExecute ? 'hover:bg-primary/90' : 'cursor-not-allowed opacity-50'
						)}
						disabled={!canExecute}
						onclick={handleExecute}
					>
						<PlayIcon class="size-4" aria-hidden="true" />
						{m.journal_upload_run_button()}
					</button>
				</div>
			</div>
		</section>
	{:else if parseResult}
		<section class="space-y-4">
			<UploadedFileList
				pending={pendingUploads}
				uploaded={uploadedRefs}
				disabled={false}
				readonly={true}
				onremove={handleRemove}
				ondismiss={handleDismissPending}
			/>
		</section>
	{/if}

	{#if isExecuting}
		<div
			class="flex items-center gap-3 rounded-xl border bg-card p-4 text-sm text-muted-foreground shadow-sm"
		>
			<LoaderCircleIcon class="size-5 animate-spin text-primary" aria-hidden="true" />
			<span>{registerInFlight ? m.journal_register_loading() : m.journal_loading()}</span>
		</div>
	{:else if isCompleting}
		<div
			class="flex items-center gap-3 rounded-xl border bg-card p-4 text-sm text-muted-foreground shadow-sm"
		>
			<LoaderCircleIcon class="size-5 animate-spin text-primary" aria-hidden="true" />
			<span>{m.journal_complete_loading()}</span>
		</div>
	{/if}

	{#if errorMessage}
		<div
			class={cn(
				'flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm',
				'text-destructive'
			)}
		>
			<AlertCircleIcon class="mt-0.5 size-5 shrink-0" aria-hidden="true" />
			<div>
				<p class="font-semibold">{m.journal_error_title()}</p>
				<p class="mt-1 break-words">{errorMessage}</p>
			</div>
		</div>
	{/if}

	{#if parseResult}
		<section class="space-y-4">
			<JournalResult
				parsed={parseResult}
				onRegister={handleRegister}
				registerDisabled={isExecuting || isCompleting || uploadedRefs.length === 0}
				{registerInFlight}
				onComplete={handleComplete}
				completeDisabled={!canComplete}
				completeInFlight={isCompleting}
			/>
			{#if parseResult.kind === 'journal' || parseResult.kind === 'registration'}
				<ReviseCommentForm
					onsubmit={handleRevise}
					disabled={isExecuting || isCompleting}
					mode={reviseMode}
				/>
			{/if}
		</section>
	{/if}
</div>
