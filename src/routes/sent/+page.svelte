<script lang="ts">
	import MailboxView from '$lib/components/MailboxView.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>Sent — Mail</title>
</svelte:head>

<MailboxView view={data.view} mailbox={data.mailbox} filters={data.filters} />
