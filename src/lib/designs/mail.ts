import type { DesignDefinition } from './types';

export const mailDesign: DesignDefinition = {
	id: 'mail',
	label: 'Mail',
	description: 'Sage, Inter, and the original QuickMail chrome.',
	brandName: 'Mail',
	composeLabel: 'New message',
	mark: 'mail',
	mailboxLayout: 'row',
	fonts: [],
	preview: {
		background: '#fafafa',
		surface: '#ffffff',
		sidebar: '#ffffff',
		accent: '#90ac9a',
		text: '#0a0a0a',
		muted: '#a3a3a3'
	}
};
