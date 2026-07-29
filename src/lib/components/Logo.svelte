<script lang="ts">
	// The app mark: a sage tile with a mail-check glyph. Kept inline so it stays
	// crisp at any size and can be dropped straight into a flex row.
	let {
		size = 30,
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
	aria-label="Mail"
>
	<rect width="64" height="64" rx="16.5" fill="#90ac9a" />
	<g
		transform="translate(9.7 9.7) scale(1.858)"
		fill="none"
		stroke="#363636"
		stroke-width="2.3"
		stroke-linecap="round"
		stroke-linejoin="round"
	>
		<path d="M22 13V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v12c0 1.1.9 2 2 2h8" />
		<path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
		<path d="m16 19 2 2 4-4" />
	</g>
</svg>
