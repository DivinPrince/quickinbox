import Shell from './Shell.svelte';
import { THEME_ENGINE } from '$lib/ui-theme/ids';
import type { ThemeModule } from '$lib/ui-theme/types';

export const theme: ThemeModule = {
	id: 'classic',
	name: 'Classic',
	version: '1.0.0',
	engine: THEME_ENGINE,
	capabilities: {
		twoPane: false,
		composeOverlay: false,
		commandPalette: false,
		shortcuts: false,
		folders: ['inbox', 'archive', 'starred', 'drafts', 'sent', 'trash']
	},
	Shell
};
