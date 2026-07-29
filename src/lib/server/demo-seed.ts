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
			from: 'maya@northwind.studio',
			to: mailbox,
			subject: `Launch checklist for ${domain}`,
			bodyText:
				'Hey — can we lock the hero copy and the MX records today? I left notes in the shared doc.',
			bodyHtml:
				'<p>Hey — can we lock the <strong>hero copy</strong> and the MX records today?</p><p>I left notes in the shared doc. Ping me when you are free.</p>',
			isRead: false,
			minutesAgo: 18,
			messageId: '<seed-launch-1@northwind.studio>'
		},
		{
			direction: 'outbound',
			from: mailbox,
			to: 'maya@northwind.studio',
			subject: `Re: Launch checklist for ${domain}`,
			bodyText: `Hero copy is frozen. MX is live on ${domain} — receiving looks good from my tests.`,
			bodyHtml: `<p>Hero copy is frozen. MX is live on <strong>${domain}</strong> — receiving looks good from my tests.</p><p>Sending the checklist back with checkmarks.</p>`,
			isRead: true,
			status: 'delivered',
			minutesAgo: 12,
			messageId: `<seed-launch-2@${domain}>`,
			inReplyTo: '<seed-launch-1@northwind.studio>'
		},
		{
			direction: 'inbound',
			from: 'jordan@atelier.mail',
			to: mailbox,
			subject: 'Invoice #4821 — QuickMail hosting',
			bodyText: 'Attached is invoice 4821 for March. Card on file will be charged Friday.',
			bodyHtml:
				'<p>Attached is invoice <strong>#4821</strong> for March.</p><p>Card on file will be charged Friday. Reply if anything looks off.</p>',
			isRead: false,
			minutesAgo: 55,
			messageId: '<seed-invoice@atelier.mail>'
		},
		{
			direction: 'inbound',
			from: 'sam@pixelcraft.io',
			to: mailbox,
			subject: 'Design review: settings + composer',
			bodyText:
				'Composer spacing feels right. One note: the domain switcher could use a stronger active state.',
			bodyHtml:
				'<p>Composer spacing feels right.</p><p>One note: the <em>domain switcher</em> could use a stronger active state. Happy to mock a variant.</p>',
			isRead: true,
			isStarred: true,
			minutesAgo: 140,
			messageId: '<seed-design@pixelcraft.io>'
		},
		{
			direction: 'inbound',
			from: 'alex@fieldnotes.app',
			to: mailbox,
			subject: `Welcome to your own mail on ${domain}`,
			bodyText:
				'This is a sample welcome note so the inbox never looks empty during demos. Star what matters, archive the rest.',
			bodyHtml: `<p>Welcome to mail on <strong>${domain}</strong>.</p><p>This is a sample welcome note so the inbox never looks empty during demos. Star what matters, archive the rest.</p>`,
			isRead: true,
			minutesAgo: 360,
			messageId: '<seed-welcome@fieldnotes.app>'
		},
		{
			direction: 'inbound',
			from: 'ops@cloudlane.dev',
			to: mailbox,
			subject: 'Weekly digest — edge mail volume',
			bodyText: 'You processed 412 messages this week. Peak hour was Tuesday 14:00 UTC.',
			bodyHtml:
				'<p>You processed <strong>412</strong> messages this week.</p><p>Peak hour was Tuesday 14:00 UTC. Delivery rate stayed at 99.4%.</p>',
			isRead: false,
			minutesAgo: 900,
			messageId: '<seed-digest@cloudlane.dev>'
		},
		{
			direction: 'outbound',
			from: mailbox,
			to: 'partners@brightline.co',
			subject: 'Intro — self-hosted mail for your domain',
			bodyText: `Sharing a quick walkthrough of QuickMail on ${domain}. Happy to hop on a call this week.`,
			bodyHtml: `<p>Sharing a quick walkthrough of QuickMail on <strong>${domain}</strong>.</p><p>Happy to hop on a call this week.</p>`,
			isRead: true,
			status: 'delivered',
			minutesAgo: 1200,
			messageId: `<seed-intro@${domain}>`
		},
		{
			direction: 'outbound',
			from: mailbox,
			to: '',
			subject: 'Notes for Friday demo',
			bodyText: 'Draft: open with onboarding, then inbox, compose, star, settings.',
			bodyHtml:
				'<p>Draft notes for Friday:</p><ul><li>Open with onboarding</li><li>Inbox with seeded threads</li><li>Compose + star + settings</li></ul>',
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
