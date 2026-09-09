import type { Component, Snippet } from 'svelte';
import type { MailboxCounts, MailboxView, User, Domain, LinkedAccount, MailAddress } from '$lib/types';

export type ThemeCapabilities = {
	twoPane: boolean;
	composeOverlay: boolean;
	commandPalette: boolean;
	shortcuts: boolean;
	folders: readonly MailboxView[];
};

export type ThemeShellData = {
	user: User;
	domains: Domain[];
	addresses: MailAddress[];
	activeDomainId: string | null;
	/** Accounts signed in on this browser, active first. Empty when there is only one. */
	accounts: LinkedAccount[];
	counts: MailboxCounts;
	uiTheme: string;
};

export type ThemeShellProps = {
	data: ThemeShellData;
	children: Snippet;
};

export type ThemeModule = {
	id: string;
	name: string;
	version: string;
	engine: string;
	capabilities: ThemeCapabilities;
	Shell: Component<ThemeShellProps>;
};
