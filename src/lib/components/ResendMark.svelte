<script lang="ts">
	/** Compact Resend lettermark tile for pairing with our logo. */
	let {
		size = 48,
		class: className = ''
	}: {
		size?: number;
		class?: string;
	} = $props();
</script>

<svg
	class={className}
	width={size}
	height={size}
	viewBox="0 0 64 64"
	xmlns="http://www.w3.org/2000/svg"
	role="img"
	aria-label="Resend"
>
	<rect width="64" height="64" rx="16.5" fill="#0a0a0a" />
	<!-- Simplified Resend-style R: single intentional stroke -->
	<path
		d="M20 46 V18 H34.5 C41.5 18 46 22.2 46 28.2 C46 33.2 43.2 36.6 38.8 37.8 L48 46 H41.2 L33.2 38.2 H26.5 V46 Z M26.5 32.8 H34 C37.6 32.8 39.8 30.8 39.8 28.1 C39.8 25.4 37.6 23.5 34 23.5 H26.5 Z"
		fill="#fff"
	/>
</svg>
