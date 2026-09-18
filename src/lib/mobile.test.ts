import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	hasInAppHistory,
	isMailboxPath,
	isMorePath,
	isPrimaryTab,
	isStackedPath,
	isUtilityPath,
	navDirection,
	noteInAppNavigation
} from './app-chrome';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

test('treats mailbox roots as list screens', () => {
	assert.equal(isMailboxPath('/inbox'), true);
	assert.equal(isMailboxPath('/drafts'), true);
	assert.equal(isMailboxPath('/spam'), true);
	assert.equal(isMailboxPath('/mail/abc'), false);
});

test('treats only thread and compose as stacked screens', () => {
	assert.equal(isStackedPath('/mail/abc'), true);
	assert.equal(isStackedPath('/compose'), true);
	assert.equal(isStackedPath('/inbox'), false);
	assert.equal(isStackedPath('/settings'), false);
	assert.equal(isStackedPath('/admin'), false);
});

test('marks inbox, starred, and sent as primary tabs', () => {
	assert.equal(isPrimaryTab('/inbox'), true);
	assert.equal(isPrimaryTab('/sent'), true);
	assert.equal(isPrimaryTab('/drafts'), false);
});

test('treats settings and admin as utility screens', () => {
	assert.equal(isUtilityPath('/settings'), true);
	assert.equal(isUtilityPath('/admin'), true);
	assert.equal(isUtilityPath('/inbox'), false);
	assert.equal(isUtilityPath('/drafts'), false);
});

test('puts secondary destinations under More', () => {
	assert.equal(isMorePath('/drafts'), true);
	assert.equal(isMorePath('/trash'), true);
	assert.equal(isMorePath('/spam'), true);
	assert.equal(isMorePath('/settings'), true);
	assert.equal(isMorePath('/admin'), true);
	assert.equal(isMorePath('/inbox'), false);
	assert.equal(isMorePath('/sent'), false);
});

test('counts only in-app link and goto navigations as back history', () => {
	while (hasInAppHistory()) noteInAppNavigation('popstate');
	noteInAppNavigation('enter');
	assert.equal(hasInAppHistory(), false);
	noteInAppNavigation('link');
	assert.equal(hasInAppHistory(), true);
	noteInAppNavigation('popstate');
	assert.equal(hasInAppHistory(), false);
	noteInAppNavigation('goto');
	assert.equal(hasInAppHistory(), true);
	noteInAppNavigation('popstate');
	assert.equal(hasInAppHistory(), false);
});

test('stacked back controls do not trust the tab session history length', () => {
	for (const file of [
		'src/lib/components/SwipeBack.svelte',
		'src/lib/components/StackHeader.svelte',
		'src/routes/mail/[id]/+page.svelte'
	]) {
		const source = readFileSync(join(root, file), 'utf8');
		assert.match(source, /hasInAppHistory/, file);
		assert.doesNotMatch(source, /history\.length/, file);
	}
});

test('slides forward into a stacked screen and back out of one', () => {
	assert.equal(navDirection('/inbox', '/mail/1', 'link'), 'forward');
	assert.equal(navDirection('/mail/1', '/inbox', 'link'), 'back');
	assert.equal(navDirection('/inbox', '/starred', 'link'), 'tab');
	assert.equal(navDirection('/mail/1', '/inbox', 'popstate'), 'back');
});

test('document head asks for a standalone home-screen app', () => {
	const html = readFileSync(join(root, 'src/app.html'), 'utf8');
	assert.match(html, /viewport-fit=cover/);
	assert.match(html, /apple-mobile-web-app-capable/);
	assert.match(html, /apple-mobile-web-app-status-bar-style" content="black-translucent"/);
	assert.match(html, /manifest\.webmanifest/);
	assert.match(html, /apple-touch-startup-image/);
});

test('Zero phone chrome clears the iOS status bar and keeps tap targets large', () => {
	const css = readFileSync(join(root, 'src/themes/zero/shell.css'), 'utf8');
	const phone = css.split('@media (max-width: 767px)')[1] ?? '';
	assert.match(phone, /\.z-list-head[\s\S]*safe-area-inset-top/);
	assert.match(phone, /\.z-settings-bar[\s\S]*safe-area-inset-top/);
	assert.match(phone, /\.z-thread-bar[\s\S]*safe-area-inset-top/);
	assert.match(phone, /data-mobile-open='true'\] \.z-sidebar[\s\S]*safe-area-inset-top/);
	assert.match(phone, /\.z-mobile-nav a[\s\S]*min-width:\s*var\(--touch-target\)/);
	assert.match(phone, /\.z-mobile-nav a[\s\S]*min-height:\s*var\(--touch-target\)/);
	assert.match(phone, /\.z-list-tools \.z-icon-btn[\s\S]*--touch-target/);
	assert.match(phone, /\.z-compose-window[\s\S]*safe-area-inset-top/);
	assert.match(phone, /\.z-palette-scrim/);
});

