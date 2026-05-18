<script lang="ts">
	// AI Journal page (route "/")
	//
	// End-to-end flow:
	//   1. User drops a receipt image -> POST /api/upload to register it
	//      with d6e Storage. The response gives us an IntentInputFileRef
	//      that execute-by-intent expects.
	//   2. We then call POST /api/intent with the initial creation prompt
	//      and the file ref. The server persists the turn as a new
	//      chat_session row and returns its id so we can keep revising
	//      against the same session.
	//   3. The assistant message is parsed via parse-journal; success
	//      renders either the journal table (kind:"journal") or the
	//      registration result card (kind:"registration"). Anything else
	//      falls back to raw markdown.
	//   4. The "revise" form posts a follow-up message. Its wrapping tag
	//      depends on the current parse kind:
	//        - kind:"journal"       -> <previous_journal>...</previous_journal>
	//          so the LLM regenerates the entries instead of re-OCR.
	//        - kind:"registration"  -> <additional_comment>...</additional_comment>
	//          so the LLM treats it as a continuation of the registration
	//          turn (e.g. user provided a company_id the LLM asked for).
	//      The same fileRef and chatSessionId are re-sent so the server
	//      appends to the same chat_session row.
	//   5. The "freee に登録" button (rendered inside JournalResult when
	//      kind:"journal") triggers handleRegister(). It sends a fixed
	//      registration-request message that wraps the previous journal
	//      JSON inside <registration_request>...</registration_request> so
	//      the LLM dispatches to scenario D (freee + Drive). The response
	//      is parsed into kind:"registration" and rendered as a status
	//      card; from there the user can keep talking to the LLM via the
	//      revise form switched to followup mode.
	//
	// "Pending tasks" section is driven by the SSR loader in
	// +page.server.ts (Promise streaming) which lists chat_session rows
	// with the [keiri] title prefix and no completion suffix. Clicking
	// a card opens TaskDetailDialog so the user can mark it completed
	// (moving it to /tasks) or delete it.

	import { untrack } from 'svelte';

	import AlertCircleIcon from '@lucide/svelte/icons/alert-circle';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import { invalidateAll } from '$app/navigation';

	import JournalResult from '$lib/components/journal-result.svelte';
	import ReceiptUploader from '$lib/components/receipt-uploader.svelte';
	import ReviseCommentForm from '$lib/components/revise-comment-form.svelte';
	import TaskCard from '$lib/components/task-card.svelte';
	import TaskDetailDialog from '$lib/components/task-detail-dialog.svelte';
	import {
		findFreshTaskSummary,
		toFilteredTasks,
		type JournalTaskSummary
	} from '$lib/journal-task';
	import * as m from '$lib/paraglide/messages.js';
	import { parseJournalMessage, type ParseResult } from '$lib/parse-journal';
	import { cn } from '$lib/utils';

	import type { PageData } from './$types';

	interface UploadedFileRef {
		fileId: string;
		filename: string;
		mimeType: string;
		sizeBytes: number;
	}

	const CREATE_PROMPT = '添付した領収書画像を解析して、freee 登録用の仕訳一覧を作成してください。';
	const REGISTER_PROMPT_HEADER =
		'下記の仕訳を freee に登録し、添付の領収書を Google Drive にアップロードしてください。';

	let { data }: { data: PageData } = $props();

	let isLoading = $state(false);
	// Independent flag so the register button can show its own spinner
	// instead of just being disabled while the rest of the page is dimmed.
	let registerInFlight = $state(false);
	let errorMessage = $state<string | null>(null);
	let currentFileRef = $state<UploadedFileRef | null>(null);
	let currentChatSessionId = $state<string | null>(null);
	let parseResult = $state<ParseResult | null>(null);

	let detailOpen = $state(false);
	let detailTask = $state<JournalTaskSummary | null>(null);

	// The revise form switches between two modes depending on the most
	// recent assistant payload kind. Derive it once so the form and the
	// outgoing message wrapper stay in sync.
	const reviseMode = $derived<'journal' | 'followup'>(
		parseResult?.kind === 'registration' ? 'followup' : 'journal'
	);

	async function uploadReceipt(file: File): Promise<UploadedFileRef> {
		const formData = new FormData();
		formData.append('file', file);
		const response = await fetch('/api/upload', { method: 'POST', body: formData });
		const payload: unknown = await response.json().catch(() => ({}));
		if (!response.ok) {
			const errPayload = payload as { error?: string } | null | undefined;
			const detail = errPayload && typeof errPayload.error === 'string' ? errPayload.error : '';
			throw new Error(`Upload failed (${response.status}): ${detail}`);
		}
		return payload as UploadedFileRef;
	}

	async function callIntent(
		message: string,
		fileRef: UploadedFileRef,
		chatSessionId: string | null
	): Promise<{ rawMessage: string; chatSessionId: string | null }> {
		const requestBody: Record<string, unknown> = {
			message,
			inputFileRefs: [fileRef],
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
		const ok = payload as { success?: boolean; message?: string; chatSessionId?: string };
		if (!ok.success) {
			throw new Error(ok.message ?? 'execute-by-intent returned success=false');
		}
		return {
			rawMessage: ok.message ?? '',
			chatSessionId: ok.chatSessionId ?? null
		};
	}

	async function handleFile(file: File): Promise<void> {
		errorMessage = null;
		isLoading = true;
		parseResult = null;
		currentChatSessionId = null;
		try {
			const ref = await uploadReceipt(file);
			currentFileRef = ref;
			const { rawMessage, chatSessionId } = await callIntent(CREATE_PROMPT, ref, null);
			parseResult = parseJournalMessage(rawMessage);
			currentChatSessionId = chatSessionId;
			await invalidateAll();
		} catch (err) {
			const detail = err instanceof Error ? err.message : String(err);
			errorMessage = detail;
			console.error('[ai-journal-page] handleFile failed:', detail);
		} finally {
			isLoading = false;
		}
	}

	async function handleRevise(comment: string): Promise<void> {
		if (!currentFileRef || !parseResult) {
			errorMessage = 'No previous assistant response to revise.';
			return;
		}
		errorMessage = null;
		isLoading = true;
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

			const { rawMessage, chatSessionId } = await callIntent(
				message,
				currentFileRef,
				currentChatSessionId
			);
			parseResult = parseJournalMessage(rawMessage);
			if (chatSessionId) currentChatSessionId = chatSessionId;
			await invalidateAll();
		} catch (err) {
			const detail = err instanceof Error ? err.message : String(err);
			errorMessage = detail;
			console.error('[ai-journal-page] handleRevise failed:', detail);
		} finally {
			isLoading = false;
		}
	}

	async function handleRegister(): Promise<void> {
		if (!currentFileRef || !parseResult || parseResult.kind !== 'journal') {
			errorMessage = 'No journal payload to register.';
			return;
		}
		errorMessage = null;
		isLoading = true;
		registerInFlight = true;
		try {
			const journalJson = JSON.stringify(parseResult.result, null, 2);
			const message = [
				REGISTER_PROMPT_HEADER,
				'<registration_request>',
				journalJson,
				'</registration_request>'
			].join('\n');

			const { rawMessage, chatSessionId } = await callIntent(
				message,
				currentFileRef,
				currentChatSessionId
			);
			parseResult = parseJournalMessage(rawMessage);
			if (chatSessionId) currentChatSessionId = chatSessionId;
			await invalidateAll();
		} catch (err) {
			const detail = err instanceof Error ? err.message : String(err);
			errorMessage = detail;
			console.error('[ai-journal-page] handleRegister failed:', detail);
		} finally {
			registerInFlight = false;
			isLoading = false;
		}
	}

	function handleTaskClick(task: JournalTaskSummary): void {
		detailTask = task;
		detailOpen = true;
	}

	async function handleDialogMutate(): Promise<void> {
		await invalidateAll();
	}

	// Promise streaming: SvelteKit streams the resolved value once the
	// load function in +page.server.ts completes. We hydrate the task
	// summary list lazily so the page chrome (header, uploader, error
	// banner) stays interactive even when d6e is slow.
	const pendingResultPromise = $derived(data.pendingTasks$);
	const pendingTasksPromise = $derived(
		pendingResultPromise.then((result) => toFilteredTasks(result, { completed: false }))
	);

	// Keep the open dialog in sync with the freshest server snapshot so
	// the journal table inside it reflects any revise round-trip that
	// happened while the dialog was open. detailTask is read via
	// untrack() because the .then() callback writes a fresh object back
	// to it; tracking would re-fire the effect and loop forever.
	//
	// The effect cleanup flips `cancelled` so a stale .then() callback
	// from a previous run (e.g. after invalidateAll() swapped the
	// promise) cannot overwrite detailTask with outdated data if it
	// happens to resolve out of order.
	$effect(() => {
		if (!detailOpen) return;
		if (!untrack(() => detailTask)) return;
		let cancelled = false;
		pendingResultPromise.then((result) => {
			if (cancelled) return;
			const current = untrack(() => detailTask);
			if (!current) return;
			const updated = findFreshTaskSummary(result, current.id);
			if (updated) detailTask = updated;
		});
		return () => {
			cancelled = true;
		};
	});
