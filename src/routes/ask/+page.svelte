<script lang="ts">
	// "Ask" page (route "/ask")
	//
	// A minimal 1-turn chat UI for general accounting questions. The
	// LLM is expected to respond in Scenario C (plain markdown, no
	// ```json``` block) per the workspace prompt rule. The reply is run
	// through renderMarkdown() so tables, headings, lists, etc. render
	// the same way they do in the d6e chat UI itself. The Ask page
	// intentionally does not pass any file refs — it is for free-form
	// accounting questions rather than journal generation.

	import AlertCircleIcon from '@lucide/svelte/icons/alert-circle';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';

	import { renderMarkdown } from '$lib/markdown';
	import * as m from '$lib/paraglide/messages.js';
	import { cn } from '$lib/utils';

	let question = $state('');
	let answer = $state<string | null>(null);
	let isLoading = $state(false);
	let errorMessage = $state<string | null>(null);

	const renderedAnswer = $derived(answer ? renderMarkdown(answer) : '');

	async function ask(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		const trimmed = question.trim();
		if (!trimmed || isLoading) return;
		isLoading = true;
		errorMessage = null;
		answer = null;
		try {
			const response = await fetch('/api/intent', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ message: trimmed, persistAs: 'ask' })
			});
			const payload: unknown = await response.json().catch(() => ({}));
			if (!response.ok) {
				const errPayload = payload as { error?: string } | null | undefined;
				const detail = errPayload && typeof errPayload.error === 'string' ? errPayload.error : '';
				throw new Error(`Ask failed (${response.status}): ${detail}`);
			}
			const ok = payload as { success?: boolean; message?: string };
			if (!ok.success) {
				throw new Error(ok.message ?? 'execute-by-intent returned success=false');
			}
			answer = ok.message ?? '';
		} catch (err) {
			const detail = err instanceof Error ? err.message : String(err);
			errorMessage = detail;
			console.error('[ask-page] ask failed:', detail);
		} finally {
			isLoading = false;
		}
	}
</script>

<div class="space-y-8 p-6 lg:p-10">
	<section class="space-y-2">
		<h1 class="text-3xl font-bold tracking-tight">{m.ask_title()}</h1>
		<p class="text-sm text-muted-foreground">{m.ask_description()}</p>
	</section>

	<form class="space-y-3 rounded-xl border bg-card p-4 shadow-sm" onsubmit={ask}>
		<textarea
			class={cn(
				'w-full resize-y rounded-md border bg-background px-3 py-2 text-sm shadow-inner',
				'placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
				'min-h-28'
			)}
			placeholder={m.ask_input_placeholder()}
			bind:value={question}
			disabled={isLoading}
		></textarea>
		<div class="flex justify-end">
			<button
				type="submit"
				class={cn(
					'inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors',
					isLoading || question.trim().length === 0
						? 'cursor-not-allowed opacity-60'
						: 'hover:bg-primary/90'
				)}
				disabled={isLoading || question.trim().length === 0}
			>
				{m.ask_submit()}
			</button>
		</div>
	</form>

	{#if isLoading}
		<div
			class="flex items-center gap-3 rounded-xl border bg-card p-4 text-sm text-muted-foreground shadow-sm"
		>
			<LoaderCircleIcon class="size-5 animate-spin text-primary" aria-hidden="true" />
			<span>{m.ask_loading()}</span>
		</div>
	{/if}

	{#if errorMessage}
		<div
			class={cn(
				'flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm',
				'text-destructive'
			)}
		>
			<AlertCircleIcon class="mt-0.5 size-5 shrink-0" aria-hidden="true" />
			<p class="break-words">{errorMessage}</p>
		</div>
	{/if}

	{#if answer}
		<div class="rounded-xl border bg-card p-4 shadow-sm">
			<div class="prose prose-sm max-w-none dark:prose-invert">
				{@html renderedAnswer}
			</div>
		</div>
	{/if}
</div>
