export const SETTINGS_SECTIONS = [
	'general',
	'appearance',
	'connections',
	'notifications',
	'labels',
	'ai',
	'shortcuts'
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number] | 'all';
