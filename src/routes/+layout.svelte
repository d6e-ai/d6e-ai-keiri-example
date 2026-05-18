<script lang="ts">
	import { page } from '$app/state';

	import './layout.css';

	import AppSidebar from '$lib/components/app-sidebar.svelte';
	import * as m from '$lib/paraglide/messages.js';

	let { children } = $props();

	// Auth routes (/auth/login, /auth/callback, /auth/no-access, ...)
	// must render without the sidebar because the user may not yet be
	// authenticated and the sidebar reads page.data.user. The nested
	// /auth/+layout.svelte still wraps these pages with the bare
	// centred container.
	const isAuthRoute = $derived(page.url.pathname.startsWith('/auth/'));
</script>

<svelte:head>
	<title>{m.app_name()}</title>
</svelte:head>

{#if isAuthRoute}
	{@render children?.()}
{:else}
	<div class="flex min-h-screen bg-background text-foreground">
		<AppSidebar />
		<main class="flex-1 overflow-auto">
			{@render children?.()}
		</main>
	</div>
{/if}
