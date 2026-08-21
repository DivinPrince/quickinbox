import type { DesignDefinition } from './types';

/**
 * 0.email / Zero visual language.
 *
 * Tokens and chrome match Mail-0/Zero (`apps/mail/app/globals.css`, sidebar
 * 14rem, compose `#006FFE`, stacked thread rows) — the same system as
 * https://www.figma.com/design/m0r4V9eYITRjtCAPvcAbLQ/0.email-design?node-id=5537-2149
 */
export const zeroDesign: DesignDefinition = {
	id: 'zero',
	label: '0.email',
	description: 'Geist, ink surfaces, and Zero’s blue compose chip.',
	brandName: '0.email',
	composeLabel: 'New Email',
	mark: 'zero',
	mailboxLayout: 'stack',
	fonts: [
		{
			href: 'https://cdn.jsdelivr.net/npm/@fontsource-variable/geist@5.2.6/index.min.css',
			family: 'Geist Variable'
		}
	],
	preview: {
		background: '#111113',
		surface: '#19191c',
		sidebar: '#111113',
		accent: '#006ffe',
		text: '#fafafa',
		muted: '#8c8c8c'
	}
};
