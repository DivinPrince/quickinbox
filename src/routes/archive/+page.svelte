<script lang="ts">
	import MailboxSlot from '$lib/components/MailboxSlot.svelte';
	import { APP_NAME } from '$lib/constants';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>Archive — {APP_NAME}</title>
</svelte:head>

<MailboxSlot view={data.view} mailbox={data.mailbox} filters={data.filters} />
