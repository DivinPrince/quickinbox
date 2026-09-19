import { chunkIds } from './d1';
import type { D1Database } from '@cloudflare/workers-types';
import type { MailLabel, ThreadLabel } from '$lib/types';
import {
	LABEL_COLORS,
	MAX_AUTO_LABELS,
	MAX_LABEL_INSTRUCTIONS,
	MAX_LABEL_NAME
} from '$lib/mail/labels';

export { LABEL_COLORS, MAX_AUTO_LABELS, MAX_LABEL_INSTRUCTIONS, MAX_LABEL_NAME };

const COLOR_SET = new Set<string>(LABEL_COLORS);

type LabelRow = {
	id: string;
	user_id: string;
	slug: string;
	name: string;
	color: string;
	auto_enabled: number;
	auto_instructions: string | null;
	sort_order: number;
};

export function isLabelColor(value: string): boolean {
	return COLOR_SET.has(value);
}

export type LabelWriteFields = {
	name?: string;
	color?: string;
	autoEnabled?: boolean;
	autoInstructions?: string | null;
};

export function parseLabelWriteBody(
	body: unknown,
	mode: 'create' | 'update'
): { ok: true; fields: LabelWriteFields } | { ok: false; error: string } {
	if (!body || typeof body !== 'object' || Array.isArray(body)) {
		return { ok: false, error: 'Invalid body' };
	}

	const raw = body as Record<string, unknown>;
	const fields: LabelWriteFields = {};

	if (mode === 'create' || raw.name !== undefined) {
		if (typeof raw.name !== 'string') {
			return { ok: false, error: 'Name is required' };
		}
		const name = raw.name.trim();
		if (!name) return { ok: false, error: 'Name is required' };
		if (name.length > MAX_LABEL_NAME) {
			return { ok: false, error: `Name must be ${MAX_LABEL_NAME} characters or fewer` };
		}
		fields.name = name;
	}

	if (raw.color !== undefined) {
		if (typeof raw.color !== 'string' || !isLabelColor(raw.color)) {
			return { ok: false, error: 'Unknown color' };
		}
		fields.color = raw.color;
	}

	if (raw.autoEnabled !== undefined) {
		if (typeof raw.autoEnabled !== 'boolean') {
			return { ok: false, error: 'Invalid auto-apply flag' };
		}
		fields.autoEnabled = raw.autoEnabled;
	}

	if (raw.autoInstructions !== undefined) {
		if (raw.autoInstructions !== null && typeof raw.autoInstructions !== 'string') {
			return { ok: false, error: 'Invalid auto-apply description' };
		}
		if (
			typeof raw.autoInstructions === 'string' &&
			raw.autoInstructions.length > MAX_LABEL_INSTRUCTIONS
		) {
			return { ok: false, error: 'Auto-apply description is too long' };
		}
		fields.autoInstructions = raw.autoInstructions;
	}

	return { ok: true, fields };
}

export function slugifyLabel(name: string): string {
	const slug = name
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, MAX_LABEL_NAME);
	return slug || 'label';
}

function toMailLabel(row: LabelRow): MailLabel {
	return {
		id: row.id,
		name: row.name,
		color: row.color,
		slug: row.slug,
		auto_enabled: row.auto_enabled === 1,
		auto_instructions: row.auto_instructions,
		sort_order: row.sort_order
	};
}

export async function listLabels(db: D1Database, userId: string): Promise<MailLabel[]> {
	const { results } = await db
		.prepare(
			`SELECT id, user_id, slug, name, color, auto_enabled, auto_instructions, sort_order
			 FROM labels WHERE user_id = ?
			 ORDER BY sort_order ASC, datetime(created_at) ASC`
		)
		.bind(userId)
		.all<LabelRow>();

	return results.map(toMailLabel);
}

export async function getLabel(
	db: D1Database,
	userId: string,
	labelId: string
): Promise<MailLabel | null> {
	const row = await db
		.prepare(
			`SELECT id, user_id, slug, name, color, auto_enabled, auto_instructions, sort_order
			 FROM labels WHERE id = ? AND user_id = ?`
		)
		.bind(labelId, userId)
		.first<LabelRow>();

	return row ? toMailLabel(row) : null;
}

export async function listAutoLabels(db: D1Database, userId: string): Promise<MailLabel[]> {
	const labels = await listLabels(db, userId);
	return labels
		.filter((label) => label.auto_enabled && Boolean(label.auto_instructions?.trim()))
		.slice(0, MAX_AUTO_LABELS);
}

