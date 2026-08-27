import type { D1Database } from '@cloudflare/workers-types';
import { normalizeEmailSignature } from '$lib/email-signature';

export async function getEmailSignature(db: D1Database, userId: string): Promise<string> {
	const row = await db
		.prepare('SELECT email_signature FROM users WHERE id = ?')
		.bind(userId)
		.first<{ email_signature: string }>();

	return row?.email_signature ?? '';
}

export async function updateEmailSignature(
	db: D1Database,
	userId: string,
	value: string
): Promise<string> {
	const signature = normalizeEmailSignature(value);
	await db
		.prepare('UPDATE users SET email_signature = ? WHERE id = ?')
		.bind(signature, userId)
		.run();

	return signature;
}
