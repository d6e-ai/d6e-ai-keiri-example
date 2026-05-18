<script lang="ts">
	// Auth route layout (used by /auth/no-access etc.).
	//
	// Bypasses the main sidebar layout because the user may not be
	// authenticated yet, so the sidebar (which expects locals.user)
	// is not safe to render. We still import the global layout.css so
	// the design tokens and Tailwind base styles are available.

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
