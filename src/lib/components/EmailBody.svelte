<script lang="ts">
	import { browser } from '$app/environment';
	import { EMAIL_STYLE_ID, buildEmailDocument, emailCss, isRichHtml } from '$lib/utils/email-html';
	import { canFoldQuotes, foldQuotedHtml } from '$lib/utils/quotes';
	import { t } from '$lib/i18n';

	let { html }: { html: string } = $props();

	const rich = $derived(isRichHtml(html));

	/**
	 * Stamped on <html> by the inline script in app.html, so it is settled well
	 * before this runs — but only in the browser. Reading it up front rather
	 * than in an effect keeps the first document correct; switching themes later
	 * rebuilds it, since a recoloured message cannot be restyled in place.
	 */
	let theme = $state(browser ? (document.documentElement.dataset.theme ?? 'light') : 'light');

	/**
	 * Rendering the frame on the server would bake in a theme it cannot know and
	 * cost a reload to correct, and nothing about a scriptless frame benefits
	 * from it: the frame is invisible until measured from out here.
	 */
	const srcdoc = $derived(browser ? buildEmailDocument(html, { rich, theme }) : '');

	let mounted = $state(false);
	let frame = $state<HTMLIFrameElement | null>(null);
	let height = $state(0);
	let painted = $state(false);
	let quoted = $state<Element[]>([]);
	let quotesOpen = $state(false);

	let content: ResizeObserver | null = null;
	let images: ReturnType<typeof setInterval> | null = null;
	let prepared: Document | null = null;
	let revealFrame: number | null = null;
	let revealPaint: number | null = null;

	function cancelReveal() {
		if (revealFrame !== null) cancelAnimationFrame(revealFrame);
		if (revealPaint !== null) cancelAnimationFrame(revealPaint);
		revealFrame = null;
		revealPaint = null;
	}

	/**
	 * WebKit can dispatch load before the iframe's composited layer is ready.
	 * Keep it layout-active but hidden through that boundary, then expose the
	 * final layer once. There is deliberately no transition or opacity change.
	 */
	function revealAfterPaint(doc: Document) {
		cancelReveal();
		revealFrame = requestAnimationFrame(() => {
			revealPaint = requestAnimationFrame(() => {
				if (frame?.contentDocument === doc && height > 0) painted = true;
				revealFrame = null;
				revealPaint = null;
			});
		});
	}

	// Keep the server and first hydration pass identical. The iframe is created
	// immediately afterward with srcdoc already attached, so Safari never paints
	// an intermediate white about:blank document.
	$effect(() => {
		mounted = true;
	});

	/**
	 * The frame has no scrollbar of its own; it is sized to its content. Body
	 * dimensions are authoritative after the first pass; the root is consulted
	 * only before sizing, because Safari floors its scrollHeight at the iframe
	 * viewport and would otherwise prevent a shorter message from shrinking.
	 */
	function measure() {
		const doc = frame?.contentDocument;
		if (!doc?.body) return;

		// WebKit can report the table's height on the root while body.scrollHeight
		// is still the height of the last painted fragment. Use every independent
		// signal, otherwise a late-loading marketing image can leave the upper part
		// of a forwarded message outside the iframe's measured viewport.
		const body = Math.max(doc.body.scrollHeight, doc.body.offsetHeight);
		// Once sized, the root's scrollHeight includes the iframe viewport itself
		// in Safari. It is useful only for the first pass, before that viewport has
		// been set, or it would make a later shorter message impossible to shrink.
		const root = height === 0
			? Math.max(doc.documentElement.scrollHeight, doc.documentElement.offsetHeight)
			: 0;
		const next = Math.ceil(Math.max(body, root));
		if (next > 0 && Math.abs(next - height) > 1) height = next;
	}

	/** A theme switch rebuilds the document, so the frame reloads with it. */
	$effect(() => {
		const root = document.documentElement;
		const read = () => (theme = root.dataset.theme ?? 'light');

		read();
		const observer = new MutationObserver(read);
		observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
		return () => observer.disconnect();
	});

	/**
	 * The frame is same-origin but scriptless — `sandbox` withholds
	 * allow-scripts — so everything the message needs is done from out here.
	 */
	function applyStyles(doc: Document) {
		// buildEmailDocument normally gets these in before the first paint; this
		// only has to cover a document that somehow arrived without them.
		if (!doc.getElementById(EMAIL_STYLE_ID)) {
			const style = doc.createElement('style');
			style.id = EMAIL_STYLE_ID;
			style.textContent = emailCss(rich);
			(doc.head ?? doc.documentElement).appendChild(style);
		}

		// The <base> covers new links too, but a sender's own `target` would
		// override it and try to navigate this frame — which the sandbox blocks,
		// so the click would simply do nothing.
		for (const link of Array.from(doc.links)) {
			link.setAttribute('target', '_blank');
			link.setAttribute('rel', 'noopener noreferrer');
		}
	}

	/**
	 * Revealing is a DOM edit made from this document. It has to be, rather than
	 * a button inside the frame: the sandbox disables scripting there, and Safari
	 * will not dispatch to a listener on a node in a scriptless document, so an
	 * in-frame toggle never fires.
	 */
	function showQuotes(open: boolean) {
		for (const node of quoted) node.classList.toggle('quote-hidden', !open);
		measure();
	}

	function toggleQuotes() {
		quotesOpen = !quotesOpen;
		showQuotes(quotesOpen);
	}

	/**
	 * Images settle after load and take the height with them, but a `load`
	 * listener bound from out here never fires inside a scriptless frame — the
	 * same rule that keeps an in-frame button from working. So completion is
	 * polled instead, which is parent-side work and runs normally. A message
	 * that is mostly images measures as almost nothing until this catches up.
	 */
	function watchImages(doc: Document) {
		if (images) clearInterval(images);
		images = null;

		// A completed document with no pending images is already final. Starting a
		// timer anyway forced WebKit through another layout after it had painted.
		if (!Array.from(doc.images).some((image) => !image.complete)) return;

		const deadline = Date.now() + 10_000;
		images = setInterval(() => {
			// Reading the dimensions in measure() is enough to update the frame;
			// doing a separate forced layout first caused an observable Safari flash.
			measure();
			const pending = Array.from(doc.images).some((image) => !image.complete);
			if ((!pending || Date.now() > deadline) && images) {
				clearInterval(images);
				images = null;
			}
		}, 150);
	}

	function onLoad() {
		const doc = frame?.contentDocument;
		// A frame that has not started loading still holds an about:blank whose
		// body is present but empty; there is nothing to style or measure there.
		if (!doc?.body?.hasChildNodes()) return;
		if (doc === prepared) return;
		prepared = doc;

		applyStyles(doc);
		quoted = canFoldQuotes(html) ? foldQuotedHtml(doc.body) : [];
		if (quotesOpen) showQuotes(true);
		measure();

		watchImages(doc);

		content?.disconnect();
		content = new ResizeObserver(measure);
		content.observe(doc.body);
		revealAfterPaint(doc);
	}

	/**
	 * A srcdoc frame can finish loading before this component hydrates, in which
	 * case its load event is already gone and nothing would ever size it. Nor is
	 * readyState any help: a frame that has not started loading reports the
	 * about:blank it holds as complete. So measurement is simply retried, the
	 * way the native clients do it, and a message that resists it altogether is
	 * shown at a readable height and left to scroll rather than hidden.
	 */
	$effect(() => {
		void srcdoc;

		// A new message can be much shorter than the previous one. Resetting here
		// also prevents Safari's iframe viewport from feeding back into
		// documentElement.scrollHeight during the first measurement.
		height = 0;
		painted = false;
		cancelReveal();
		prepared = null;
		content?.disconnect();
		content = null;
		if (images) {
			clearInterval(images);
			images = null;
		}

		// A new message brings its own quotes; the old nodes are gone.
		quoted = [];
		quotesOpen = false;

		const attempts = [0, 80, 300, 900].map((delay) =>
			setTimeout(() => {
				// The retries only recover a missed load event. Once this document has
				// been prepared, touching it again creates needless WebKit repaints.
				if (frame?.contentDocument !== prepared) onLoad();
			}, delay)
		);

		const reveal = setTimeout(() => {
			if (height > 0) return;
			const doc = frame?.contentDocument;
			if (doc) doc.documentElement.style.overflowY = 'auto';
			height = 360;
			if (doc) revealAfterPaint(doc);
		}, 1200);

		return () => {
			for (const attempt of attempts) clearTimeout(attempt);
			clearTimeout(reveal);
			if (images) {
				clearInterval(images);
				images = null;
			}
		};
	});

	$effect(() => () => {
		content?.disconnect();
		if (images) clearInterval(images);
		cancelReveal();
	});
