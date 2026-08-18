import type { D1Database } from '@cloudflare/workers-types';
import type { Domain, MailAddress } from '$lib/types';
import type { EmailProvider, ProviderDomain } from './email-provider';

type DomainRow = {
	id: string;
	name: string;
	status: string;
	region: string | null;
	sending_enabled: number;
	receiving_enabled: number;
	catchall_user_id: string | null;
	created_at: string;
	synced_at: string | null;
};

type AddressRow = {
	id: string;
	user_id: string;
	domain_id: string;
	domain_name: string;
	address: string;
	label: string | null;
	is_default: number;
	created_at: string;
};

function mapDomain(row: DomainRow): Domain {
	return {
		id: row.id,
		name: row.name,
		status: row.status,
		region: row.region,
		sending_enabled: row.sending_enabled === 1,
		receiving_enabled: row.receiving_enabled === 1,
		catchall_user_id: row.catchall_user_id,
		created_at: row.created_at,
		synced_at: row.synced_at
	};
}

function mapAddress(row: AddressRow): MailAddress {
	return {
		id: row.id,
		user_id: row.user_id,
		domain_id: row.domain_id,
		domain_name: row.domain_name,
		address: row.address,
		label: row.label,
		is_default: row.is_default === 1,
		created_at: row.created_at
	};
}

/* -------------------------------------------------------------------------- */
/* Domains                                                                     */
/* -------------------------------------------------------------------------- */

export async function listDomains(db: D1Database): Promise<Domain[]> {
	const { results } = await db
		.prepare('SELECT * FROM domains ORDER BY created_at ASC')
		.all<DomainRow>();
	return results.map(mapDomain);
}

export async function countDomains(db: D1Database): Promise<number> {
	const row = await db.prepare('SELECT COUNT(*) AS count FROM domains').first<{ count: number }>();
	return row?.count ?? 0;
}

export async function getDomain(db: D1Database, id: string): Promise<Domain | null> {
	const row = await db.prepare('SELECT * FROM domains WHERE id = ?').bind(id).first<DomainRow>();
	return row ? mapDomain(row) : null;
}

export async function getDomainByName(db: D1Database, name: string): Promise<Domain | null> {
	const row = await db
		.prepare('SELECT * FROM domains WHERE name = ?')
		.bind(name.toLowerCase())
		.first<DomainRow>();
	return row ? mapDomain(row) : null;
}

/**
 * Connect (or refresh) a provider domain. Keyed on the provider domain id so
 * re-running is safe and picks up newly verified DNS.
 */
export async function upsertDomain(db: D1Database, domain: ProviderDomain): Promise<Domain> {
	await db
		.prepare(
			`INSERT INTO domains (id, name, status, region, sending_enabled, receiving_enabled, synced_at)
			 VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
			 ON CONFLICT(id) DO UPDATE SET
				name = excluded.name,
				status = excluded.status,
				region = excluded.region,
				sending_enabled = excluded.sending_enabled,
				receiving_enabled = excluded.receiving_enabled,
				synced_at = excluded.synced_at`
		)
		.bind(
			domain.id,
			domain.name.toLowerCase(),
			domain.status,
			domain.region ?? null,
			domain.sendingEnabled ? 1 : 0,
			domain.receivingEnabled ? 1 : 0
		)
		.run();

	const saved = await getDomain(db, domain.id);
	if (!saved) throw new Error('Failed to connect domain');
	return saved;
}

export async function disconnectDomain(db: D1Database, id: string): Promise<void> {
	await db.prepare('DELETE FROM domains WHERE id = ?').bind(id).run();
}

export async function setCatchallUser(
	db: D1Database,
	domainId: string,
	userId: string | null
): Promise<void> {
	await db
		.prepare('UPDATE domains SET catchall_user_id = ? WHERE id = ?')
		.bind(userId, domainId)
		.run();
}

/** Re-read every connected domain from the active provider so status stays fresh. */
export async function syncDomains(db: D1Database, provider: EmailProvider): Promise<Domain[]> {
	const connected = await listDomains(db);
	if (connected.length === 0) return [];

	const remote = await provider.listDomains();
	const byId = new Map(remote.map((domain) => [domain.id, domain]));

	for (const domain of connected) {
		const match = byId.get(domain.id);
		if (match) {
			await upsertDomain(db, match);
		} else {
			// Removed from the provider — mark it so the UI can explain why sending fails.
			await db
				.prepare(
					`UPDATE domains SET status = 'missing', sending_enabled = 0, receiving_enabled = 0,
					 synced_at = datetime('now') WHERE id = ?`
				)
				.bind(domain.id)
				.run();
		}
	}

	return listDomains(db);
}

/* -------------------------------------------------------------------------- */
/* Addresses                                                                   */
/* -------------------------------------------------------------------------- */

const ADDRESS_SELECT = `SELECT a.id, a.user_id, a.domain_id, d.name AS domain_name, a.address,
	a.label, a.is_default, a.created_at
	FROM addresses a JOIN domains d ON d.id = a.domain_id`;

export async function listAddressesForUser(
	db: D1Database,
	userId: string
): Promise<MailAddress[]> {
	const { results } = await db
		.prepare(`${ADDRESS_SELECT} WHERE a.user_id = ? ORDER BY a.is_default DESC, a.address ASC`)
		.bind(userId)
		.all<AddressRow>();
	return results.map(mapAddress);
}

