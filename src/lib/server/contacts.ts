import type { D1Database } from '@cloudflare/workers-types';
import { error } from '@sveltejs/kit';
import { z } from 'zod';
import type { Contact } from '$lib/organizer/types';

const text = (max: number) =>
	z
		.string()
		.trim()
		.max(max)
		.refine((value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value));
export const contactInput = z.object({
	name: text(200),
	emails: z
		.array(
			z
				.string()
				.trim()
				.email()
				.max(254)
				.transform((value) => value.toLowerCase())
		)
		.min(1)
		.max(10),
	company: text(200).default(''),
	phone: text(100).default(''),
	notes: text(4000).default(''),
	starred: z.boolean().default(false),
	version: z.number().int().positive().optional()
});
type Row = Omit<Contact, 'emails' | 'starred'> & { starred: number; emails_json: string };
const columns = `c.id, c.name, c.company, c.phone, c.notes, c.starred, c.version,
  (SELECT json_group_array(email) FROM (SELECT email FROM contact_emails WHERE contact_id = c.id ORDER BY position)) AS emails_json`;
function mapContact(row: Row): Contact {
	const { emails_json, starred, ...fields } = row;
	return { ...fields, emails: JSON.parse(emails_json), starred: Boolean(starred) };
}
export async function getContact(
	db: D1Database,
	userId: string,
	id: string
): Promise<Contact | null> {
	const row = await db
		.prepare(`SELECT ${columns} FROM contacts c WHERE c.user_id = ? AND c.id = ?`)
		.bind(userId, id)
		.first<Row>();
	return row ? mapContact(row) : null;
}
export async function contactByEmail(
	db: D1Database,
	userId: string,
	email: string
): Promise<Contact | null> {
	const row = await db
		.prepare('SELECT contact_id FROM contact_emails WHERE user_id = ? AND email = ?')
		.bind(userId, email.trim().toLowerCase())
		.first<{ contact_id: string }>();
	return row ? getContact(db, userId, row.contact_id) : null;
}
export async function listContacts(
	db: D1Database,
	userId: string,
	query = '',
	limit = 100,
	offset = 0
) {
	const search = query
		.trim()
		.slice(0, 200)
		.replace(/[\\%_]/g, (value) => `\\${value}`);
	const pattern = `%${search}%`;
	const where = `c.user_id = ? AND (c.name LIKE ? ESCAPE '\\' OR c.company LIKE ? ESCAPE '\\'
    OR EXISTS (SELECT 1 FROM contact_emails e WHERE e.contact_id = c.id AND e.email LIKE ? ESCAPE '\\'))`;
	const args = [userId, pattern, pattern, pattern];
	const [rows, count] = await Promise.all([
		db
			.prepare(
				`SELECT ${columns} FROM contacts c WHERE ${where} ORDER BY c.starred DESC, c.name COLLATE NOCASE, c.id LIMIT ? OFFSET ?`
			)
			.bind(
				...args,
				Math.max(1, Math.min(5000, Math.trunc(limit))),
				Math.max(0, Math.trunc(offset))
			)
			.all<Row>(),
		db
			.prepare(`SELECT COUNT(*) AS total FROM contacts c WHERE ${where}`)
			.bind(...args)
			.first<{ total: number }>()
	]);
	return { contacts: rows.results.map(mapContact), total: count?.total ?? 0 };
}
export async function saveContact(
	db: D1Database,
	userId: string,
	raw: unknown,
	id: string = crypto.randomUUID()
): Promise<Contact> {
	const parsed = contactInput.safeParse(raw);
	if (!parsed.success)
		throw error(400, 'Enter a name and at least one valid email address; check field lengths.');
	const input = parsed.data;
	const emails = [...new Set(input.emails)];
	const current = await getContact(db, userId, id);
	if (input.version && !current) throw error(404, 'Contact not found');
	if (current && input.version !== current.version)
		throw error(409, 'This contact changed. Reload it before saving.');
	const mutation = crypto.randomUUID();
	const now = new Date().toISOString();
	const statements = current
		? [
				db
					.prepare(
						`UPDATE contacts SET name = ?, company = ?, phone = ?, notes = ?, starred = ?,
    version = version + 1, mutation_id = ?, updated_at = ? WHERE id = ? AND user_id = ? AND version = ?`
					)
					.bind(
						input.name || emails[0],
						input.company,
						input.phone,
						input.notes,
						+input.starred,
						mutation,
						now,
						id,
						userId,
						input.version!
					)
			]
		: [
				db
					.prepare(
						`INSERT INTO contacts (id, user_id, name, company, phone, notes, starred, mutation_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
					)
					.bind(
						id,
						userId,
						input.name || emails[0],
						input.company,
						input.phone,
						input.notes,
						+input.starred,
						mutation,
						now,
						now
					)
			];
	statements.push(
		db
			.prepare(
				`DELETE FROM contact_emails WHERE contact_id = ? AND user_id = ?
    AND EXISTS (SELECT 1 FROM contacts WHERE id = ? AND mutation_id = ?)`
			)
			.bind(id, userId, id, mutation)
	);
	for (const [position, email] of emails.entries())
		statements.push(
			db
				.prepare(
					`INSERT INTO contact_emails (contact_id, user_id, email, position)
    SELECT id, user_id, ?, ? FROM contacts WHERE id = ? AND user_id = ? AND mutation_id = ?`
				)
				.bind(email, position, id, userId, mutation)
		);
	let results;
	try {
		results = await db.batch(statements);
	} catch (cause) {
		if (String(cause).includes('UNIQUE'))
			throw error(409, 'An email address already belongs to another contact.');
		throw cause;
	}
	if (!results[0].meta.changes) throw error(409, 'This contact changed. Reload it before saving.');
	return (await getContact(db, userId, id))!;
}
export async function deleteContact(db: D1Database, userId: string, id: string, version: number) {
	const result = await db
		.prepare('DELETE FROM contacts WHERE id = ? AND user_id = ? AND version = ?')
		.bind(id, userId, version)
		.run();
	if (!result.meta.changes)
		throw error(409, 'Contact not found or changed. Reload before deleting.');
}
