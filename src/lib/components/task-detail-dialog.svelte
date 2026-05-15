<script lang="ts">
	// Detail dialog used by the AI Journal page and the Completed Tasks page.
	//
	// Wraps bits-ui's Dialog primitive so we get a focus trap / overlay
	// without pulling in the full shadcn-svelte ui kit. The dialog itself
	// is purely presentational; the parent owns the `open` state and the
	// `onMutate` callback so it can call invalidateAll() after a PATCH /
	// DELETE round-trip.
	//
	// Actions:
	//   - Mark completed / unmark completed: PATCH /api/chat-sessions/{id}
	//     with a rewritten title. We compute the new title client-side via
	//     markCompletedTitle / unmarkCompletedTitle so the suffix
	//     convention lives in exactly one place.
	//   - Delete: DELETE /api/chat-sessions/{id}. The user is asked to
	//     confirm via the browser's confirm() dialog because deletion is
	//     destructive and we have not yet built a custom confirmation UI.

	import AlertCircleIcon from '@lucide/svelte/icons/alert-circle';
	import CheckCircle2Icon from '@lucide/svelte/icons/check-circle-2';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import XIcon from '@lucide/svelte/icons/x';
	import { Dialog } from 'bits-ui';

	import JournalResult from '$lib/components/journal-result.svelte';
	import type { JournalTaskSummary } from '$lib/journal-task';
	import { markCompletedTitle, unmarkCompletedTitle } from '$lib/journal-title';
	import * as m from '$lib/paraglide/messages.js';
	import { cn } from '$lib/utils';

	let {
		open = $bindable(false),
		task,
		onMutate
	}: {
		open?: boolean;
		task: JournalTaskSummary | null;
		onMutate?: () => void | Promise<void>;
	} = $props();

	let actionInFlight = $state<'completing' | 'uncompleting' | 'deleting' | null>(null);
	let errorMessage = $state<string | null>(null);

	function closeDialog(): void {
		if (actionInFlight) return;
		open = false;
	}

	async function patchTitle(targetTitle: string): Promise<void> {
		if (!task) return;
		const response = await fetch(`/api/chat-sessions/${encodeURIComponent(task.id)}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ title: targetTitle })
		});
		const payload: unknown = await response.json().catch(() => ({}));
		if (!response.ok) {
			const detail =
				payload && typeof payload === 'object' && 'error' in payload
					? String((payload as { error?: unknown }).error ?? '')
					: '';
			throw new Error(`PATCH failed (${response.status}): ${detail}`);
		}
	}

	async function deleteSession(): Promise<void> {
		if (!task) return;
		const response = await fetch(`/api/chat-sessions/${encodeURIComponent(task.id)}`, {
			method: 'DELETE'
		});
		const payload: unknown = await response.json().catch(() => ({}));
		if (!response.ok) {
			const detail =
				payload && typeof payload === 'object' && 'error' in payload
					? String((payload as { error?: unknown }).error ?? '')
					: '';
			throw new Error(`DELETE failed (${response.status}): ${detail}`);
		}
	}

	async function handleMarkCompleted(): Promise<void> {
		if (!task) return;
		errorMessage = null;
		actionInFlight = 'completing';
		try {
			await patchTitle(markCompletedTitle(task.title));
			await onMutate?.();
			open = false;
		} catch (err) {
			const detail = err instanceof Error ? err.message : String(err);
			errorMessage = detail;
			console.error('[task-detail-dialog] mark completed failed:', detail);
		} finally {
			actionInFlight = null;
		}
	}

	async function handleUnmarkCompleted(): Promise<void> {
		if (!task) return;
		errorMessage = null;
		actionInFlight = 'uncompleting';
		try {
			await patchTitle(unmarkCompletedTitle(task.title));
			await onMutate?.();
			open = false;
		} catch (err) {
			const detail = err instanceof Error ? err.message : String(err);
			errorMessage = detail;
			console.error('[task-detail-dialog] unmark completed failed:', detail);
		} finally {
			actionInFlight = null;
		}
	}

	async function handleDelete(): Promise<void> {
		if (!task) return;
		const confirmed =
			typeof window !== 'undefined' ? window.confirm(m.task_detail_delete_confirm()) : false;
		if (!confirmed) return;

		errorMessage = null;
		actionInFlight = 'deleting';
		try {
			await deleteSession();
			await onMutate?.();
			open = false;
		} catch (err) {
			const detail = err instanceof Error ? err.message : String(err);
			errorMessage = detail;
			console.error('[task-detail-dialog] delete failed:', detail);
		} finally {
			actionInFlight = null;
		}
	}
</script>

<Dialog.Root
	bind:open
	onOpenChange={(next) => {
		if (!next) {
			errorMessage = null;
		}
	}}
>
	<Dialog.Portal>
		<Dialog.Overlay
			class="fixed inset-0 z-50 bg-black/40 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0"
		/>
		<Dialog.Content
			class={cn(
				'fixed top-1/2 left-1/2 z-50 -translate-x-1/2 -translate-y-1/2',
				'max-h-[85vh] w-[min(90vw,42rem)] overflow-y-auto rounded-2xl border bg-card p-6 shadow-xl',
				'data-[state=closed]:animate-out data-[state=open]:animate-in',
				'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
				'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95'
			)}
		>
			{#if task}
				<div class="space-y-5">
					<div class="flex items-start justify-between gap-3">
						<div class="space-y-1">
							<Dialog.Title class="text-base font-semibold text-foreground">
								{task.displayTitle || m.task_card_untitled()}
							</Dialog.Title>
							<Dialog.Description class="text-xs text-muted-foreground">
								{task.isCompleted
									? m.task_detail_status_completed()
									: m.task_detail_status_pending()}
							</Dialog.Description>
						</div>
						<Dialog.Close
							class="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
							aria-label={m.task_detail_close()}
							disabled={actionInFlight != null}
						>
							<XIcon class="size-4" aria-hidden="true" />
						</Dialog.Close>
					</div>

					{#if task.parseResult}
						<JournalResult parsed={task.parseResult} />
					{:else}
						<div
							class="rounded-xl border border-dashed bg-muted/30 p-4 text-sm text-muted-foreground"
						>
							{m.task_detail_no_response()}
						</div>
					{/if}

					{#if errorMessage}
						<div
							class={cn(
								'flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive'
							)}
						>
							<AlertCircleIcon class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
							<p class="break-words">{errorMessage}</p>
						</div>
					{/if}

					<div class="flex flex-wrap items-center justify-end gap-2">
						<button
							type="button"
							class="inline-flex items-center gap-2 rounded-md border border-destructive/30 bg-card px-3 py-2 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-60"
							disabled={actionInFlight != null}
							onclick={handleDelete}
						>
							{#if actionInFlight === 'deleting'}
								<LoaderCircleIcon class="size-4 animate-spin" aria-hidden="true" />
							{:else}
								<Trash2Icon class="size-4" aria-hidden="true" />
							{/if}
							{m.task_detail_delete()}
						</button>
						{#if task.isCompleted}
							<button
								type="button"
								class="inline-flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
								disabled={actionInFlight != null}
								onclick={handleUnmarkCompleted}
							>
								{#if actionInFlight === 'uncompleting'}
									<LoaderCircleIcon class="size-4 animate-spin" aria-hidden="true" />
								{:else}
									<RotateCcwIcon class="size-4" aria-hidden="true" />
								{/if}
								{m.task_detail_unmark_completed()}
							</button>
						{:else}
							<button
								type="button"
								class="inline-flex items-center gap-2 rounded-md bg-success px-3 py-2 text-sm font-medium text-success-foreground transition-colors hover:bg-success/90 disabled:cursor-not-allowed disabled:opacity-60"
								disabled={actionInFlight != null}
								onclick={handleMarkCompleted}
							>
								{#if actionInFlight === 'completing'}
									<LoaderCircleIcon class="size-4 animate-spin" aria-hidden="true" />
								{:else}
									<CheckCircle2Icon class="size-4" aria-hidden="true" />
								{/if}
								{m.task_detail_mark_completed()}
							</button>
						{/if}
						<button
							type="button"
							class="inline-flex items-center gap-2 rounded-md bg-secondary px-3 py-2 text-sm font-medium text-secondary-foreground transition-colors hover:bg-secondary/80 disabled:cursor-not-allowed disabled:opacity-60"
							disabled={actionInFlight != null}
							onclick={closeDialog}
						>
							{m.task_detail_close()}
						</button>
					</div>
				</div>
			{/if}
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>
