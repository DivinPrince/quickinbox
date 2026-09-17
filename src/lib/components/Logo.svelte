<script lang="ts">
	import { APP_NAME } from '$lib/constants';
	import logo from '$lib/assets/logo.png';

	let {
		size = 30,
		class: className = ''
	}: {
		size?: number;
		class?: string;
	} = $props();
</script>

<img
	class="logo {className}"
	src={logo}
	width={size}
	height={size}
	style="width: {size}px; height: {size}px;"
	alt={APP_NAME}
	draggable="false"
/>

<style>
	.logo {
		display: block;
		flex-shrink: 0;
		max-width: none;
		max-height: none;
		border-radius: 26%;
		object-fit: contain;
		object-position: center;
		background: #0a0a0a;
		filter: none;
	}

	:global(:root[data-theme='dark']) .logo {
		background: transparent;
		mix-blend-mode: screen;
	}
</style>
