<script lang="ts">
	// /auth/login page.
	//
	// Purpose:
	//   Renders a deliberate "Sign in with d6e" splash so the user has
	//   to opt-in to the OAuth round-trip. Submitting the form posts to
	//   the page's default action (+page.server.ts), which performs the
	//   actual 303 to d6e-auth's authorize endpoint. This page replaces
	//   the previous +server.ts that immediately redirected the browser
	//   away without any visible UI.
	//
	// Main specifications:
	//   - The form posts back to the same route so SvelteKit dispatches
	//     to actions.default. The returnTo string surfaced by load() is
	//     round-tripped via a hidden input so the user lands on the
	//     originally requested page after authentication.
	//   - The d6e provider mark is loaded directly from d6e.ai so the
	//     icon stays in sync with the upstream brand without bundling
	//     a local copy.
	//   - The layout follows the project skeleton (space-y-8 p-6 lg:p-10
	//     wrapping two sections), and the /auth/+layout.svelte parent
	//     already centres the content well without a sidebar.
	//
	// Limitations:
	//   - Loading the favicon from a third-party origin means the splash
	//     needs network reachability to www.d6e.ai. If the image fails
	//     the button still works; only the icon is missing.

	import * as m from '$lib/paraglide/messages.js';

	let { data } = $props();
</script>

<div class="space-y-8 p-6 lg:p-10">
	<section class="space-y-2 text-center">
		<h1 class="text-3xl font-bold tracking-tight text-foreground">{m.auth_login_title()}</h1>
		<p class="text-sm text-muted-foreground">{m.auth_login_lead()}</p>
	</section>

	<section class="space-y-4">
		<div
			class="space-y-2 rounded-xl border border-border bg-card p-5 text-sm text-card-foreground shadow-sm"
		>
			<p class="font-semibold text-foreground">{m.app_name()}</p>
			<p class="text-muted-foreground">{m.auth_login_app_overview()}</p>
		</div>

		<form method="POST" class="space-y-3">
			<input type="hidden" name="returnTo" value={data.returnTo} />
			<button
				type="submit"
				class="inline-flex w-full items-center justify-center gap-3 rounded-md border border-border bg-foreground px-4 py-3 text-base font-semibold text-background shadow-sm transition-opacity hover:opacity-90"
			>
				<img
					src="https://www.d6e.ai/favicon.png"
					alt=""
					class="size-6 rounded-sm bg-background p-0.5"
					aria-hidden="true"
				/>
				<span>{m.auth_login_sign_in_with_d6e()}</span>
			</button>
			<p class="text-center text-xs text-muted-foreground">{m.auth_login_provider_hint()}</p>
		</form>
	</section>
</div>