test('collapsed Zero sidebar keeps the brand mark and label colors', () => {
	const header = readFileSync(join(root, 'src/themes/zero/AccountHeader.svelte'), 'utf8');
	assert.match(header, /import Logo from '\$lib\/components\/Logo\.svelte'/);
	assert.match(header, /class="z-brand"[\s\S]*<Logo size=\{36\} \/>/);
	const shell = readFileSync(join(root, 'src/themes/zero/Shell.svelte'), 'utf8');
	assert.match(shell, /data\.labels\.length > 0/);
	assert.doesNotMatch(shell, /labels\.length > 0 && \(!collapsed/);
	const css = readFileSync(join(root, 'src/themes/zero/shell.css'), 'utf8');
	assert.match(css, /\.z-brand/);
	assert.match(css, /\.z-nav-link > span:not\(\.z-icon\):not\(\.z-label-dot\)/);
	assert.match(css, /\.z-nav-link \.z-label-dot/);
});

test('Zero mail layout follows the stage width across desktop and tablet', () => {
	const css = readFileSync(join(root, 'src/themes/zero/shell.css'), 'utf8');
	assert.match(css, /container: stage \/ inline-size/);
	assert.match(css, /container: mail-list \/ inline-size/);
	assert.match(css, /container: thread \/ inline-size/);
	assert.match(css, /@container stage \(max-width: 56rem\)/);
	assert.match(css, /@container mail-list \(max-width: 22rem\)/);
	assert.match(css, /@container thread \(max-width: 32rem\)/);
});

test('app logo is not crushed by the global image reset', () => {
	const source = readFileSync(join(root, 'src/lib/components/Logo.svelte'), 'utf8');
	assert.match(source, /max-width:\s*none/);
	assert.match(source, /object-fit:\s*contain/);
	assert.match(source, /filter:\s*none/);
	assert.match(source, /mix-blend-mode:\s*screen/);
});

test('phone gestures follow the 900px shell, not desktop pointer type', () => {
	for (const file of [
		'src/lib/components/SwipeBack.svelte',
		'src/lib/components/SwipeRow.svelte',
		'src/lib/components/PullToRefresh.svelte'
	]) {
		const source = readFileSync(join(root, file), 'utf8');
		assert.doesNotMatch(source, /pointer:\s*fine/, file);
		assert.match(source, /min-width:\s*901px|isMobileViewport/, file);
	}
});

test('stacked swipe wrapper does not become a phone column on desktop', () => {
	const source = readFileSync(join(root, 'src/lib/components/SwipeBack.svelte'), 'utf8');
	assert.match(source, /@media \(min-width:\s*901px\)[\s\S]*display:\s*contents/);
});

test('mail and compose use the available Classic pane width on desktop', () => {
	const source = readFileSync(join(root, 'src/themes/classic/Shell.svelte'), 'utf8');
	assert.match(source, /const NARROW = \['\/settings'\]/);
	assert.doesNotMatch(source, /NARROW = \[[^\]]*\/(mail|compose)/);
});

test('composer fill layout is phone-only', () => {
	const source = readFileSync(join(root, 'src/lib/components/RichTextEditor.svelte'), 'utf8');
	const style = source.split('<style>')[1] ?? '';
	const desktop = style.split('@media (max-width: 900px)')[0] ?? '';
	assert.doesNotMatch(desktop, /\.editor-shell-fill\s*\{/);
	assert.match(style, /@media \(max-width: 900px\)[\s\S]*\.editor-shell-fill/);
});

test('service worker is a classic worker, not a Vite module', () => {
	const source = readFileSync(join(root, 'src/service-worker.ts'), 'utf8');
	assert.match(source, /addEventListener\('install'/);
	assert.match(source, /addEventListener\('push'/);
	assert.match(source, /postMessage/);
	assert.match(source, /mail:changed/);
	assert.doesNotMatch(source, /import\s+['"]\/@fs/);
});

test('signed-in shell refreshes the mailbox without a manual reload', () => {
	const layout = readFileSync(join(root, 'src/routes/+layout.svelte'), 'utf8');
	assert.match(layout, /MailboxLiveSync/);
	const live = readFileSync(join(root, 'src/lib/mail/live.ts'), 'utf8');
	assert.match(live, /mailboxSyncUrl/);
	assert.match(live, /startMailboxLiveSync/);
	assert.match(live, /MAIL_CHANGED_MESSAGE/);
	const sync = readFileSync(join(root, 'src/lib/mail/sync.ts'), 'utf8');
	assert.match(sync, /\/api\/mail\/sync/);
});

test('PWA manifest is standalone and points at real icons', () => {
	const manifest = JSON.parse(readFileSync(join(root, 'static/manifest.webmanifest'), 'utf8')) as {
		display: string;
		start_url: string;
		icons: { src: string }[];
		shortcuts?: { url: string }[];
	};
	assert.equal(manifest.display, 'standalone');
	assert.equal(manifest.start_url, '/inbox');
	assert.ok(manifest.icons.length >= 2);
	for (const icon of manifest.icons) {
		assert.equal(existsSync(join(root, 'static', icon.src)), true, icon.src);
	}
	assert.ok(manifest.shortcuts?.some((shortcut) => shortcut.url === '/compose'));
	for (const splash of [
		'splash-1170x2532.png',
		'splash-1170x2532-dark.png',
		'splash-1179x2556.png',
		'splash-1179x2556-dark.png',
		'splash-1290x2796.png',
		'splash-1290x2796-dark.png'
	]) {
		assert.equal(existsSync(join(root, 'static/icons', splash)), true, splash);
	}
});
