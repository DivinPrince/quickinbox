<script lang="ts">
	import SettingsPage from '$lib/components/SettingsPage.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<SettingsPage {data} section={data.section} />
