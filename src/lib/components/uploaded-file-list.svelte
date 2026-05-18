<script lang="ts">
	// List of receipt files currently in the upload queue.
	//
	// Purpose:
	//   Visualise both files mid-upload (spinner + filename) and files
	//   that have already received a d6e fileId (filename + size + a
	//   remove button). The parent owns the actual removal logic; this
	//   component only emits an onremove(fileId) callback.
	//
	// Main specifications:
	//   - Pending entries are keyed by their local id (UI-only), so the
	//     parent can patch progress / error states without re-rendering
	//     unrelated rows.
	//   - Uploaded entries are keyed by their server-assigned fileId.
	//   - The remove button is disabled while the parent is busy
	//     (e.g. mid-execute) to avoid races between DELETE and intent.
	//   - When `readonly` is true the component switches to a "receipts
	//     used" view: all remove / dismiss buttons are hidden and the
	//     heading is swapped for a past-tense label. The parent uses
	//     this mode after a journal has been generated so the receipts
	//     that were OCR'd cannot be deleted mid-conversation.

	import CheckCircle2Icon from '@lucide/svelte/icons/check-circle-2';
	import FileTextIcon from '@lucide/svelte/icons/file-text';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';

	import * as m from '$lib/paraglide/messages.js';
	import type { PendingUploadView, UploadedFileView } from '$lib/upload-types';
	import { cn } from '$lib/utils';

	let {
		pending,
		uploaded,
		disabled = false,
		readonly = false,
		onremove,
		ondismiss
	}: {
		pending: PendingUploadView[];
		uploaded: UploadedFileView[];
		disabled?: boolean;
		// When true, the heading switches to "Receipts used" and every
		// row's remove / dismiss button is hidden. The parent renders
		// this mode once a journal has been generated so the receipts
		// referenced by the assistant turn cannot be removed mid-thread.
		readonly?: boolean;
		onremove: (fileId: string) => void;
		ondismiss: (localId: string) => void;
	} = $props();

	const headingLabel = $derived(
		readonly ? m.journal_upload_files_used_heading() : m.journal_upload_files_heading()
	);

	function formatSize(bytes: number): string {
		if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}

	const totalCount = $derived(pending.length + uploaded.length);
</script>

<section class="space-y-3 rounded-xl border bg-card p-4 shadow-sm">
	<div class="flex items-center justify-between">
		<h3 class="text-sm font-semibold">{headingLabel}</h3>
		<span class="text-xs text-muted-foreground">
			{m.journal_upload_file_count({ count: String(totalCount) })}
		</span>
	</div>

	{#if totalCount === 0}
		<p class="text-sm text-muted-foreground">{m.journal_upload_files_empty()}</p>
	{:else}
		<ul class="space-y-2">
			{#each pending as item (item.localId)}
				<li
					class={cn(
						'flex items-center gap-3 rounded-lg border bg-background px-3 py-2 text-sm',
						item.status === 'error' ? 'border-destructive/40' : 'border-border'
					)}
				>
					{#if item.status === 'uploading'}
						<LoaderCircleIcon class="size-4 animate-spin text-primary" aria-hidden="true" />
					{:else}
						<TriangleAlertIcon class="size-4 text-destructive" aria-hidden="true" />
					{/if}
					<div class="min-w-0 flex-1">
						<p class="truncate font-medium" title={item.filename}>{item.filename}</p>
						<p
							class={cn(
								'text-xs',
								item.status === 'error' ? 'text-destructive' : 'text-muted-foreground'
							)}
						>
							{item.status === 'uploading'
								? m.journal_upload_uploading()
								: (item.errorMessage ?? '')}
						</p>
					</div>
					{#if item.status === 'error' && !readonly}
						<button
							type="button"
							class={cn(
								'inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors',
								disabled ? 'cursor-not-allowed opacity-50' : 'hover:bg-muted hover:text-destructive'
							)}
							{disabled}
							aria-label={m.journal_upload_remove()}
							onclick={() => ondismiss(item.localId)}
						>
							<Trash2Icon class="size-4" aria-hidden="true" />
						</button>
					{/if}
				</li>
			{/each}

			{#each uploaded as file (file.fileId)}
				<li
					class="flex items-center gap-3 rounded-lg border border-border bg-background px-3 py-2 text-sm"
				>
					<CheckCircle2Icon class="size-4 text-success" aria-hidden="true" />
					<FileTextIcon class="size-4 text-muted-foreground" aria-hidden="true" />
					<div class="min-w-0 flex-1">
						<p class="truncate font-medium" title={file.filename}>{file.filename}</p>
						<p class="text-xs text-muted-foreground">{formatSize(file.sizeBytes)}</p>
					</div>
					{#if !readonly}
						<button
							type="button"
							class={cn(
								'inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors',
								disabled ? 'cursor-not-allowed opacity-50' : 'hover:bg-muted hover:text-destructive'
							)}
							{disabled}
							aria-label={m.journal_upload_remove()}
							onclick={() => onremove(file.fileId)}
						>
							<Trash2Icon class="size-4" aria-hidden="true" />
						</button>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</section>
