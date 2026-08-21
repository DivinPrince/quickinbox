/**
 * A visual language the app can wear.
 *
 * Add a new design by:
 *  1. Creating `src/lib/designs/<id>.ts` with a `DesignDefinition`
 *  2. Creating `src/styles/designs/<id>.css` scoped to `[data-design='<id>']`
 *  3. Registering the definition in `catalog.ts` and importing the CSS
 *     from `layout.css`
 *  4. If you need a new brand mark, add a `DesignMark` variant and handle
 *     it exhaustively in `Logo.svelte`
 *  5. If `mailboxLayout` is not `row`, add the id to the first-paint map
 *     in `app.html` so the inbox does not flash the Mail row layout
 *
 * Light / dark / system stay independent — they resolve to `data-theme`
 * and each design supplies tokens for both schemes.
 */
export type DesignMark = 'mail' | 'zero';

export type MailboxLayout = 'row' | 'stack';

export type DesignFont = {
	href: string;
	family: string;
};

export type DesignPreview = {
	background: string;
	surface: string;
	sidebar: string;
	accent: string;
	text: string;
	muted: string;
};

export type DesignDefinition = {
	id: string;
	label: string;
	description: string;
	brandName: string;
	composeLabel: string;
	mark: DesignMark;
	mailboxLayout: MailboxLayout;
	fonts: DesignFont[];
	preview: DesignPreview;
};
