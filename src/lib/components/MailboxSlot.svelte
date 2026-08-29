<script lang="ts">
	import { page } from '$app/stores';
	import MailboxView from '$lib/components/MailboxView.svelte';
	import ZeroMailbox from '$themes/zero/mail/Mailbox.svelte';
	import type { MailboxFilters, MailboxPage, MailboxView as MailView } from '$lib/types';

	let {
		view,
		mailbox,
		filters
	}: {
		view: MailView;
		mailbox: MailboxPage;
		filters: MailboxFilters;
	} = $props();

	const zero = $derived(($page.data.uiTheme ?? 'zero') !== 'classic');
</script>

{#if zero}
	<ZeroMailbox {view} {mailbox} {filters} />
{:else}
	<MailboxView {view} {mailbox} {filters} />
{/if}
