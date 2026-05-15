<script lang="ts">
	import TaskCard from '$lib/components/task-card.svelte';
	import { completedTasks } from '$lib/mock-data/tasks';
	import * as m from '$lib/paraglide/messages.js';
</script>

<div class="space-y-8 p-6 lg:p-10">
	<section class="space-y-2">
		<h1 class="text-3xl font-bold tracking-tight">{m.tasks_title()}</h1>
		<p class="text-sm text-muted-foreground">{m.tasks_description()}</p>
	</section>

	<section class="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
		{#each completedTasks as task (task.id)}
			<TaskCard {task} />
		{/each}
	</section>
</div>
