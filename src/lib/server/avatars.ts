import type { D1Database, R2Bucket } from '@cloudflare/workers-types';

/**
 * Profile pictures, from two very different places.
 *
 * A user's own picture is uploaded and stored in R2 like any attachment. Other
 * people's pictures cannot be uploaded by us and there is no directory to ask,
 * so we fall back to the two things the open web actually publishes:
 *
 *   Gravatar  an individual opts in by hashing their address at gravatar.com
 *   BIMI      a domain publishes a logo in DNS, which is how brand mail gets a mark
 *
 * Neither covers everyone -- most senders resolve to nothing, and the UI draws
 * initials for them. Both lookups happen on the Worker, never in the browser, so
 * rendering a mailbox does not tell a third party who the user corresponds with.
 */

/** Uploads above this are rejected. Avatars render at ~36px; this is generous. */
export const MAX_AVATAR_BYTES = 1_048_576;

/** Re-check a contact after this long, hit or miss. */
const CONTACT_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/** Ceiling on anything we pull from a third party. */
const MAX_REMOTE_BYTES = 512_000;

/** Give a slow third party a short leash; a missing avatar is not worth waiting on. */
const REMOTE_TIMEOUT_MS = 4000;

export type ContactAvatarSource = 'gravatar' | 'bimi' | 'none';

export type StoredAvatar = {
	body: ArrayBuffer;
	contentType: string;
};

type ContactRow = {
	email: string;
	source: ContactAvatarSource;
	storage_key: string | null;
	content_type: string | null;
	fetched_at: string;
};

// --- uploads ---------------------------------------------------------------

/**
 * Identify an image by its magic bytes rather than the declared Content-Type,
 * which is client-supplied and therefore a suggestion.
 */
export function detectImageType(bytes: Uint8Array): string | null {
	if (bytes.length < 12) return null;
	const b = bytes;
	if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
	if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
	if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif';
	if (
		b[0] === 0x52 &&
		b[1] === 0x49 &&
		b[2] === 0x46 &&
		b[3] === 0x46 &&
		b[8] === 0x57 &&
		b[9] === 0x45 &&
		b[10] === 0x42 &&
		b[11] === 0x50
	) {
		return 'image/webp';
	}
	return null;
}

/**
 * Replace a user's picture. The key carries a random segment so a changed
 * avatar is a new URL -- browsers and the edge cache the old one aggressively.
 */
export async function storeUserAvatar(
	db: D1Database,
	bucket: R2Bucket,
	userId: string,
	bytes: Uint8Array,
	contentType: string
): Promise<string> {
	const key = `avatars/users/${userId}/${crypto.randomUUID()}`;

	await bucket.put(key, bytes as unknown as ArrayBuffer, {
		httpMetadata: { contentType }
	});

	const previous = await db
		.prepare('SELECT avatar_key FROM users WHERE id = ?')
		.bind(userId)
		.first<{ avatar_key: string | null }>();

	await db.prepare('UPDATE users SET avatar_key = ? WHERE id = ?').bind(key, userId).run();

	// Best effort -- an orphaned object costs a fraction of a cent, a failed
	// upload costs the user their picture.
	if (previous?.avatar_key) await bucket.delete(previous.avatar_key).catch(() => {});

	return key;
}

export async function deleteUserAvatar(
	db: D1Database,
	bucket: R2Bucket,
	userId: string
): Promise<void> {
	const row = await db
		.prepare('SELECT avatar_key FROM users WHERE id = ?')
		.bind(userId)
		.first<{ avatar_key: string | null }>();

	await db.prepare('UPDATE users SET avatar_key = NULL WHERE id = ?').bind(userId).run();
	if (row?.avatar_key) await bucket.delete(row.avatar_key).catch(() => {});
}

// --- lookups ---------------------------------------------------------------

async function sha256Hex(value: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function normalizeEmail(email: string): string {
	return email.trim().toLowerCase();
}

async function fetchLimited(url: string): Promise<StoredAvatar | null> {
	const response = await fetch(url, {
		signal: AbortSignal.timeout(REMOTE_TIMEOUT_MS),
		headers: { accept: 'image/*' },
		redirect: 'follow'
	}).catch(() => null);

	if (!response || !response.ok) return null;

	const declared = Number(response.headers.get('content-length') ?? '0');
	if (declared > MAX_REMOTE_BYTES) return null;

	const body = await response.arrayBuffer().catch(() => null);
	if (!body || body.byteLength === 0 || body.byteLength > MAX_REMOTE_BYTES) return null;

	const type = response.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
	const sniffed = detectImageType(new Uint8Array(body));

	// Raster must be a real image. SVG is allowed only for BIMI, which is always
	// SVG by spec -- it is served back under a locked-down CSP.
	if (sniffed) return { body, contentType: sniffed };
	if (type === 'image/svg+xml') return { body, contentType: type };
	return null;
}

/** An individual's own picture, if they published one against this address. */
async function lookupGravatar(email: string): Promise<StoredAvatar | null> {
	const hash = await sha256Hex(normalizeEmail(email));
	// d=404 makes Gravatar say "no" instead of handing back a generated default.
	return fetchLimited(`https://gravatar.com/avatar/${hash}?s=200&d=404`);
}

/**
 * Reject anything that is not a public https URL. A BIMI record is published by
 * whoever owns the sending domain, so its `l=` value is attacker-controlled and
 * gets fetched by us -- exactly the shape of an SSRF.
 */
function isPublicHttpsUrl(raw: string): boolean {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return false;
	}
	if (url.protocol !== 'https:') return false;

	const host = url.hostname.toLowerCase();
	if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) {
		return false;
	}
	if (host === '[::1]' || host === '::1') return false;
	// Literal IPs: allow none. Real BIMI records use hostnames.
	if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false;
	if (host.startsWith('[')) return false;
	return true;
}