</script>

<div class="space-y-8 p-6 lg:p-10">
	<section class="space-y-2">
		<h1 class="text-3xl font-bold tracking-tight text-foreground">{m.journal_title()}</h1>
		<p class="text-sm text-muted-foreground">{m.journal_description()}</p>
	</section>

	<section class="space-y-4">
		<h2 class="text-lg font-semibold">{m.journal_upload_heading()}</h2>
		<ReceiptUploader onfile={handleFile} disabled={isLoading} />
	</section>

	{#if isLoading}
		<div
			class="flex items-center gap-3 rounded-xl border bg-card p-4 text-sm text-muted-foreground shadow-sm"
		>
			<LoaderCircleIcon class="size-5 animate-spin text-primary" aria-hidden="true" />
			<span>{m.journal_loading()}</span>
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
				registerDisabled={isLoading}
				{registerInFlight}
			/>
			{#if parseResult.kind === 'journal' || parseResult.kind === 'registration'}
				<ReviseCommentForm onsubmit={handleRevise} disabled={isLoading} mode={reviseMode} />
			{/if}
		</section>
	{/if}

	<section class="space-y-4">
		<h2 class="text-lg font-semibold">{m.journal_pending_section()}</h2>
		{#await pendingTasksPromise}
			<div class="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
				{#each Array(3) as _, index (index)}
					<div
						class="flex h-32 flex-col gap-2 rounded-xl border bg-card p-4 shadow-sm"
						aria-busy="true"
					>
						<div class="h-3 w-1/3 animate-pulse rounded bg-muted"></div>
						<div class="h-4 w-2/3 animate-pulse rounded bg-muted"></div>
						<div class="mt-auto h-3 w-1/2 animate-pulse rounded bg-muted"></div>
					</div>
				{/each}
			</div>
		{:then resolved}
			{#if !resolved.ok}
				<div
					class={cn(
						'flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/5 p-4 text-sm text-warning-foreground'
					)}
				>
					<AlertCircleIcon class="mt-0.5 size-5 shrink-0" aria-hidden="true" />
					<p class="break-words">
						{m.task_list_error({ detail: resolved.error ?? 'unknown' })}
					</p>
				</div>
			{:else if resolved.tasks.length === 0}
				<p class="text-sm text-muted-foreground">{m.journal_pending_empty()}</p>
			{:else}
				<div class="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
					{#each resolved.tasks as task (task.id)}
						<TaskCard {task} onclick={handleTaskClick} />
					{/each}
				</div>
			{/if}
		{/await}
	</section>
</div>

<TaskDetailDialog bind:open={detailOpen} task={detailTask} onMutate={handleDialogMutate} />
