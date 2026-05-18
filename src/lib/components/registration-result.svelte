<script lang="ts">
	// Read-only summary card for `kind: "registration"` LLM responses.
	//
	// Renders the freee deal IDs that were actually written, the Google Drive
	// uploads with their webViewLinks (when available), and any warnings the
	// LLM surfaced. When status === 'needs_input', a prominent follow-up
	// question box is shown so the user knows to reply via the revise comment
	// form below.
	//
	// The component never mutates anything; the parent page is responsible for
	// resending the user's follow-up comment back into /api/intent. The raw
	// assistant text is exposed via a <details> disclosure to keep parity with
	// JournalResult and aid debugging when the schema barely matched.
	//
	// When the parent supplies an `onComplete` callback and the status is
	// 'success', a "完了にする" button is rendered below the data sections.
	// Clicking it asks the parent to mark the chat_session as completed
	// (moving it to /tasks completed tab) and reset the page.

	import AlertCircleIcon from '@lucide/svelte/icons/alert-circle';
	import AlertTriangleIcon from '@lucide/svelte/icons/alert-triangle';
	import CheckCircle2Icon from '@lucide/svelte/icons/check-circle-2';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import HelpCircleIcon from '@lucide/svelte/icons/help-circle';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';

	import * as m from '$lib/paraglide/messages.js';
	import type { ParsedRegistration } from '$lib/parse-journal';
	import { cn, formatJpyAmount } from '$lib/utils';

	let {
		parsed,
		onComplete,
		completeDisabled = false,
		completeInFlight = false
	}: {
		parsed: ParsedRegistration;
		// Optional callback invoked when the user clicks the "完了にする"
		// button. The button is hidden when this prop is omitted so
		// surfaces that should not expose completion (e.g. the task
		// detail dialog) leave it off.
		onComplete?: () => void | Promise<void>;
		// Disables the complete button regardless of state. Used while
		// the parent has another network call in flight.
		completeDisabled?: boolean;
		// Replaces the button label with a spinner + localised loading
		// text. Independent from completeDisabled so the parent can
		// still convey "I am marking this completed right now".
		completeInFlight?: boolean;
	} = $props();

	// Derived view-model. Keeping these in $derived() rather than inline
	// keeps the template flat and makes the empty-state logic easy to
	// follow when reading the markup.
	const status = $derived(parsed.result.status);
	const freee = $derived(parsed.result.freee);
	const drive = $derived(parsed.result.drive);
	const warnings = $derived(parsed.result.warnings);
	const followUpQuestion = $derived(
		parsed.result.status === 'needs_input' ? parsed.result.follow_up_question : null
	);

	// Map status enum values to a label string + a Tailwind class set for
	// the badge. The four pairs intentionally cover all enum values so the
	// switch never falls through to a default.
	const statusLabel = $derived.by(() => {
		switch (status) {
			case 'success':
				return m.registration_status_success();
			case 'partial':
				return m.registration_status_partial();
			case 'failed':
				return m.registration_status_failed();
			case 'needs_input':
				return m.registration_status_needs_input();
		}
	});

	const statusBadgeClass = $derived.by(() => {
		switch (status) {
			case 'success':
				return 'bg-success/15 text-success-foreground border-success/30';
			case 'partial':
				return 'bg-warning/15 text-warning-foreground border-warning/40';
			case 'failed':
				return 'bg-destructive/10 text-destructive border-destructive/30';
			case 'needs_input':
				return 'bg-primary/10 text-primary border-primary/30';
		}
	});

	function formatCompanyId(value: number | string | null): string {
		if (value == null) return '';
		return typeof value === 'number' ? String(value) : value;
	}

	function formatDealId(value: number | string): string {
		return typeof value === 'number' ? String(value) : value;
	}

	// "完了" は status === 'success' のときだけ意味がある。partial /
	// failed / needs_input は仕訳がまだ閉じ切っていないのでボタンを出さない。
	const showCompleteButton = $derived(status === 'success' && typeof onComplete === 'function');

	function handleCompleteClick(): void {
		if (completeDisabled || completeInFlight) return;
		void onComplete?.();
	}
</script>

