<script lang="ts">
	import MailboxSlot from '$lib/components/MailboxSlot.svelte';
	import { APP_NAME } from '$lib/constants';
	import { t } from '$lib/i18n';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>{t('mailbox.pageTitle', { folder: t('nav.trash'), app: APP_NAME })}</title>
</svelte:head>

<MailboxSlot view={data.view} mailbox={data.mailbox} filters={data.filters} />
