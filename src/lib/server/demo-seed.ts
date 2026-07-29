/**
 * Seeds a lived-in mailbox for local cinematic demos.
 * Only callable when RESEND_API_KEY=demo_local.
 */
import type { D1Database } from '@cloudflare/workers-types';
import { insertEmail } from './mail-store';

type SeedMessage = {
	direction: 'inbound' | 'outbound';
	from: string;
	to: string;
	cc?: string;
	subject: string;
	bodyText: string;
	bodyHtml: string;
	isRead?: boolean;
	isStarred?: boolean;
	status?: 'queued' | 'delivered' | 'draft';
	minutesAgo: number;
	messageId?: string;
	inReplyTo?: string;
};

function buildSeed(mailbox: string, domain: string): SeedMessage[] {
	return [
		{
			direction: 'inbound',
			from: 'priya@northwind.studio',
			to: mailbox,
			subject: `Launch checklist for ${domain}`,
			bodyText: `Hey — can we lock the hero copy and confirm MX for ${domain} today? I left notes in the shared doc. Ping me when you're free.`,
			bodyHtml: `<p>Hey — can we lock the <strong>hero copy</strong> and confirm MX for <strong>${domain}</strong> today?</p><p>I left notes in the shared doc. Ping me when you're free.</p>`,
			isRead: false,
			minutesAgo: 18,
			messageId: '<seed-launch-1@northwind.studio>'
		},
		{
			direction: 'outbound',
			from: mailbox,
			to: 'priya@northwind.studio',
			subject: `Re: Launch checklist for ${domain}`,
			bodyText: `Hero copy is frozen. MX is live on ${domain} — receiving looks good from my tests. Sending the checklist back with checkmarks.`,
			bodyHtml: `<p>Hero copy is frozen. MX is live on <strong>${domain}</strong> — receiving looks good from my tests.</p><p>Sending the checklist back with checkmarks.</p>`,
			isRead: true,
			status: 'delivered',
			minutesAgo: 12,
			messageId: `<seed-launch-2@${domain}>`,
			inReplyTo: '<seed-launch-1@northwind.studio>'
		},
		{
			direction: 'inbound',
			from: 'billing@stripe.com',
			to: mailbox,
			subject: 'Your receipt from Stripe #2094-4821',
			bodyText:
				'Thanks for your payment of $29.00 to QuickMail Hosting. This email is a receipt for your recent payment. Amount: $29.00 USD. Payment method: Visa ending in 4242. Next charge: April 1.',
			bodyHtml:
				'<p>Thanks for your payment of <strong>$29.00</strong> to QuickMail Hosting.</p><p>This email is a receipt for your recent payment.</p><p>Amount: $29.00 USD<br>Payment method: Visa ending in 4242<br>Next charge: April 1</p>',
			isRead: false,
			minutesAgo: 55,
			messageId: '<seed-invoice@stripe.com>'
		},
		{
			direction: 'inbound',
			from: 'sam@pixelcraft.io',
			to: mailbox,
			subject: 'Design review: settings + composer',
			bodyText:
				'Composer spacing feels right. One note: the domain switcher could use a stronger active state. Happy to mock a variant this afternoon.',
			bodyHtml:
				'<p>Composer spacing feels right.</p><p>One note: the <em>domain switcher</em> could use a stronger active state. Happy to mock a variant this afternoon.</p>',
			isRead: true,
			isStarred: true,
			minutesAgo: 140,
			messageId: '<seed-design@pixelcraft.io>'
		},
		{
			direction: 'inbound',
			from: 'alex@vercel.com',
			to: mailbox,
			subject: `DNS for ${domain} looks good`,
			bodyText: `Checked the records for ${domain} — MX and SPF are resolving cleanly. Let me know if you want help with DKIM next.`,
			bodyHtml: `<p>Checked the records for <strong>${domain}</strong> — MX and SPF are resolving cleanly.</p><p>Let me know if you want help with DKIM next.</p>`,
			isRead: true,
			minutesAgo: 360,
			messageId: '<seed-dns@vercel.com>'
		},
		{
			direction: 'inbound',
			from: 'ops@resend.com',
			to: mailbox,
			subject: 'Weekly digest — delivery for your domain',
			bodyText:
				'You sent 412 messages this week. Peak hour was Tuesday 14:00 UTC. Delivery rate stayed at 99.4%.',
			bodyHtml:
				'<p>You sent <strong>412</strong> messages this week.</p><p>Peak hour was Tuesday 14:00 UTC. Delivery rate stayed at 99.4%.</p>',
			isRead: false,
			minutesAgo: 900,
			messageId: '<seed-digest@resend.com>'
		},
		{
			direction: 'outbound',
			from: mailbox,
			to: 'partners@brightline.co',
			subject: `Intro — mail on ${domain}`,
			bodyText: `Sharing a quick walkthrough of self-hosted mail on ${domain}. Happy to hop on a call this week if useful.`,
			bodyHtml: `<p>Sharing a quick walkthrough of self-hosted mail on <strong>${domain}</strong>.</p><p>Happy to hop on a call this week if useful.</p>`,
			isRead: true,
			status: 'delivered',
			minutesAgo: 1200,
			messageId: `<seed-intro@${domain}>`
		},
		{
			direction: 'outbound',
			from: mailbox,
			to: '',
			subject: 'Notes for Friday',
			bodyText: 'Open with domain setup, then inbox, compose, star, settings, add support user.',
			bodyHtml:
				'<p>Friday notes:</p><ul><li>Domain setup</li><li>Inbox + thread</li><li>Compose</li><li>Star + settings</li><li>Add support user</li></ul>',
			isRead: true,
			status: 'draft',
			minutesAgo: 40,
			messageId: `<seed-draft@${domain}>`
		}
	];
}

export async function seedDemoMailbox(
	db: D1Database,
	userId: string,
	domainId: string,
	domainName: string,
	mailbox: string
): Promise<{ inserted: number }> {
	const existing = await db
		.prepare(
			`SELECT COUNT(*) AS count FROM emails
			 WHERE user_id = ? AND message_id LIKE '<seed-%'`
		)
		.bind(userId)
		.first<{ count: number }>();

	if ((existing?.count ?? 0) > 0) {
		return { inserted: 0 };
	}

	let inserted = 0;
	for (const item of buildSeed(mailbox, domainName)) {
		const id = await insertEmail(db, {
			userId,
			direction: item.direction,
			from: item.from,
			to: item.to || mailbox,
			cc: item.cc ?? null,
			subject: item.subject,
			bodyText: item.bodyText,
			bodyHtml: item.bodyHtml,
			messageId: item.messageId ?? null,
			inReplyTo: item.inReplyTo ?? null,
			domainId,
			providerId:
				item.direction === 'outbound' && item.status !== 'draft'
					? `demo_${crypto.randomUUID()}`
					: null,
			status: item.status ?? null,
			isRead: item.isRead ?? false
		});

		const createdAt = new Date(Date.now() - item.minutesAgo * 60_000)
			.toISOString()
			.replace('T', ' ')
			.replace(/\.\d{3}Z$/, '');

		await db
			.prepare(
				`UPDATE emails
				 SET created_at = ?, is_starred = ?, deleted_at = NULL
				 WHERE id = ?`
			)
			.bind(createdAt, item.isStarred ? 1 : 0, id)
			.run();

		inserted += 1;
	}

	return { inserted };
}
