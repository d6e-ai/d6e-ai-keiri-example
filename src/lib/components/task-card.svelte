<script lang="ts">
	// Read-only card used in the "pending tasks" list on the AI Journal page
	// and the "completed tasks" list on /tasks. The card is intentionally
	// non-interactive in the example; wiring it to a real backend (open
	// task detail, resume revision, etc.) is C-case work.

	import type { JournalTask } from '$lib/mock-data/tasks';
	import * as m from '$lib/paraglide/messages.js';
	import { cn, formatJpyAmount } from '$lib/utils';

	let { task }: { task: JournalTask } = $props();

	function statusLabel(status: JournalTask['status']): string {
		switch (status) {
			case 'drive_unregistered':
				return m.journal_status_drive_unregistered();
			case 'pending_approval':
				return m.journal_status_pending_approval();
			case 'revising':
				return m.journal_status_revising();
			case 'completed':
				return m.journal_status_completed();
		}
	}

	function statusTone(status: JournalTask['status']): string {
		switch (status) {
			case 'drive_unregistered':
				return 'bg-warning/15 text-warning-foreground';
			case 'pending_approval':
				return 'bg-primary/10 text-primary';
			case 'revising':
				return 'bg-accent text-accent-foreground';
			case 'completed':
				return 'bg-success/15 text-success-foreground';
		}
	}
</script>

<article
	class="flex flex-col gap-2 rounded-xl border bg-card p-4 shadow-sm transition-shadow hover:shadow-md"
>
	<div class="flex items-center gap-3">
		<span
			class={cn(
				'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
				statusTone(task.status)
			)}
		>
			{statusLabel(task.status)}
		</span>
		<span class="text-xs text-muted-foreground">{task.date}</span>
		<span class="text-xs text-muted-foreground">
			{m.journal_pending_count({ count: task.receiptCount })}
		</span>
		<span class="text-xs font-medium text-foreground">
			{m.journal_amount({ amount: formatJpyAmount(task.amountJpy) })}
		</span>
	</div>
	<h3 class="text-sm font-semibold text-foreground">{task.title}</h3>
	<p class="text-sm text-muted-foreground">{task.description}</p>
</article>