</script>

{#if mounted && srcdoc}
	<iframe
		bind:this={frame}
		class="frame"
		class:rich
		class:painted
		title={t('thread.messageContent')}
		sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
		referrerpolicy="no-referrer"
		{srcdoc}
		onload={onLoad}
		style:height={height ? `${height}px` : undefined}
	></iframe>
{/if}

{#if quoted.length > 0}
	<button
		type="button"
		class="quote-toggle"
		aria-expanded={quotesOpen}
		aria-label={quotesOpen ? t('thread.hideQuoted') : t('thread.showQuoted')}
		onclick={toggleQuotes}
	>
		···
	</button>
{/if}

<style>
	.frame {
		display: block;
		width: 100%;
		min-height: 1.5rem;
		border: 0;
		visibility: hidden;
		/* What the message's own prefers-color-scheme resolves against. */
		color-scheme: light;
	}

	.frame.painted {
		visibility: visible;
	}

	:global(html[data-theme='dark']) .frame {
		color-scheme: dark;
	}

	/* The quoted history sits at the end of the message, so its control belongs
	   under the frame rather than inside it. */
	.quote-toggle {
		display: inline-flex;
		align-items: center;
		margin: 0.5rem 0;
		padding: 0 0.5rem;
		border: 0;
		border-radius: 0.375rem;
		font: inherit;
		font-size: 0.875rem;
		line-height: 1.4;
		letter-spacing: 0.08em;
		color: var(--color-text-secondary);
		background: var(--color-surface-muted);
		cursor: pointer;
	}

	.quote-toggle:hover {
		background: var(--color-surface-hover);
	}

	/* A designed message sits on the white page it was built for, so give it a
	   card to sit on. */
	.frame.rich {
		border-radius: 0.75rem;
		background: #ffffff;
	}

	/* In dark mode the page is the message's own — recoloured, or the dark one
	   its sender wrote — so the card gets out of its way. */
	:global(html[data-theme='dark']) .frame.rich {
		background: transparent;
	}
</style>