async function uniqueSlug(db: D1Database, userId: string, base: string, exceptId?: string): Promise<string> {
	let slug = base;
	let n = 2;
	while (true) {
		const row = await db
			.prepare(
				exceptId
					? 'SELECT id FROM labels WHERE user_id = ? AND slug = ? AND id <> ?'
					: 'SELECT id FROM labels WHERE user_id = ? AND slug = ?'
			)
			.bind(...(exceptId ? [userId, slug, exceptId] : [userId, slug]))
			.first<{ id: string }>();
		if (!row) return slug;
		slug = `${base.slice(0, MAX_LABEL_NAME - 3)}-${n}`;
		n += 1;
	}
}

export async function createLabel(
	db: D1Database,
	userId: string,
	input: {
		name: string;
		color?: string;
		autoEnabled?: boolean;
		autoInstructions?: string | null;
	}
): Promise<MailLabel> {
	const name = input.name.trim();
	const id = crypto.randomUUID();
	const slug = await uniqueSlug(db, userId, slugifyLabel(name));
	const color = input.color && isLabelColor(input.color) ? input.color : LABEL_COLORS[0];
	const instructions = input.autoInstructions?.trim() || null;
	const maxSort = await db
		.prepare('SELECT COALESCE(MAX(sort_order), -1) AS max_sort FROM labels WHERE user_id = ?')
		.bind(userId)
		.first<{ max_sort: number }>();

	await db
		.prepare(
			`INSERT INTO labels (id, user_id, slug, name, color, auto_enabled, auto_instructions, sort_order)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.bind(
			id,
			userId,
			slug,
			name,
			color,
			input.autoEnabled && instructions ? 1 : 0,
			instructions,
			(maxSort?.max_sort ?? -1) + 1
		)
		.run();

	const created = await getLabel(db, userId, id);
	if (!created) throw new Error('Failed to create label');
	return created;
}

export async function updateLabel(
	db: D1Database,
	userId: string,
	labelId: string,
	input: {
		name?: string;
		color?: string;
		autoEnabled?: boolean;
		autoInstructions?: string | null;
	}
): Promise<MailLabel | null> {
	const existing = await getLabel(db, userId, labelId);
	if (!existing) return null;

	const name = input.name?.trim() ?? existing.name;
	const slug =
		input.name !== undefined ? await uniqueSlug(db, userId, slugifyLabel(name), labelId) : existing.slug;
	const color =
		input.color !== undefined && isLabelColor(input.color) ? input.color : existing.color;
	const instructions =
		input.autoInstructions !== undefined
			? input.autoInstructions?.trim() || null
			: existing.auto_instructions;
	const autoEnabled =
		input.autoEnabled !== undefined ? input.autoEnabled && Boolean(instructions) : existing.auto_enabled;

	await db
		.prepare(
			`UPDATE labels SET name = ?, slug = ?, color = ?, auto_enabled = ?, auto_instructions = ?
			 WHERE id = ? AND user_id = ?`
		)
		.bind(name, slug, color, autoEnabled ? 1 : 0, instructions, labelId, userId)
		.run();

	return getLabel(db, userId, labelId);
}

export async function deleteLabel(db: D1Database, userId: string, labelId: string): Promise<boolean> {
	const owned = await db
		.prepare('SELECT id FROM labels WHERE id = ? AND user_id = ?')
		.bind(labelId, userId)
		.first<{ id: string }>();
	if (!owned) return false;

	await db.prepare('DELETE FROM email_labels WHERE label_id = ?').bind(labelId).run();
	await db.prepare('DELETE FROM labels WHERE id = ? AND user_id = ?').bind(labelId, userId).run();
	return true;
}

export async function labelsForEmails(
	db: D1Database,
	emailIds: string[]
): Promise<Map<string, ThreadLabel[]>> {
	const byEmail = new Map<string, ThreadLabel[]>();
	if (emailIds.length === 0) return byEmail;

	for (const group of chunkIds(emailIds)) {
		const placeholders = group.map(() => '?').join(', ');
		const { results } = await db
			.prepare(
				`SELECT el.email_id, l.id, l.name, l.color, l.slug
				 FROM email_labels el
				 JOIN labels l ON l.id = el.label_id
				 WHERE el.email_id IN (${placeholders})
				 ORDER BY l.sort_order ASC, l.name ASC`
			)
			.bind(...group)
			.all<{ email_id: string; id: string; name: string; color: string; slug: string }>();

		for (const row of results) {
			const label: ThreadLabel = {
				id: row.id,
				name: row.name,
				color: row.color,
				slug: row.slug
			};
			const bucket = byEmail.get(row.email_id);
			if (bucket) {
				if (!bucket.some((entry) => entry.id === label.id)) bucket.push(label);
			} else {
				byEmail.set(row.email_id, [label]);
			}
		}
	}

	return byEmail;
}

export async function setEmailAutoLabels(
	db: D1Database,
	emailId: string,
	assignments: { labelId: string; score: number }[]
): Promise<void> {
	await db
		.prepare("DELETE FROM email_labels WHERE email_id = ? AND source = 'auto'")
		.bind(emailId)
		.run();

	for (const assignment of assignments) {
		await db
			.prepare(
				`INSERT OR IGNORE INTO email_labels (email_id, label_id, source, score)
				 VALUES (?, ?, 'auto', ?)`
			)
			.bind(emailId, assignment.labelId, assignment.score)
			.run();
	}
}

/** Replaces the label set on every message in the thread. User-applied labels win. */
export async function setThreadLabels(
	db: D1Database,
	userId: string,
	emailIds: string[],
	labelIds: string[]
): Promise<number> {
	if (emailIds.length === 0) return 0;

	const unique = [...new Set(labelIds)];
	if (unique.length > 0) {
		const placeholders = unique.map(() => '?').join(', ');
		const owned = await db
			.prepare(`SELECT id FROM labels WHERE user_id = ? AND id IN (${placeholders})`)
			.bind(userId, ...unique)
			.all<{ id: string }>();
		if (owned.results.length !== unique.length) {
			throw new Error('Unknown label');
		}
	}

	for (const group of chunkIds(emailIds)) {
		const emailPlaceholders = group.map(() => '?').join(', ');
		await db
			.prepare(`DELETE FROM email_labels WHERE email_id IN (${emailPlaceholders})`)
			.bind(...group)
			.run();
	}

	for (const emailId of emailIds) {
		for (const labelId of unique) {
			await db
				.prepare(
					`INSERT INTO email_labels (email_id, label_id, source) VALUES (?, ?, 'user')`
				)
				.bind(emailId, labelId)
				.run();
		}
	}

	return emailIds.length;
}

export type SenderDisposition = 'spam' | 'safe';

export async function getSenderPref(
	db: D1Database,
	userId: string,
	fromAddr: string
): Promise<SenderDisposition | null> {
	const row = await db
		.prepare('SELECT disposition FROM sender_prefs WHERE user_id = ? AND from_addr = ?')
		.bind(userId, fromAddr.trim().toLowerCase())
		.first<{ disposition: SenderDisposition }>();
	return row?.disposition ?? null;
}

/** One round trip for a classify window — per-address lookups overflow Miniflare/D1. */
export async function listSenderPrefs(
	db: D1Database,
	userId: string
): Promise<Map<string, SenderDisposition>> {
	const { results } = await db
		.prepare('SELECT from_addr, disposition FROM sender_prefs WHERE user_id = ?')
		.bind(userId)
		.all<{ from_addr: string; disposition: string }>();

	const prefs = new Map<string, SenderDisposition>();
	for (const row of results) {
		if (row.disposition !== 'spam' && row.disposition !== 'safe') continue;
		prefs.set(row.from_addr.trim().toLowerCase(), row.disposition);
	}
	return prefs;
}

export async function setSenderPref(
	db: D1Database,
	userId: string,
	fromAddr: string,
	disposition: SenderDisposition
): Promise<void> {
	await db
		.prepare(
			`INSERT INTO sender_prefs (user_id, from_addr, disposition, updated_at)
			 VALUES (?, ?, ?, datetime('now'))
			 ON CONFLICT(user_id, from_addr) DO UPDATE SET
			   disposition = excluded.disposition,
			   updated_at = datetime('now')`
		)
		.bind(userId, fromAddr.trim().toLowerCase(), disposition)
		.run();
}

export async function rememberSenders(
	db: D1Database,
	userId: string,
	emailIds: string[],
	disposition: SenderDisposition
): Promise<void> {
	if (emailIds.length === 0) return;
	for (const group of chunkIds(emailIds)) {
		const placeholders = group.map(() => '?').join(', ');
		const { results } = await db
			.prepare(
				`SELECT DISTINCT from_addr FROM emails
				 WHERE user_id = ? AND direction = 'inbound' AND id IN (${placeholders})`
			)
			.bind(userId, ...group)
			.all<{ from_addr: string }>();

		for (const row of results) {
			await setSenderPref(db, userId, row.from_addr, disposition);
		}
	}
}
