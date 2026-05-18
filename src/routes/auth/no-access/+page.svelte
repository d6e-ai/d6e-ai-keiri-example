<script lang="ts">
	// /auth/no-access page.
	//
	// Shown when /auth/callback successfully exchanged an authorization
	// code for tokens but the user is not a member of D6E_WORKSPACE_ID.
	// The session cookies are already cleared at this point, so the
	// page is reachable by anonymous browsers as well (no infinite
	// redirect loop with hooks.server.ts).
	//
	// The page deliberately does not display any contact information
	// (per requirement); it just tells the user to reach out to their
	// workspace administrator.

	import ShieldAlertIcon from '@lucide/svelte/icons/shield-alert';

	import * as m from '$lib/paraglide/messages.js';
</script>

<div class="space-y-8 p-6 lg:p-10">
	<section class="space-y-2">
		<h1 class="text-3xl font-bold tracking-tight text-foreground">{m.auth_no_access_title()}</h1>
		<p class="text-sm text-muted-foreground">{m.auth_no_access_lead()}</p>
	</section>

	<section class="space-y-4">
		<div
			class="flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive"
		>
			<ShieldAlertIcon class="mt-0.5 size-5 shrink-0" aria-hidden="true" />
			<div class="space-y-2">
				<p class="font-semibold">{m.auth_no_access_body()}</p>
				<p class="text-muted-foreground">{m.auth_no_access_admin_hint()}</p>
			</div>
		</div>

		<div class="flex gap-3">
			<a
				href="/auth/login"
				class="inline-flex items-center justify-center rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-foreground shadow-sm hover:bg-muted"
			>
				{m.auth_login_retry()}
			</a>
		</div>
	</section>
</div>
