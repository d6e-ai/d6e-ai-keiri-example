<script lang="ts">
	// Textarea + submit button used to ask the LLM to regenerate the
	// current journal table with a natural-language correction.
	//
	// The parent page is responsible for embedding the previous JSON
	// inside a <previous_journal>...</previous_journal> tag in the
	// outgoing message; this component is concerned only with the input
	// surface itself.

	import { RefreshCwIcon } from '@lucide/svelte';

	import * as m from '$lib/paraglide/messages.js';
	import { cn } from '$lib/utils';

	let {
		onsubmit,
		disabled = false
	}: {
		onsubmit: (comment: string) => void;
		disabled?: boolean;
	} = $props();

	let comment = $state('');

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
		<h3 class="text-base font-semibold">{m.journal_revise_heading()}</h3>
		<p class="mt-1 text-xs text-muted-foreground">{m.journal_revise_hint()}</p>
	</div>

	<textarea
		class={cn(
			'w-full resize-y rounded-md border bg-background px-3 py-2 text-sm shadow-inner',
			'placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
			'min-h-24'
		)}
		placeholder={m.journal_revise_placeholder()}
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
			<RefreshCwIcon class="size-4" aria-hidden="true" />
			{m.journal_revise_submit()}
		</button>
	</div>
</form>
