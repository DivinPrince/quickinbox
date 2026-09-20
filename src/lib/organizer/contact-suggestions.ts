import type { Contact } from './types';

/** Last recipient token, preserving commas inside quoted display names. */
export function recipientToken(value: string): { prefix: string; query: string } {
	let quoted = false,
		bracket = false,
		start = 0;
	for (let i = 0; i < value.length; i++) {
		if (value[i] === '"' && value[i - 1] !== '\\') quoted = !quoted;
		if (!quoted && value[i] === '<') bracket = true;
		if (!quoted && value[i] === '>') bracket = false;
		if (value[i] === ',' && !quoted && !bracket) start = i + 1;
	}
	return { prefix: value.slice(0, start), query: value.slice(start).trim() };
}

/** Enhances the existing input so Tab keeps its normal form-field order. */
export function contactSuggestions(input: HTMLInputElement) {
	const menu = document.createElement('div');
	menu.id = `contacts-${crypto.randomUUID()}`;
	menu.setAttribute('role', 'listbox');
	menu.setAttribute('aria-label', 'Contacts');
	menu.style.cssText =
		'position:fixed;z-index:1100;display:none;max-height:250px;overflow:auto;background:var(--color-surface);color:var(--color-text);border:1px solid var(--color-focus-line);border-radius:10px;box-shadow:var(--shadow-md);padding:4px;';
	document.body.append(menu);
	const attrs = [
		'role',
		'autocomplete',
		'aria-autocomplete',
		'aria-controls',
		'aria-expanded',
		'aria-activedescendant'
	];
	const original = new Map(attrs.map((name) => [name, input.getAttribute(name)]));
	input.setAttribute('role', 'combobox');
	input.setAttribute('autocomplete', 'off');
	input.setAttribute('aria-autocomplete', 'list');
	input.setAttribute('aria-controls', menu.id);
	input.setAttribute('aria-expanded', 'false');
	let controller: AbortController | undefined, timer: ReturnType<typeof setTimeout> | undefined;
	let choices: { name: string; email: string }[] = [],
		active = -1,
		generation = 0;
	function close() {
		generation++;
		controller?.abort();
		clearTimeout(timer);
		menu.style.display = 'none';
		input.setAttribute('aria-expanded', 'false');
		input.removeAttribute('aria-activedescendant');
		active = -1;
	}
	function position() {
		const rect = input.getBoundingClientRect();
		menu.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - Math.min(360, innerWidth - 16)))}px`;
		menu.style.width = `${Math.min(Math.max(260, rect.width), innerWidth - 16)}px`;
		const above = innerHeight - rect.bottom < 180;
		menu.style.top = above ? 'auto' : `${rect.bottom + 4}px`;
		menu.style.bottom = above ? `${innerHeight - rect.top + 4}px` : 'auto';
	}
	function choose(index: number) {
		const choice = choices[index];
		if (!choice) return;
		const { prefix } = recipientToken(input.value);
		input.value = `${prefix}${prefix ? ' ' : ''}${choice.email}, `;
		input.dispatchEvent(new Event('input', { bubbles: true }));
		close();
		input.focus();
	}
	function highlight() {
		Array.from(menu.children).forEach((element, i) => {
			element.setAttribute('aria-selected', String(i === active));
			(element as HTMLElement).style.background =
				i === active ? 'var(--color-accent-soft)' : 'transparent';
		});
		if (active >= 0) {
			input.setAttribute('aria-activedescendant', `${menu.id}-${active}`);
			menu.children[active]?.scrollIntoView({ block: 'nearest' });
		} else input.removeAttribute('aria-activedescendant');
	}
	function changed() {
		close();
		const query = recipientToken(input.value).query;
		if (query.length < 1 || query.includes('>')) return;
		const run = generation;
		timer = setTimeout(async () => {
			controller = new AbortController();
			try {
				const response = await fetch(`/api/contacts?q=${encodeURIComponent(query)}&limit=8`, {
					signal: controller.signal
				});
				if (!response.ok) return;
				const data: { contacts: Contact[] } = await response.json();
				if (run !== generation || document.activeElement !== input) return;
				choices = data.contacts
					.flatMap((c) => c.emails.map((email) => ({ name: c.name, email })))
					.slice(0, 10);
				menu.replaceChildren();
				for (const [i, choice] of choices.entries()) {
					const option = document.createElement('div');
					option.id = `${menu.id}-${i}`;
					option.setAttribute('role', 'option');
					option.setAttribute('aria-selected', 'false');
					option.style.cssText =
						'padding:9px 12px;cursor:pointer;border-radius:6px;font-size:13px;';
					const name = document.createElement('div');
					name.textContent = choice.name;
					const address = document.createElement('div');
					address.textContent = choice.email;
					address.style.cssText = 'opacity:.7;font-size:12px;';
					option.append(name, address);
					option.addEventListener('pointerdown', (e) => {
						e.preventDefault();
						choose(i);
					});
					option.addEventListener('pointermove', () => {
						active = i;
						highlight();
					});
					menu.append(option);
				}
				if (choices.length) {
					position();
					menu.style.display = 'block';
					input.setAttribute('aria-expanded', 'true');
				}
			} catch {
				/* Suggestions are optional; typing recipients always works. */
			}
		}, 180);
	}
	function keydown(event: KeyboardEvent) {
		if (menu.style.display === 'none') return;
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			event.stopPropagation();
			active = (active + (event.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length;
			highlight();
		} else if (event.key === 'Enter' && active >= 0) {
			event.preventDefault();
			event.stopPropagation();
			choose(active);
		} else if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			close();
		} else if (event.key === 'Tab') close();
	}
	input.addEventListener('input', changed);
	input.addEventListener('focus', changed);
	input.addEventListener('blur', close);
	input.addEventListener('keydown', keydown);
	window.addEventListener('resize', close);
	window.addEventListener('scroll', position, true);
	return {
		destroy() {
			close();
			menu.remove();
			input.removeEventListener('input', changed);
			input.removeEventListener('focus', changed);
			input.removeEventListener('blur', close);
			input.removeEventListener('keydown', keydown);
			window.removeEventListener('resize', close);
			window.removeEventListener('scroll', position, true);
			for (const [name, value] of original) {
				if (value === null) input.removeAttribute(name);
				else input.setAttribute(name, value);
			}
		}
	};
}
