<script lang="ts">
	// AI Journal page (route "/")
	//
	// End-to-end flow:
	//   1. User drops a receipt image -> POST /api/upload to register it
	//      with d6e Storage. The response gives us an IntentInputFileRef
	//      that execute-by-intent expects.
	//   2. We then call POST /api/intent with the initial creation prompt
	//      and the file ref.
	//   3. The assistant message is parsed via parse-journal; success
	//      renders the journal table, failure falls back to raw markdown.
	//   4. The "revise" form posts a follow-up message that embeds the
	//      previous JSON inside <previous_journal> tags so the LLM knows
	//      to regenerate rather than re-OCR. The same fileRef is re-sent
	//      so the model can re-examine the original receipt.

	import AlertCircleIcon from '@lucide/svelte/icons/alert-circle';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';

	import JournalResult from '$lib/components/journal-result.svelte';
	import ReceiptUploader from '$lib/components/receipt-uploader.svelte';
	import ReviseCommentForm from '$lib/components/revise-comment-form.svelte';
	import TaskCard from '$lib/components/task-card.svelte';
	import { pendingTasks } from '$lib/mock-data/tasks';
	import * as m from '$lib/paraglide/messages.js';
	import { parseJournalMessage, type ParseResult } from '$lib/parse-journal';
	import { cn } from '$lib/utils';

	interface UploadedFileRef {
		fileId: string;
		filename: string;
		mimeType: string;
		sizeBytes: number;
	}

	const CREATE_PROMPT = '添付した領収書画像を解析して、freee 登録用の仕訳一覧を作成してください。';

	let isLoading = $state(false);
	let errorMessage = $state<string | null>(null);
	let currentFileRef = $state<UploadedFileRef | null>(null);
	let parseResult = $state<ParseResult | null>(null);

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
		fileRef: UploadedFileRef
	): Promise<{ rawMessage: string }> {
		const response = await fetch('/api/intent', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ message, inputFileRefs: [fileRef] })
		});
		const payload: unknown = await response.json().catch(() => ({}));
		if (!response.ok) {
			const errPayload = payload as { error?: string } | null | undefined;
			const detail = errPayload && typeof errPayload.error === 'string' ? errPayload.error : '';
			throw new Error(`Execute-by-intent failed (${response.status}): ${detail}`);
		}
		const ok = payload as { success?: boolean; message?: string };
		if (!ok.success) {
			throw new Error(ok.message ?? 'execute-by-intent returned success=false');
		}
		return { rawMessage: ok.message ?? '' };
	}

	async function handleFile(file: File): Promise<void> {
		errorMessage = null;
		isLoading = true;
		parseResult = null;
		try {
			const ref = await uploadReceipt(file);
			currentFileRef = ref;
			const { rawMessage } = await callIntent(CREATE_PROMPT, ref);
			parseResult = parseJournalMessage(rawMessage);
		} catch (err) {
			const detail = err instanceof Error ? err.message : String(err);
			errorMessage = detail;
			console.error('[ai-journal-page] handleFile failed:', detail);
		} finally {
			isLoading = false;
		}
	}

	async function handleRevise(comment: string): Promise<void> {
		if (!currentFileRef || !parseResult || parseResult.kind !== 'journal') {
			errorMessage = 'No previous journal to revise.';
			return;
		}
		errorMessage = null;
		isLoading = true;
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

			const { rawMessage } = await callIntent(message, currentFileRef);
			parseResult = parseJournalMessage(rawMessage);
		} catch (err) {
			const detail = err instanceof Error ? err.message : String(err);
			errorMessage = detail;
			console.error('[ai-journal-page] handleRevise failed:', detail);
		} finally {
			isLoading = false;
		}
	}
</script>

<div class="space-y-8 p-6 lg:p-10">
	<section class="space-y-2">
		<p class="text-xs font-semibold tracking-wider text-primary uppercase">
			Google Workspace inspired
		</p>
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
			<JournalResult parsed={parseResult} />
			{#if parseResult.kind === 'journal'}
				<ReviseCommentForm onsubmit={handleRevise} disabled={isLoading} />
			{/if}
		</section>
	{/if}

	<section class="space-y-4">
		<h2 class="text-lg font-semibold">{m.journal_pending_section()}</h2>
		<div class="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
			{#each pendingTasks as task (task.id)}
				<TaskCard {task} />
			{/each}
		</div>
	</section>
</div>
