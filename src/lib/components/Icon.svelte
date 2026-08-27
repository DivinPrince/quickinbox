<script lang="ts">
	let {
		name,
		size = 18,
		class: className = ''
	}: {
		name: string;
		size?: number;
		class?: string;
	} = $props();
</script>

<i class="ri-{name} {className}" style="font-size: {size}px; line-height: 1;"></i>