<div class="space-y-4 rounded-xl border bg-card p-4 shadow-sm">
	<div class="flex items-center gap-3">
		<h3 class="text-base font-semibold">{m.registration_result_section()}</h3>
		<span
			class={cn(
				'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium',
				statusBadgeClass
			)}
			aria-label={m.registration_status_label()}
		>
			{#if status === 'success'}
				<CheckCircle2Icon class="size-3.5" aria-hidden="true" />
			{:else if status === 'failed'}
				<AlertCircleIcon class="size-3.5" aria-hidden="true" />
			{:else if status === 'partial'}
				<AlertTriangleIcon class="size-3.5" aria-hidden="true" />
			{:else}
				<HelpCircleIcon class="size-3.5" aria-hidden="true" />
			{/if}
			{statusLabel}
		</span>
	</div>

	{#if followUpQuestion}
		<div
			class={cn(
				'flex items-start gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm'
			)}
		>
			<HelpCircleIcon class="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
			<div class="space-y-1">
				<p class="font-semibold text-foreground">{m.registration_follow_up_question()}</p>
				<p class="break-words text-foreground/90">{followUpQuestion}</p>
				<p class="text-xs text-muted-foreground">{m.registration_follow_up_hint()}</p>
			</div>
		</div>
	{/if}

	<section class="space-y-2">
		<div class="flex items-center justify-between gap-3">
			<h4 class="text-sm font-semibold">{m.registration_freee_heading()}</h4>
			{#if freee?.company_id != null}
				<span class="text-xs text-muted-foreground">
					{m.registration_freee_company_id({ value: formatCompanyId(freee.company_id) })}
				</span>
			{/if}
		</div>
		{#if !freee}
			<p class="text-sm text-muted-foreground">{m.registration_freee_not_attempted()}</p>
		{:else if freee.deals.length === 0}
			<p class="text-sm text-muted-foreground">{m.registration_freee_empty()}</p>
		{:else}
			<div class="overflow-x-auto rounded-lg border">
				<table class="min-w-full divide-y divide-border text-sm">
					<thead class="bg-muted/60 text-muted-foreground">
						<tr>
							<th class="px-3 py-2 text-left font-medium">{m.registration_table_deal_id()}</th>
							<th class="px-3 py-2 text-left font-medium">{m.table_date()}</th>
							<th class="px-3 py-2 text-right font-medium">{m.table_amount()}</th>
							<th class="px-3 py-2 text-left font-medium">{m.table_description()}</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-border bg-card">
						{#each freee.deals as deal, index (index)}
							<tr>
								<td class="px-3 py-2 align-top font-mono text-xs">{formatDealId(deal.deal_id)}</td>
								<td class="px-3 py-2 align-top whitespace-nowrap">{deal.date}</td>
								<td class="px-3 py-2 text-right align-top">¥{formatJpyAmount(deal.amount)}</td>
								<td class="px-3 py-2 align-top">{deal.description}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</section>

	<section class="space-y-2">
		<h4 class="text-sm font-semibold">{m.registration_drive_heading()}</h4>
		{#if !drive}
			<p class="text-sm text-muted-foreground">{m.registration_drive_not_attempted()}</p>
		{:else if drive.uploads.length === 0}
			<p class="text-sm text-muted-foreground">{m.registration_drive_empty()}</p>
		{:else}
			<ul class="space-y-2">
				{#each drive.uploads as upload, index (index)}
					<li
						class="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-background px-3 py-2 text-sm"
					>
						<span class="break-all">{upload.name}</span>
						{#if upload.web_view_link}
							<a
								class={cn(
									'inline-flex items-center gap-1 rounded-md border border-primary/40 bg-primary/5 px-2.5 py-1 text-xs font-medium text-primary',
									'transition-colors hover:bg-primary/10'
								)}
								href={upload.web_view_link}
								target="_blank"
								rel="noopener noreferrer"
							>
								<ExternalLinkIcon class="size-3.5" aria-hidden="true" />
								{m.registration_drive_open_link()}
							</a>
						{:else}
							<span class="text-xs text-muted-foreground">{m.registration_drive_no_link()}</span>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	{#if warnings.length > 0}
		<ul
			class={cn(
				'flex flex-col gap-1 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm',
				'text-warning-foreground'
			)}
		>
			{#each warnings as warning, index (index)}
				<li class="flex items-start gap-2">
					<AlertTriangleIcon class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
					<span>{warning}</span>
				</li>
			{/each}
		</ul>
	{/if}

	{#if showCompleteButton}
		<div class="space-y-2 rounded-lg border border-success/40 bg-success/5 p-3">
			<div>
				<h4 class="text-sm font-semibold text-foreground">{m.journal_complete_heading()}</h4>
				<p class="mt-1 text-xs text-muted-foreground">{m.journal_complete_hint()}</p>
			</div>
			<div class="flex justify-end">
				<button
					type="button"
					class={cn(
						'inline-flex items-center gap-2 rounded-md bg-success px-4 py-2 text-sm font-medium text-success-foreground shadow-sm transition-colors',
						completeDisabled || completeInFlight
							? 'cursor-not-allowed opacity-60'
							: 'hover:bg-success/90'
					)}
					disabled={completeDisabled || completeInFlight}
					onclick={handleCompleteClick}
				>
					{#if completeInFlight}
						<LoaderCircleIcon class="size-4 animate-spin" aria-hidden="true" />
						{m.journal_complete_loading()}
					{:else}
						<CheckCircle2Icon class="size-4" aria-hidden="true" />
						{m.journal_complete_button()}
					{/if}
				</button>
			</div>
		</div>
	{/if}

	<details class="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
		<summary class="cursor-pointer text-sm font-medium text-foreground">Raw AI response</summary>
		<pre class="mt-2 break-words whitespace-pre-wrap">{parsed.rawText}</pre>
	</details>
</div>
