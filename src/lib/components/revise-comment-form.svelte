<script lang="ts">
	// Textarea + submit button used to send a natural-language follow-up
	// message to /api/intent. Two modes are supported via the `mode` prop:
	//
	//   - 'journal'  (default) -> "Revise the table" UX. Parent embeds the
	//     previous JSON inside <previous_journal>...</previous_journal>
	//     before calling executeByIntent so the LLM regenerates the entries.
	//   - 'followup'           -> generic "send another comment" UX used
	//     after a registration turn. Parent wraps the text in
	//     <additional_comment>...</additional_comment> so the LLM treats it
	//     as a continuation of the registration conversation instead of a
	//     revise request.
	//
	// This component is concerned only with the input surface itself:
	// labels, placeholder, and button text. Networking, persistence, and
	// the surrounding chat session context are all handled by the parent
	// page.

	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import SendIcon from '@lucide/svelte/icons/send';

	import * as m from '$lib/paraglide/messages.js';
	import { cn } from '$lib/utils';

	export type ReviseFormMode = 'journal' | 'followup';

	let {
		onsubmit,
		disabled = false,
		mode = 'journal'
	}: {
		onsubmit: (comment: string) => void;
		disabled?: boolean;
		mode?: ReviseFormMode;
	} = $props();

	let comment = $state('');

	const heading = $derived(
		mode === 'followup' ? m.revise_form_heading_followup() : m.revise_form_heading_journal()
	);
	const hint = $derived(
		mode === 'followup' ? m.revise_form_hint_followup() : m.revise_form_hint_journal()
	);
	const placeholder = $derived(
		mode === 'followup' ? m.revise_form_placeholder_followup() : m.revise_form_placeholder_journal()
	);
	const submitLabel = $derived(
		mode === 'followup' ? m.revise_form_submit_followup() : m.revise_form_submit_journal()
	);

	function submit(event: SubmitEvent): void {
		event.preventDefault();
		const trimmed = comment.trim();
		if (disabled || trimmed.length === 0) return;
		onsubmit(trimmed);
		comment = '';
	}
</script>

<form class="space-y-3 rounded-xl border bg-card p-4 shadow-sm" onsubmit={submit}>
	<div>
		<h3 class="text-base font-semibold">{heading}</h3>
		<p class="mt-1 text-xs text-muted-foreground">{hint}</p>
	</div>

	<textarea
		class={cn(
			'w-full resize-y rounded-md border bg-background px-3 py-2 text-sm shadow-inner',
			'placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
			'min-h-24'
		)}
		{placeholder}
		bind:value={comment}
		{disabled}
	></textarea>

	<div class="flex justify-end">
		<button
			type="submit"
			class={cn(
				'inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors',
				disabled || comment.trim().length === 0
					? 'cursor-not-allowed opacity-60'
					: 'hover:bg-primary/90'
			)}
			disabled={disabled || comment.trim().length === 0}
		>
			{#if mode === 'followup'}
				<SendIcon class="size-4" aria-hidden="true" />
			{:else}
				<RefreshCwIcon class="size-4" aria-hidden="true" />
			{/if}
			{submitLabel}
		</button>
	</div>
</form>
