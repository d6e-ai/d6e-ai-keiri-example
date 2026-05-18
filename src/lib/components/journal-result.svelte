<script lang="ts">
	// Read-only journal / registration result card for assistant responses.
	//
	// Three branches:
	//   1. parsed.kind === 'journal'       -> render the entries table and,
	//      when a parent supplies onRegister, a "freee に登録" button below
	//      the warnings. Edits are not allowed inline; the user revises via
	//      revise-comment-form.svelte (the parent owns that flow).
	//   2. parsed.kind === 'registration'  -> delegate to RegistrationResult
	//      so the freee deal_ids, Drive uploads, warnings, and any
	//      follow-up question are rendered in the same visual style.
	//   3. parsed.kind === 'fallback'      -> show the markdown-rendered raw
	//      assistant text. The card never goes blank even if the LLM ignored
	//      the JSON contract entirely.
	//
	// The "Raw AI response" disclosure for the journal branch lives at the
	// bottom of the card; the registration branch carries the same
	// disclosure inside its own component for symmetry.

	import AlertTriangleIcon from '@lucide/svelte/icons/alert-triangle';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import SendIcon from '@lucide/svelte/icons/send';

	import RegistrationResult from '$lib/components/registration-result.svelte';
	import { renderMarkdown } from '$lib/markdown';
	import * as m from '$lib/paraglide/messages.js';
	import type { ParseResult } from '$lib/parse-journal';
	import { cn, formatJpyAmount } from '$lib/utils';

	let {
		parsed,
		onRegister,
		registerDisabled = false,
		registerInFlight = false
	}: {
		parsed: ParseResult;
		// Optional callback invoked when the user clicks the "freee に登録"
		// button. Pages that should not expose registration (e.g. the
		// completed-tasks detail dialog) simply omit this prop.
		onRegister?: () => void | Promise<void>;
		// Disables the register button regardless of state. Used while
		// another network call (upload, revise) is in flight.
		registerDisabled?: boolean;
		// Replaces the button label with a spinner + localised loading text
		// when true. Independent from registerDisabled so the parent can
		// still show a busy state for "I am calling /api/intent right now".
		registerInFlight?: boolean;
	} = $props();

	const renderedFallback = $derived(
		parsed.kind === 'fallback' ? renderMarkdown(parsed.rawText) : ''
	);

	const showRegisterButton = $derived(
		parsed.kind === 'journal' && typeof onRegister === 'function'
	);

	function handleRegisterClick(): void {
		if (registerDisabled || registerInFlight) return;
		void onRegister?.();
	}
</script>

{#if parsed.kind === 'journal'}
	{@const result = parsed.result}
	<div class="space-y-4 rounded-xl border bg-card p-4 shadow-sm">
		<h3 class="text-base font-semibold">{m.journal_result_section()}</h3>

		<div class="overflow-x-auto rounded-lg border">
			<table class="min-w-full divide-y divide-border text-sm">
				<thead class="bg-muted/60 text-muted-foreground">
					<tr>
						<th class="px-3 py-2 text-left font-medium">{m.table_date()}</th>
						<th class="px-3 py-2 text-left font-medium">{m.table_debit_account()}</th>
						<th class="px-3 py-2 text-left font-medium">{m.table_credit_account()}</th>
						<th class="px-3 py-2 text-right font-medium">{m.table_amount()}</th>
						<th class="px-3 py-2 text-right font-medium">{m.table_tax_amount()}</th>
						<th class="px-3 py-2 text-left font-medium">{m.table_description()}</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-border bg-card">
					{#each result.entries as entry, index (index)}
						<tr>
							<td class="px-3 py-2 align-top whitespace-nowrap">{entry.date}</td>
							<td class="px-3 py-2 align-top">{entry.debit_account}</td>
							<td class="px-3 py-2 align-top">{entry.credit_account}</td>
							<td class="px-3 py-2 text-right align-top">
								¥{formatJpyAmount(entry.amount)}
							</td>
							<td class="px-3 py-2 text-right align-top text-muted-foreground">
								{entry.tax_amount != null ? `¥${formatJpyAmount(entry.tax_amount)}` : '—'}
							</td>
							<td class="px-3 py-2 align-top">{entry.description}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		{#if result.warnings.length > 0}
			<ul
				class={cn(
					'flex flex-col gap-1 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm',
					'text-warning-foreground'
				)}
			>
				{#each result.warnings as warning, index (index)}
					<li class="flex items-start gap-2">
						<AlertTriangleIcon class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
						<span>{warning}</span>
					</li>
				{/each}
			</ul>
		{/if}

		{#if showRegisterButton}
			<div class="space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
				<div>
					<h4 class="text-sm font-semibold text-foreground">{m.journal_register_heading()}</h4>
					<p class="mt-1 text-xs text-muted-foreground">{m.journal_register_hint()}</p>
				</div>
				<div class="flex justify-end">
					<button
						type="button"
						class={cn(
							'inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors',
							registerDisabled || registerInFlight
								? 'cursor-not-allowed opacity-60'
								: 'hover:bg-primary/90'
						)}
						disabled={registerDisabled || registerInFlight}
						onclick={handleRegisterClick}
					>
						{#if registerInFlight}
							<LoaderCircleIcon class="size-4 animate-spin" aria-hidden="true" />
							{m.journal_register_loading()}
						{:else}
							<SendIcon class="size-4" aria-hidden="true" />
							{m.journal_register_button()}
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
{:else if parsed.kind === 'registration'}
	<RegistrationResult {parsed} />
{:else}
	<div class="space-y-3 rounded-xl border border-warning/40 bg-warning/5 p-4">
		<div class="flex items-center gap-2 text-warning-foreground">
			<AlertTriangleIcon class="size-5" aria-hidden="true" />
			<h3 class="text-base font-semibold">{m.journal_parse_warning()}</h3>
		</div>
		<p class="text-xs text-muted-foreground">reason: {parsed.reason} — {parsed.detail}</p>
		<div class="rounded-md border bg-card p-4">
			<div class="prose prose-sm max-w-none dark:prose-invert">
				{@html renderedFallback}
			</div>
		</div>
	</div>
{/if}
