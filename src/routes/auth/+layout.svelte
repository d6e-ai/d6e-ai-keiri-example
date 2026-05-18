<script lang="ts">
	// Auth route layout (used by /auth/no-access etc.).
	//
	// Renders a bare, centred container without the sidebar. The root
	// +layout.svelte detects /auth/* paths and skips the sidebar
	// wrapper for them, so this nested layout only contributes the
	// max-width content well. We still import the global layout.css
	// so the design tokens and Tailwind base styles are available.

	import '../layout.css';

	import * as m from '$lib/paraglide/messages.js';

	let { children } = $props();
</script>

<svelte:head>
	<title>{m.app_name()}</title>
</svelte:head>

<div class="min-h-screen bg-background text-foreground">
	<main class="mx-auto max-w-2xl">
		{@render children?.()}
	</main>
</div>
