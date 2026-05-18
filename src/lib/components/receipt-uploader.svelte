<script lang="ts">
	// Drag & drop / file picker for receipt images.
	//
	// Purpose:
	//   Hand back any number of File objects via the onfiles callback so
	//   the parent page can stream them into /api/upload in parallel.
	//   The component itself is stateless beyond hover styling and does
	//   no upload work directly.
	//
	// Main specifications:
	//   - <input type="file" multiple> accepts images and PDFs.
	//   - Drag & drop forwards every File on event.dataTransfer.files.
	//   - The "disabled" prop dampens UI affordances when the parent
	//     is busy (e.g. while /api/intent is running).

	import { UploadCloudIcon } from '@lucide/svelte';

	import * as m from '$lib/paraglide/messages.js';
	import { cn } from '$lib/utils';

	let {
		onfiles,
		disabled = false
	}: {
		onfiles: (files: File[]) => void;
		disabled?: boolean;
	} = $props();

	let isDragging = $state(false);
	let inputEl: HTMLInputElement | undefined = $state();

	function emit(files: FileList | File[] | null | undefined): void {
		if (disabled || !files) return;
		const arr: File[] = [];
		for (const f of Array.from(files)) {
			if (f instanceof File && f.size > 0) {
				arr.push(f);
			}
		}
		if (arr.length === 0) return;
		onfiles(arr);
	}

	function onInputChange(event: Event): void {
		const target = event.currentTarget as HTMLInputElement;
		emit(target.files);
		target.value = '';
	}

	function onDrop(event: DragEvent): void {
		event.preventDefault();
		isDragging = false;
		emit(event.dataTransfer?.files);
	}

	function onDragOver(event: DragEvent): void {
		event.preventDefault();
		if (!disabled) isDragging = true;
	}

	function onDragLeave(): void {
		isDragging = false;
	}

	function openPicker(): void {
		if (!disabled) inputEl?.click();
	}
</script>

<div
	class={cn(
		'flex flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed bg-card p-10 text-center transition-colors',
		isDragging ? 'border-primary bg-primary/5' : 'border-border',
		disabled && 'opacity-60'
	)}
	role="button"
	tabindex="0"
	aria-disabled={disabled}
	ondragover={onDragOver}
	ondragleave={onDragLeave}
	ondrop={onDrop}
	onclick={openPicker}
	onkeydown={(event) => {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			openPicker();
		}
	}}
>
	<UploadCloudIcon class="size-10 text-muted-foreground" aria-hidden="true" />
	<p class="text-sm text-muted-foreground">{m.journal_upload_drop_hint()}</p>
	<button
		type="button"
		class={cn(
			'inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors',
			disabled ? 'cursor-not-allowed' : 'hover:bg-primary/90'
		)}
		{disabled}
		onclick={(event) => {
			event.stopPropagation();
			openPicker();
		}}
	>
		{m.journal_upload_pick_file()}
	</button>
	<input
		bind:this={inputEl}
		type="file"
		multiple
		accept="image/*,application/pdf"
		class="hidden"
		onchange={onInputChange}
	/>
</div>
