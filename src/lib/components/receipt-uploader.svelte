<script lang="ts">
	// Drag & drop / file picker for receipt images. Emits a single File
	// through the `onfile` callback so the parent page owns the upload
	// pipeline (POST /api/upload -> /api/intent). The component itself
	// is stateless beyond hover styling.

	import { UploadCloudIcon } from '@lucide/svelte';

	import * as m from '$lib/paraglide/messages.js';
	import { cn } from '$lib/utils';

	let {
		onfile,
		disabled = false
	}: {
		onfile: (file: File) => void;
		disabled?: boolean;
	} = $props();

	let isDragging = $state(false);
	let inputEl: HTMLInputElement | undefined = $state();

	function emit(file: File | null | undefined): void {
		if (disabled || !file) return;
		onfile(file);
	}

	function onInputChange(event: Event): void {
		const target = event.currentTarget as HTMLInputElement;
		emit(target.files?.[0]);
		target.value = '';
	}

	function onDrop(event: DragEvent): void {
		event.preventDefault();
		isDragging = false;
		const file = event.dataTransfer?.files?.[0];
		emit(file);
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
		accept="image/*,application/pdf"
		class="hidden"
		onchange={onInputChange}
	/>
</div>
