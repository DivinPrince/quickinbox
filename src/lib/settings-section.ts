export const SETTINGS_SECTIONS = [
	'general',
	'appearance',
	'connections',
	'notifications',
	'labels',
	'import-export',
	'shortcuts'
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number] | 'all';
