export type EmailIdentity = {
	name: string | null;
	address: string;
};

export function parseEmailIdentity(value: string): EmailIdentity {
	const trimmed = value.trim();
	const bracketMatch = trimmed.match(/^(.*?)<([^>]+)>$/);
	if (!bracketMatch) {
		return { name: null, address: parseEmailAddress(trimmed) };
	}

	const rawName = bracketMatch[1].trim();
	const name =
		rawName.startsWith('"') && rawName.endsWith('"')
			? rawName.slice(1, -1).replace(/\\(.)/g, '$1').trim()
			: rawName;
	return {
		name: name || null,
		address: parseEmailAddress(bracketMatch[2])
	};
}

export function parseEmailAddress(value: string): string {
	const trimmed = value.trim();
	const bracketMatch = trimmed.match(/<([^>]+)>/);
	if (bracketMatch) {
		return bracketMatch[1].toLowerCase().trim();
	}

	const emailMatch = trimmed.match(/[^\s<>]+@[^\s<>]+/);
	return (emailMatch?.[0] ?? trimmed).toLowerCase().trim();
}

export function parseEmailIdentities(value: string | null | undefined): EmailIdentity[] {
	if (!value) return [];

	const parts: string[] = [];
	let start = 0;
	let inQuotes = false;
	let bracketDepth = 0;

	for (let index = 0; index < value.length; index += 1) {
		const character = value[index];
		if (character === '"') {
			let backslashes = 0;
			for (let previous = index - 1; previous >= 0 && value[previous] === '\\'; previous -= 1) {
				backslashes += 1;
			}
			if (backslashes % 2 === 0) inQuotes = !inQuotes;
		}
		if (!inQuotes && character === '<') bracketDepth += 1;
		if (!inQuotes && character === '>' && bracketDepth > 0) bracketDepth -= 1;
		if (!inQuotes && bracketDepth === 0 && character === ',') {
			parts.push(value.slice(start, index));
			start = index + 1;
		}
	}
	parts.push(value.slice(start));

	return parts
		.map(parseEmailIdentity)
		.filter((identity) => identity.address.includes('@'));
}

export function formatEmailAddress(name: string | null | undefined, address: string): string {
	const cleanAddress = parseEmailAddress(address);
	const cleanName = name?.trim();
	if (!cleanName) return cleanAddress;

	const escapedName = cleanName.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
	return `"${escapedName}" <${cleanAddress}>`;
}

export function parseEmailAddresses(
	value: string | string[] | null | undefined
): string[] {
	if (!value) return [];

	const parts = Array.isArray(value) ? value : value.split(',');
	const addresses = new Set<string>();

	for (const part of parts) {
		const parsed = parseEmailAddress(part);
		if (parsed.includes('@')) {
			addresses.add(parsed);
		}
	}

	return [...addresses];
}

export function domainOf(address: string): string | null {
	const parsed = parseEmailAddress(address);
	const domain = parsed.split('@')[1];
	return domain || null;
}

/**
 * Every address an inbound Resend message could have been destined for.
 *
 * `received_for` is the address Resend actually accepted mail for (it survives
 * forwarding), so it is checked before the visible To/Cc headers.
 */
export function collectInboundRecipients(payload: {
	received_for?: string[] | null;
	to?: string[] | string | null;
	cc?: string[] | string | null;
	bcc?: string[] | string | null;
}): string[] {
	const recipients = new Set<string>();

	for (const source of [payload.received_for, payload.to, payload.cc, payload.bcc]) {
		for (const address of parseEmailAddresses(source ?? null)) {
			recipients.add(address);
		}
	}

	return [...recipients];
}
