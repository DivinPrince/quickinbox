<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { startMailboxLiveSync } from '$lib/mail/live';

	$effect(() => startMailboxLiveSync(invalidateAll));
</script>
