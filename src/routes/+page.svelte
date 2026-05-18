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
	//      that comes back is stored so subsequent revise turns append
	//      to the same row.
	//   3. The assistant message is parsed via parse-journal; success
	//      renders the journal table, failure falls back to raw markdown.
	//   4. The "revise" form posts a follow-up message that embeds the
	//      previous JSON inside <previous_journal> tags so the LLM knows
	//      to regenerate rather than re-OCR. The same uploadedRefs are
	//      re-sent so the model can re-examine the original receipts.
	//      The same chatSessionId is passed so the server appends to
	//      that row.
	//
	// "Pending tasks" section is driven by the SSR loader in
	// +page.server.ts (Promise streaming) which lists chat_session rows
	// with the [keiri] title prefix and no completion suffix. Clicking
	// a card opens TaskDetailDialog so the user can mark it completed
	// (moving it to /tasks) or delete it.

	import { untrack } from 'svelte';

	import AlertCircleIcon from '@lucide/svelte/icons/alert-circle';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import PlayIcon from '@lucide/svelte/icons/play';
	import { invalidateAll } from '$app/navigation';

	import JournalResult from '$lib/components/journal-result.svelte';
	import ReceiptUploader from '$lib/components/receipt-uploader.svelte';
	import ReviseCommentForm from '$lib/components/revise-comment-form.svelte';
	import TaskCard from '$lib/components/task-card.svelte';
	import TaskDetailDialog from '$lib/components/task-detail-dialog.svelte';
	import UploadedFileList from '$lib/components/uploaded-file-list.svelte';
	import {
		findFreshTaskSummary,
		toFilteredTasks,
		type JournalTaskSummary
	} from '$lib/journal-task';
	import * as m from '$lib/paraglide/messages.js';
	import { parseJournalMessage, type ParseResult } from '$lib/parse-journal';
	import type { PendingUploadView, UploadedFileView } from '$lib/upload-types';
	import { cn } from '$lib/utils';

	import type { PageData } from './$types';

	const CREATE_PROMPT =
		'添付した領収書画像を解析して、freee 登録用の仕訳一覧を作成してください。' +
		'複数の領収書がある場合はすべて読み取って 1 つの仕訳一覧にまとめてください。';

	let { data }: { data: PageData } = $props();

	let pendingUploads = $state<PendingUploadView[]>([]);
	let uploadedRefs = $state<UploadedFileView[]>([]);

	let isExecuting = $state(false);
	let errorMessage = $state<string | null>(null);
	let currentChatSessionId = $state<string | null>(null);
	let parseResult = $state<ParseResult | null>(null);

	let detailOpen = $state(false);
	let detailTask = $state<JournalTaskSummary | null>(null);

	const hasUploadInFlight = $derived(pendingUploads.some((entry) => entry.status === 'uploading'));
	const canExecute = $derived(uploadedRefs.length > 0 && !hasUploadInFlight && !isExecuting);
	const executeBlockedHint = $derived.by(() => {
		if (isExecuting) return null;
		if (hasUploadInFlight) return m.journal_upload_run_disabled_uploading();
		if (uploadedRefs.length === 0) return m.journal_upload_run_disabled_empty();
		return null;
	});

	function generateLocalId(): string {
		return typeof crypto !== 'undefined' && 'randomUUID' in crypto
			? crypto.randomUUID()
			: `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
	}

	function isUploadedFileView(value: unknown): value is UploadedFileView {
		if (!value || typeof value !== 'object') return false;
		const v = value as Record<string, unknown>;
		return (
			typeof v.fileId === 'string' &&
			v.fileId.length > 0 &&
			typeof v.filename === 'string' &&
			typeof v.mimeType === 'string' &&
			typeof v.sizeBytes === 'number'
		);
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

	async function handleRemove(fileId: string): Promise<void> {
		const targetIndex = uploadedRefs.findIndex((ref) => ref.fileId === fileId);
		if (targetIndex === -1) return;
		const target = uploadedRefs[targetIndex];
		uploadedRefs = uploadedRefs.filter((ref) => ref.fileId !== fileId);

		// Restore the entry to its original position when the server-side
		// delete fails so the user can retry; otherwise the file would
		// disappear from the UI while still occupying d6e Storage.
		const restore = () => {
			if (uploadedRefs.some((ref) => ref.fileId === fileId)) return;
			const insertAt = Math.min(targetIndex, uploadedRefs.length);
			uploadedRefs = [...uploadedRefs.slice(0, insertAt), target, ...uploadedRefs.slice(insertAt)];
		};

		try {
			const response = await fetch(`/api/upload/${encodeURIComponent(fileId)}`, {
				method: 'DELETE'
			});
			if (!response.ok) {
				const detail = `HTTP ${response.status}`;
				errorMessage = m.journal_upload_remove_failed();
				console.error('[ai-journal-page] handleRemove failed:', detail);
				restore();
			}
		} catch (err) {
			const detail = err instanceof Error ? err.message : String(err);
			errorMessage = m.journal_upload_remove_failed();
			console.error('[ai-journal-page] handleRemove network error:', detail);
			restore();
		}
	}

	async function callIntent(
		message: string,
		fileRefs: UploadedFileView[],
		chatSessionId: string | null
	): Promise<{ rawMessage: string; chatSessionId: string | null }> {
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
		const ok = payload as { success?: boolean; message?: string; chatSessionId?: string };
		if (!ok.success) {
			throw new Error(ok.message ?? 'execute-by-intent returned success=false');
		}
		return {
			rawMessage: ok.message ?? '',
			chatSessionId: ok.chatSessionId ?? null
		};
	}

	async function handleExecute(): Promise<void> {
		if (!canExecute) return;
		errorMessage = null;
		isExecuting = true;
		parseResult = null;
		currentChatSessionId = null;
		try {
			const { rawMessage, chatSessionId } = await callIntent(CREATE_PROMPT, uploadedRefs, null);
			parseResult = parseJournalMessage(rawMessage);
			currentChatSessionId = chatSessionId;
			await invalidateAll();
		} catch (err) {
			const detail = err instanceof Error ? err.message : String(err);
			errorMessage = detail;
			console.error('[ai-journal-page] handleExecute failed:', detail);
		} finally {
			isExecuting = false;
		}
	}

	async function handleRevise(comment: string): Promise<void> {
		if (uploadedRefs.length === 0 || !parseResult || parseResult.kind !== 'journal') {
			errorMessage = 'No previous journal to revise.';
			return;
		}
		errorMessage = null;
		isExecuting = true;
		try {
			const previousJson = JSON.stringify(parseResult.result, null, 2);
			const message = [
				'前回生成した仕訳に対する修正依頼です。',
				'<previous_journal>',
				previousJson,
				'</previous_journal>',
				'',
				`修正指示: ${comment}`,
				'',
				'仕訳全体を再生成し、変更を反映した完全な JSON を返してください。'
			].join('\n');

			const { rawMessage, chatSessionId } = await callIntent(
				message,
				uploadedRefs,
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
			isExecuting = false;
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
		<ReceiptUploader onfiles={handleFiles} disabled={isExecuting} />

		<UploadedFileList
			pending={pendingUploads}
			uploaded={uploadedRefs}
			disabled={isExecuting}
			onremove={handleRemove}
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

	{#if isExecuting}
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
			<JournalResult parsed={parseResult} />
			{#if parseResult.kind === 'journal'}
				<ReviseCommentForm onsubmit={handleRevise} disabled={isExecuting} />
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
