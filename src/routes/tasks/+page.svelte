<script lang="ts">
	// Completed tasks page (route "/tasks")
	//
	// Lists chat_session rows whose title carries both the [keiri] prefix
	// and the " #completed" suffix. Same Promise streaming + Skeleton
	// pattern as the AI Journal page. Clicking a card opens the same
	// TaskDetailDialog so users can unmark completion or delete the row.

	import AlertCircleIcon from '@lucide/svelte/icons/alert-circle';
	import { invalidateAll } from '$app/navigation';

	import TaskCard from '$lib/components/task-card.svelte';
	import TaskDetailDialog from '$lib/components/task-detail-dialog.svelte';
	import {
		deriveJournalTaskSummary,
		filterJournalSessions,
		type JournalTaskSummary
	} from '$lib/journal-task';
	import * as m from '$lib/paraglide/messages.js';
	import { cn } from '$lib/utils';

	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let detailOpen = $state(false);
	let detailTask = $state<JournalTaskSummary | null>(null);

	const completedResultPromise = $derived(data.completedTasks$);
	const completedTasksPromise = $derived(
		completedResultPromise.then((result) =>
			result.ok
				? {
						ok: true as const,
						tasks: filterJournalSessions(result.rows, { completed: true })
					}
				: {
						ok: false as const,
						tasks: [] as JournalTaskSummary[],
						error: result.error
					}
		)
	);

	function handleTaskClick(task: JournalTaskSummary): void {
		detailTask = task;
		detailOpen = true;
	}

	async function handleDialogMutate(): Promise<void> {
		await invalidateAll();
	}

	$effect(() => {
		if (!detailOpen || !detailTask) return;
		completedResultPromise.then((result) => {
			if (!result.ok || !detailTask) return;
			const match = result.rows.find((row) => row.id === detailTask?.id);
			if (match) {
				detailTask = deriveJournalTaskSummary(match);
			}
		});
	});
</script>

<div class="space-y-8 p-6 lg:p-10">
	<section class="space-y-2">
		<h1 class="text-3xl font-bold tracking-tight">{m.tasks_title()}</h1>
		<p class="text-sm text-muted-foreground">{m.tasks_description()}</p>
	</section>

	<section class="space-y-4">
		{#await completedTasksPromise}
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
				<p class="text-sm text-muted-foreground">{m.tasks_empty()}</p>
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
