<script lang="ts">
	import MailboxView from '$lib/components/MailboxView.svelte';
	import { APP_NAME } from '$lib/constants';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>Drafts — {APP_NAME}</title>
</svelte:head>

<MailboxView view={data.view} mailbox={data.mailbox} filters={data.filters} />
