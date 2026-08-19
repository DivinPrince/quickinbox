<script lang="ts">
	/**
	 * One circle for every face in the app.
	 *
	 * It always renders initials first, then layers the real picture on top once
	 * it loads. Most addresses have no picture anywhere, so the initials are the
	 * normal state rather than a placeholder -- and a 404 costs nothing visually
	 * because there was never a gap to fill.
	 */
	type Props = {
		email: string;
		name?: string | null;
		size?: number;
		/** Renders the muted "me" circle used for the user's own messages. */
		self?: boolean;
		/** Bump to defeat the response cache after the picture is replaced. */
		version?: string | number | null;
	};

	let { email, name = null, size = 36, self = false, version = null }: Props = $props();

	let failed = $state(false);
	// Reset when the address changes, or one miss would blank every later avatar.
	$effect(() => {
		void email;
		failed = false;
	});

	const label = $derived.by(() => {
		if (self) return 'me';
		const source = (name ?? '').trim() || email.trim();
		if (!source) return '?';
		// "Ada Lovelace" -> AL, "ada@x.com" -> A
		const words = source.split(/[\s._-]+/).filter(Boolean);
		if (words.length > 1 && !source.includes('@')) {
			return (words[0][0] + words[1][0]).toUpperCase();
		}
		return source[0].toUpperCase();
	});

	/** Stable hue per address, so the same person keeps the same colour. */
	const hue = $derived.by(() => {
		let hash = 0;
		const key = email.trim().toLowerCase();
		for (let i = 0; i < key.length; i++) {
			hash = (hash * 31 + key.charCodeAt(i)) % 360;
		}
		return hash;
	});

	const src = $derived(
		email.includes('@')
			? `/api/avatars/${encodeURIComponent(email)}${version ? `?v=${version}` : ''}`
			: null
	);
</script>

<span
	class="avatar"
	class:self
	style="--avatar-size: {size}px; --avatar-hue: {hue}; font-size: {Math.max(
		10,
		Math.round(size * 0.34)
	)}px"
	title={email}
>
	<span class="initials">{label}</span>

	{#if src && !failed && !self}
		<img
			{src}
			alt=""
			loading="lazy"
			decoding="async"
			onerror={() => (failed = true)}
		/>
	{/if}
</span>

<style>
	.avatar {
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: var(--avatar-size);
		height: var(--avatar-size);
		border-radius: 9999px;
		overflow: hidden;
		font-weight: 600;
		line-height: 1;
		user-select: none;
		/* Tinted per address, but kept near the app's muted palette rather than
		   a saturated rainbow. */
		color: hsl(var(--avatar-hue) 32% 30%);
		background: hsl(var(--avatar-hue) 34% 86%);
	}

	:global(:root[data-theme='dark']) .avatar {
		color: hsl(var(--avatar-hue) 30% 80%);
		background: hsl(var(--avatar-hue) 22% 26%);
	}

	/* The user's own messages stay deliberately neutral. */
	.avatar.self,
	:global(:root[data-theme='dark']) .avatar.self {
		color: var(--color-text-secondary);
		background: var(--color-surface-hover);
	}

	.initials {
		/* Sits under the image so there is never a flash of empty circle. */
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	img {
		position: relative;
		width: 100%;
		height: 100%;
		object-fit: cover;
		/* A broken or still-loading image must not paint over the initials. */
		background: inherit;
	}
</style>