export async function listAllAddresses(db: D1Database): Promise<MailAddress[]> {
	const { results } = await db
		.prepare(`${ADDRESS_SELECT} ORDER BY d.name ASC, a.address ASC`)
		.all<AddressRow>();
	return results.map(mapAddress);
}

export async function getAddressForUser(
	db: D1Database,
	userId: string,
	addressId: string
): Promise<MailAddress | null> {
	const row = await db
		.prepare(`${ADDRESS_SELECT} WHERE a.id = ? AND a.user_id = ?`)
		.bind(addressId, userId)
		.first<AddressRow>();
	return row ? mapAddress(row) : null;
}

export async function getDefaultAddress(
	db: D1Database,
	userId: string
): Promise<MailAddress | null> {
	const addresses = await listAddressesForUser(db, userId);
	return addresses[0] ?? null;
}

const LOCAL_PART = /^[a-z0-9._%+-]+$/i;

export async function createAddress(
	db: D1Database,
	input: { userId: string; domainId: string; localPart: string; label?: string | null }
): Promise<MailAddress> {
	const domain = await getDomain(db, input.domainId);
	if (!domain) {
		throw new Error('Domain is not connected');
	}

	const localPart = input.localPart.trim().toLowerCase().replace(/@.*$/, '');
	if (!LOCAL_PART.test(localPart)) {
		throw new Error('Use letters, numbers and . _ % + - before the @');
	}

	const address = `${localPart}@${domain.name}`;
	const existing = await db
		.prepare('SELECT id FROM addresses WHERE address = ?')
		.bind(address)
		.first<{ id: string }>();
	if (existing) {
		throw new Error(`${address} is already taken`);
	}

	const id = crypto.randomUUID();
	const isFirst = (await listAddressesForUser(db, input.userId)).length === 0;

	await db
		.prepare(
			`INSERT INTO addresses (id, user_id, domain_id, address, label, is_default)
			 VALUES (?, ?, ?, ?, ?, ?)`
		)
		.bind(id, input.userId, domain.id, address, input.label?.trim() || null, isFirst ? 1 : 0)
		.run();

	const created = await getAddressForUser(db, input.userId, id);
	if (!created) throw new Error('Failed to create address');
	return created;
}

export async function setDefaultAddress(
	db: D1Database,
	userId: string,
	addressId: string
): Promise<void> {
	await db.batch([
		db.prepare('UPDATE addresses SET is_default = 0 WHERE user_id = ?').bind(userId),
		db
			.prepare('UPDATE addresses SET is_default = 1 WHERE id = ? AND user_id = ?')
			.bind(addressId, userId)
	]);
}

export async function deleteAddress(
	db: D1Database,
	userId: string,
	addressId: string
): Promise<void> {
	await db
		.prepare('DELETE FROM addresses WHERE id = ? AND user_id = ?')
		.bind(addressId, userId)
		.run();
}

/* -------------------------------------------------------------------------- */
/* Inbound routing                                                             */
/* -------------------------------------------------------------------------- */

export type InboundRoute = {
	userId: string;
	domainId: string | null;
	address: string;
	viaCatchall: boolean;
};

/**
 * Resolve who an inbound message belongs to.
 *
 * The provider accepts mail for every address on a connected domain, so we try
 * an exact address match first and fall back to the domain's catch-all owner.
 */
export async function resolveInboundRoute(
	db: D1Database,
	recipients: string[]
): Promise<InboundRoute | null> {
	const candidates = recipients
		.map((value) => value.trim().toLowerCase())
		.filter((value) => value.includes('@'));

	if (candidates.length === 0) return null;

	const placeholders = candidates.map(() => '?').join(', ');
	const { results } = await db
		.prepare(
			`SELECT user_id, domain_id, address FROM addresses WHERE address IN (${placeholders})`
		)
		.bind(...candidates)
		.all<{ user_id: string; domain_id: string; address: string }>();

	if (results.length > 0) {
		// Honour the order the recipients arrived in, not SQLite's row order.
		for (const candidate of candidates) {
			const match = results.find((row) => row.address.toLowerCase() === candidate);
			if (match) {
				return {
					userId: match.user_id,
					domainId: match.domain_id,
					address: match.address,
					viaCatchall: false
				};
			}
		}
	}

	for (const candidate of candidates) {
		const domainName = candidate.split('@')[1];
		if (!domainName) continue;

		const domain = await db
			.prepare('SELECT id, catchall_user_id FROM domains WHERE name = ?')
			.bind(domainName)
			.first<{ id: string; catchall_user_id: string | null }>();

		if (domain?.catchall_user_id) {
			return {
				userId: domain.catchall_user_id,
				domainId: domain.id,
				address: candidate,
				viaCatchall: true
			};
		}
	}

	return null;
}

export async function recordUnroutedEmail(
	db: D1Database,
	input: {
		providerId: string | null;
		from: string;
		to: string;
		subject: string | null;
		reason: string;
	}
): Promise<void> {
	await db
		.prepare(
			`INSERT INTO unrouted_emails (id, provider_id, from_addr, to_addr, subject, reason)
			 VALUES (?, ?, ?, ?, ?, ?)`
		)
		.bind(
			crypto.randomUUID(),
			input.providerId,
			input.from,
			input.to,
			input.subject,
			input.reason
		)
		.run();
}

export async function listUnroutedEmails(db: D1Database, limit = 50) {
	const { results } = await db
		.prepare(
			`SELECT id, provider_id, from_addr, to_addr, subject, reason, created_at
			 FROM unrouted_emails ORDER BY datetime(created_at) DESC LIMIT ?`
		)
		.bind(limit)
		.all();
	return results;
}
