<script lang="ts">
	import { buildEmailDocument, emailCss, isRichHtml } from '$lib/utils/email-html';
	import { foldQuotedHtml } from '$lib/utils/quotes';

	const STYLE_ID = '__mail-frame-style';

	let { html }: { html: string } = $props();

	const rich = $derived(isRichHtml(html));
	const srcdoc = $derived(buildEmailDocument(html, { rich }));

	let frame = $state<HTMLIFrameElement | null>(null);
	let height = $state(0);

	let content: ResizeObserver | null = null;
	let theme: MutationObserver | null = null;

	/**
	 * The frame has no scrollbar of its own; it is sized to its content. Measured
	 * on <body>, never on <html>: the root element's scrollHeight is floored at
	 * the viewport, which here is the height we just set — so it could only ever
	 * grow, never settle back down.
	 */
	function measure() {
		const doc = frame?.contentDocument;
		if (!doc?.body) return;

		const body = Math.max(doc.body.scrollHeight, doc.body.offsetHeight);
		const next = Math.ceil(body || doc.documentElement.scrollHeight);
		if (next > 0 && Math.abs(next - height) > 1) height = next;
	}

	function syncTheme() {
		const doc = frame?.contentDocument;
		if (!doc) return;
		doc.documentElement.dataset.theme = document.documentElement.dataset.theme ?? 'light';
	}

	/**
	 * The frame is same-origin but scriptless — `sandbox` withholds
	 * allow-scripts — so everything the message needs is done from out here.
	 */
	/** Messages that arrived as a whole document get our rules appended. */
	function applyStyles(doc: Document) {
		if (doc.getElementById(STYLE_ID)) return;

		const style = doc.createElement('style');
		style.id = STYLE_ID;
		style.textContent = emailCss(rich);
		(doc.head ?? doc.documentElement).appendChild(style);

		// Without a <base> of ours, a link would try to navigate this frame — which
		// the sandbox blocks, so the click would simply do nothing.
		for (const link of Array.from(doc.links)) {
			link.setAttribute('target', '_blank');
			link.setAttribute('rel', 'noopener noreferrer');
		}
	}

	function onLoad() {
		const doc = frame?.contentDocument;
		if (!doc?.body) return;

		applyStyles(doc);
		syncTheme();
		foldQuotedHtml(doc.body);
		measure();

		// Images settle after load and change the height with them.
		for (const image of Array.from(doc.images)) {
			if (image.complete) continue;
			image.addEventListener('load', measure, { once: true });
			image.addEventListener('error', measure, { once: true });
		}

		content?.disconnect();
		content = new ResizeObserver(measure);
		content.observe(doc.body);

		theme?.disconnect();
		theme = new MutationObserver(syncTheme);
		theme.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ['data-theme']
		});
	}

	/**
	 * A srcdoc frame can finish loading before this component hydrates, in which
	 * case its load event is already gone and nothing would ever size it. The
	 * timer is the backstop: a message that resists measurement is shown at a
	 * readable height and left to scroll rather than hidden.
	 */
	$effect(() => {
		void srcdoc;

		const doc = frame?.contentDocument;
		if (doc?.readyState === 'complete' && doc.body?.hasChildNodes()) onLoad();

		const timer = setTimeout(() => {
			// onLoad is idempotent, and reaching here without it having run would
			// reveal an unstyled, light-schemed frame.
			onLoad();
			measure();
			if (height === 0) {
				const document_ = frame?.contentDocument;
				if (document_) document_.documentElement.style.overflowY = 'auto';
				height = 360;
			}
		}, 700);

		return () => clearTimeout(timer);
	});

	$effect(() => () => {
		content?.disconnect();
		theme?.disconnect();
	});
</script>

<iframe
	bind:this={frame}
	class="frame"
	class:rich
	class:sized={height > 0}
	title="Message content"
	sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
	referrerpolicy="no-referrer"
	{srcdoc}
	onload={onLoad}
	style:height={height ? `${height}px` : undefined}
></iframe>

<style>
	.frame {
		display: block;
		width: 100%;
		min-height: 1.5rem;
		border: 0;
		/* Until the first measurement lands the height is a guess; hide the jump. */
		opacity: 0;
	}

	.frame.sized {
		opacity: 1;
		transition: opacity 0.12s;
	}

	/* A designed message sits on the white page it was built for, so give it a
	   card to sit on — in both themes. */
	.frame.rich {
		border-radius: 0.75rem;
		background: #ffffff;
	}
</style>