/** The logo a domain publishes for brand mail, via `default._bimi.<domain>`. */
async function lookupBimi(domain: string): Promise<StoredAvatar | null> {
	const response = await fetch(
		`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(
			`default._bimi.${domain}`
		)}&type=TXT`,
		{
			signal: AbortSignal.timeout(REMOTE_TIMEOUT_MS),
			headers: { accept: 'application/dns-json' }
		}
	).catch(() => null);

	if (!response || !response.ok) return null;

	const dns = (await response.json().catch(() => null)) as { Answer?: { data?: string }[] } | null;
	if (!dns?.Answer?.length) return null;

	for (const answer of dns.Answer) {
		// TXT data arrives quoted, and long records arrive as adjacent strings.
		const record = (answer.data ?? '').replace(/"\s*"/g, '').replace(/^"|"$/g, '');
		if (!/v=BIMI1/i.test(record)) continue;

		const location = /(?:^|;)\s*l=([^;]+)/i.exec(record)?.[1]?.trim();
		if (!location || !isPublicHttpsUrl(location)) continue;

		const image = await fetchLimited(location);
		if (image) return image;
	}
	return null;
}

/**
 * Resolve a correspondent's picture, preferring the person over their employer.
 * Every outcome is cached, including "nothing found", which is the common one.
 */
export async function resolveContactAvatar(
	db: D1Database,
	bucket: R2Bucket,
	rawEmail: string
): Promise<StoredAvatar | null> {
	const email = normalizeEmail(rawEmail);
	const cached = await db
		.prepare('SELECT * FROM contact_avatars WHERE email = ?')
		.bind(email)
		.first<ContactRow>();

	const fresh = cached && Date.now() - Date.parse(cached.fetched_at) < CONTACT_TTL_MS;

	if (cached && fresh) {
		if (cached.source === 'none' || !cached.storage_key) return null;
		const object = await bucket.get(cached.storage_key);
		if (object) {
			return {
				body: await object.arrayBuffer(),
				contentType: cached.content_type ?? 'application/octet-stream'
			};
		}
		// Cache row outlived its object; fall through and refetch.
	}

	const domain = email.split('@')[1] ?? '';
	let source: ContactAvatarSource = 'none';
	let found = await lookupGravatar(email);
	if (found) {
		source = 'gravatar';
	} else if (domain) {
		found = await lookupBimi(domain);
		if (found) source = 'bimi';
	}

	let storageKey: string | null = null;
	if (found) {
		storageKey = `avatars/contacts/${await sha256Hex(email)}`;
		await bucket.put(storageKey, found.body, {
			httpMetadata: { contentType: found.contentType }
		});
	}

	await db
		.prepare(
			`INSERT INTO contact_avatars (email, source, storage_key, content_type, fetched_at)
			 VALUES (?, ?, ?, ?, ?)
			 ON CONFLICT(email) DO UPDATE SET
			   source = excluded.source,
			   storage_key = excluded.storage_key,
			   content_type = excluded.content_type,
			   fetched_at = excluded.fetched_at`
		)
		.bind(email, source, storageKey, found?.contentType ?? null, new Date().toISOString())
		.run();

	return found;
}

/** A local user's uploaded picture, by address. Null when they have not set one. */
export async function getUserAvatarByEmail(
	db: D1Database,
	bucket: R2Bucket,
	email: string
): Promise<StoredAvatar | null> {
	const row = await db
		.prepare(
			`SELECT u.avatar_key FROM users u
			 WHERE u.id = (
			   SELECT user_id FROM addresses WHERE address = ?1 COLLATE NOCASE
			   UNION ALL
			   SELECT id FROM users WHERE email = ?1 COLLATE NOCASE
			   LIMIT 1
			 )`
		)
		.bind(normalizeEmail(email))
		.first<{ avatar_key: string | null }>();

	if (!row?.avatar_key) return null;

	const object = await bucket.get(row.avatar_key);
	if (!object) return null;

	return {
		body: await object.arrayBuffer(),
		contentType: object.httpMetadata?.contentType ?? 'image/png'
	};
}
