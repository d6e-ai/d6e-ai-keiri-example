<script lang="ts">
	// Left navigation rail used by the root layout. Pure Svelte 5 + Tailwind,
	// no shadcn-svelte sidebar primitive so the component stays easy to
	// modify later. The current route is highlighted via the `page` store
	// so that highlight state stays in sync with browser back/forward
	// navigation.

	import { CheckSquareIcon, HelpCircleIcon, SparklesIcon } from '@lucide/svelte';
	import { page } from '$app/state';

	import * as m from '$lib/paraglide/messages.js';
	import { cn } from '$lib/utils';

	type NavItem = {
		href: string;
		labelKey: 'nav_journal' | 'nav_tasks' | 'nav_ask';
		icon: typeof SparklesIcon;
	};

	const items: NavItem[] = [
		{ href: '/', labelKey: 'nav_journal', icon: SparklesIcon },
		{ href: '/tasks', labelKey: 'nav_tasks', icon: CheckSquareIcon },
		{ href: '/ask', labelKey: 'nav_ask', icon: HelpCircleIcon }
	];

	function isActive(href: string): boolean {
		const pathname = page.url.pathname;
		if (href === '/') return pathname === '/';
		return pathname === href || pathname.startsWith(href + '/');
	}

	function labelFor(key: NavItem['labelKey']): string {
		if (key === 'nav_journal') return m.nav_journal();
		if (key === 'nav_tasks') return m.nav_tasks();
		return m.nav_ask();
	}
</script>

<aside
	class="flex w-64 shrink-0 flex-col gap-6 border-r border-sidebar-border bg-sidebar p-5 text-sidebar-foreground"
>
	<div class="flex items-center gap-3">
		<div
			class="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-purple-500 text-base font-bold text-white shadow-sm"
		>
			経
		</div>
		<div class="leading-tight">
			<div class="text-sm font-semibold">{m.app_name()}</div>
			<div class="text-xs text-muted-foreground">{m.app_subtitle()}</div>
		</div>
	</div>

	<nav class="flex flex-col gap-1">
		{#each items as item (item.href)}
			{@const active = isActive(item.href)}
			<a
				href={item.href}
				class={cn(
					'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
					active
						? 'bg-sidebar-accent text-sidebar-accent-foreground'
						: 'text-sidebar-foreground hover:bg-sidebar-accent/60'
				)}
				aria-current={active ? 'page' : undefined}
			>
				<item.icon class="size-4" aria-hidden="true" />
				<span>{labelFor(item.labelKey)}</span>
			</a>
		{/each}
	</nav>
</aside>
