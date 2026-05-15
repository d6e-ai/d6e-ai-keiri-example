<script lang="ts">
	import './layout.css';

	import AppSidebar from '$lib/components/app-sidebar.svelte';
	import * as m from '$lib/paraglide/messages.js';

	let { children } = $props();
</script>

<svelte:head>
	<title>{m.app_name()}</title>
</svelte:head>

<div class="flex min-h-screen bg-background text-foreground">
	<AppSidebar />
	<main class="flex-1 overflow-auto">
		{@render children?.()}
	</main>
</div>
