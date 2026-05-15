<script lang="ts">
	// Read-only journal table for AI-generated entries. The table is
	// intentionally non-editable; users revise entries by submitting a
	// natural-language comment which re-runs execute-by-intent (see
	// revise-comment-form.svelte). If the LLM response could not be
	// parsed into the JSON contract, this component renders a fallback
	// banner with the raw assistant text so the user is never shown a
	// blank screen.

	import { AlertTriangleIcon } from '@lucide/svelte';

	import * as m from '$lib/paraglide/messages.js';
	import type { ParseResult } from '$lib/parse-journal';
	import { cn, formatJpyAmount } from '$lib/utils';

	let { parsed }: { parsed: ParseResult } = $props();
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

		<details class="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
			<summary class="cursor-pointer text-sm font-medium text-foreground">Raw AI response</summary>
			<pre class="mt-2 break-words whitespace-pre-wrap">{parsed.rawText}</pre>
		</details>
	</div>
{:else}
	<div class="space-y-3 rounded-xl border border-warning/40 bg-warning/5 p-4">
		<div class="flex items-center gap-2 text-warning-foreground">
			<AlertTriangleIcon class="size-5" aria-hidden="true" />
			<h3 class="text-base font-semibold">{m.journal_parse_warning()}</h3>
		</div>
		<p class="text-xs text-muted-foreground">reason: {parsed.reason} — {parsed.detail}</p>
		<pre
			class="overflow-x-auto rounded-md border bg-card p-3 text-xs break-words whitespace-pre-wrap">{parsed.rawText}</pre>
	</div>
{/if}
