<script lang="ts">
	// Tasks page (route "/tasks").
	//
	// Two-tab view over chat_session rows whose title carries the [keiri]
	// prefix:
	//   - "Pending"   (default): rows WITHOUT the " #completed" suffix.
	//                  Clicking a card navigates to /?chatSessionId=<id>
	//                  so the user can resume editing the AI journal.
	//   - "Completed":           rows with the " #completed" suffix.
	//                  Clicking a card opens TaskDetailDialog where the
	//                  user can unmark completion or delete the row.
	//
	// State persistence:
	//   The active tab lives in the URL query (?status=pending|completed)
	//   so reloads, deep links, and browser back/forward all behave the
	//   way users expect. The server load uses the same query to choose
	//   `initialStatus`, and an $effect mirrors any URL-driven change
	//   back into the local activeStatus state.

	import { untrack } from 'svelte';

	import AlertCircleIcon from '@lucide/svelte/icons/alert-circle';
	import { goto, invalidateAll, replaceState } from '$app/navigation';

	import TaskCard from '$lib/components/task-card.svelte';
	import TaskDetailDialog from '$lib/components/task-detail-dialog.svelte';
	import {
		findFreshTaskSummary,
		toFilteredTasks,
		type JournalTaskSummary
	} from '$lib/journal-task';
	import * as m from '$lib/paraglide/messages.js';
	import { cn } from '$lib/utils';

	import type { TaskStatus } from './+page.server';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// data.initialStatus is reconciled with the local state in the
	// $effect below whenever the loader re-runs (e.g. URL query
	// changes). The "only captures the initial value" semantics here
	// are intentional, so silence Svelte's lint about it.
	// svelte-ignore state_referenced_locally
	let activeStatus = $state<TaskStatus>(data.initialStatus);
	let detailOpen = $state(false);
	let detailTask = $state<JournalTaskSummary | null>(null);

	const tasksResultPromise = $derived(data.tasks$);
	const pendingPromise = $derived(
		tasksResultPromise.then((result) => toFilteredTasks(result, { completed: false }))
	);
	const completedPromise = $derived(
		tasksResultPromise.then((result) => toFilteredTasks(result, { completed: true }))
	);
	const activePromise = $derived(activeStatus === 'pending' ? pendingPromise : completedPromise);

	const activeDescription = $derived(
		activeStatus === 'pending' ? m.tasks_pending_resume_hint() : m.tasks_description()
	);
	const activeEmptyMessage = $derived(
		activeStatus === 'pending' ? m.tasks_empty_pending() : m.tasks_empty()
	);

	// Keep the local activeStatus aligned with the SSR-provided
	// initialStatus. This fires when the URL query changes from outside
	// (e.g. clicking a sidebar link that targets a specific tab) so the
	// pill highlight follows along without requiring the user to click
	// the tab manually.
	$effect(() => {
		if (data.initialStatus !== untrack(() => activeStatus)) {
			activeStatus = data.initialStatus;
		}
	});

	function switchTab(status: TaskStatus): void {
		if (activeStatus === status) return;
		activeStatus = status;
		if (typeof window === 'undefined') return;
		const params = new URLSearchParams(window.location.search);
		params.set('status', status);
		const queryString = params.toString();
		const nextHref = queryString
			? `${window.location.pathname}?${queryString}`
			: window.location.pathname;
		const currentHref = window.location.pathname + window.location.search;
		if (currentHref === nextHref) return;
		// replaceState keeps the back button targeted at the previous
		// page (most often "/") instead of stepping through every tab
		// flick the user does on the way to finding the right card.
		replaceState(nextHref, {});
	}

	function handlePendingTaskClick(task: JournalTaskSummary): void {
		// Navigate to the AI Journal page with the chat session id so
		// the user can resume editing. Using goto() (instead of an
		// <a href>) keeps the click target as the whole TaskCard
		// button without introducing a nested-interactive element.
		void goto(`/?chatSessionId=${encodeURIComponent(task.id)}`);
	}

	function handleCompletedTaskClick(task: JournalTaskSummary): void {
		detailTask = task;
		detailOpen = true;
	}

	async function handleDialogMutate(): Promise<void> {
		await invalidateAll();
	}

	// detailTask is read via untrack() to avoid a re-entrant effect
	// loop: the .then() callback below writes a fresh
	// deriveJournalTaskSummary() object back to detailTask, and
	// tracking it here would refire the effect.
	$effect(() => {
		if (!detailOpen) return;
		if (!untrack(() => detailTask)) return;
		let cancelled = false;
		tasksResultPromise.then((result) => {
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
		<h1 class="text-3xl font-bold tracking-tight">{m.tasks_title()}</h1>
		<p class="text-sm text-muted-foreground">{activeDescription}</p>
	</section>

	<div class="flex gap-1 border-b border-border" role="tablist" aria-label={m.tasks_title()}>
		<button
			type="button"
			role="tab"
			aria-selected={activeStatus === 'pending'}
			class={cn(
				'-mb-px inline-flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition-colors',
				activeStatus === 'pending'
					? 'border-primary text-primary'
					: 'border-transparent text-muted-foreground hover:text-foreground'
			)}
			onclick={() => switchTab('pending')}
		>
			{m.tasks_tab_pending()}
		</button>
		<button
			type="button"
			role="tab"
			aria-selected={activeStatus === 'completed'}
			class={cn(
				'-mb-px inline-flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition-colors',
				activeStatus === 'completed'
					? 'border-primary text-primary'
					: 'border-transparent text-muted-foreground hover:text-foreground'
			)}
			onclick={() => switchTab('completed')}
		>
			{m.tasks_tab_completed()}
		</button>
	</div>

	<section class="space-y-4" role="tabpanel">
		{#await activePromise}
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
				<p class="text-sm text-muted-foreground">{activeEmptyMessage}</p>
			{:else}
				<div class="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
					{#each resolved.tasks as task (task.id)}
						<TaskCard
							{task}
							onclick={activeStatus === 'pending'
								? handlePendingTaskClick
								: handleCompletedTaskClick}
						/>
					{/each}
				</div>
			{/if}
		{/await}
	</section>
</div>

<TaskDetailDialog bind:open={detailOpen} task={detailTask} onMutate={handleDialogMutate} />
