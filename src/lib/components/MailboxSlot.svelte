<script lang="ts">
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
</script>

<ZeroMailbox {view} {mailbox} {filters} />
