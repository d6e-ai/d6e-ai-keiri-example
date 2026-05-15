<script lang="ts">
	// Clickable summary card backed by a d6e chat_session row.
	//
	// Renders the parsed journal payload (entry count + total amount) when
	// available, falling back to a "not yet parseable" hint so even rows
	// whose AI response is still streaming or schema-mismatched still
	// surface in the task list. Clicking emits a callback so the parent
	// page can open the detail dialog without coupling this component to
	// any specific dialog implementation.

	import CheckCircle2Icon from '@lucide/svelte/icons/check-circle-2';
	import ClockIcon from '@lucide/svelte/icons/clock';

	import type { JournalTaskSummary } from '$lib/journal-task';
	import { totalJournalAmount } from '$lib/journal-task';
	import * as m from '$lib/paraglide/messages.js';
	import { cn, formatJpyAmount } from '$lib/utils';

	let {
		task,
		onclick
	}: {
		task: JournalTaskSummary;
		onclick?: (task: JournalTaskSummary) => void;
	} = $props();

	const total = $derived(totalJournalAmount(task));
	const entryCount = $derived(task.journal?.entries.length ?? null);
	const updatedLabel = $derived(formatUpdatedAt(task.updatedAt));

	// Format the chat_session.updated_at timestamp as a locale-aware
	// "YYYY/MM/DD HH:mm" string so the card communicates recency without
	// requiring a tooltip. We avoid Intl.RelativeTimeFormat here because
	// "3 minutes ago" interacts badly with SSR (server and client clocks
	// can disagree by a second and produce hydration mismatches).
	function formatUpdatedAt(value: string): string {
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return value;
		const yyyy = date.getFullYear();
		const mm = String(date.getMonth() + 1).padStart(2, '0');
		const dd = String(date.getDate()).padStart(2, '0');
		const hh = String(date.getHours()).padStart(2, '0');
		const min = String(date.getMinutes()).padStart(2, '0');
		return `${yyyy}/${mm}/${dd} ${hh}:${min}`;
	}

	function handleClick(): void {
		onclick?.(task);
	}
</script>

<button
	type="button"
	onclick={handleClick}
	class={cn(
		'flex w-full flex-col gap-2 rounded-xl border bg-card p-4 text-left shadow-sm transition-shadow',
		'hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'
	)}
>
	<div class="flex items-center gap-2 text-xs">
		{#if task.isCompleted}
			<span
				class="inline-flex items-center gap-1 rounded-full bg-success/15 px-2.5 py-0.5 font-medium text-success-foreground"
			>
				<CheckCircle2Icon class="size-3.5" aria-hidden="true" />
				{m.task_card_status_completed()}
			</span>
		{:else}
			<span
				class="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 font-medium text-primary"
			>
				<ClockIcon class="size-3.5" aria-hidden="true" />
				{m.task_card_status_pending()}
			</span>
		{/if}
		<span class="text-muted-foreground">{updatedLabel}</span>
	</div>

	<h3 class="text-sm font-semibold text-foreground">
		{task.displayTitle || m.task_card_untitled()}
	</h3>

	{#if entryCount != null && total != null}
		<p class="text-xs text-muted-foreground">
			{m.task_card_summary({
				count: entryCount,
				amount: formatJpyAmount(total)
			})}
		</p>
	{:else}
		<p class="text-xs text-muted-foreground italic">
			{m.task_card_no_journal()}
		</p>
	{/if}
</button>
