<script lang="ts">
	import ClassicThread from '$lib/components/ClassicThread.svelte';
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();
</script>

<ClassicThread {data} />
