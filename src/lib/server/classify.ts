import type { D1Database } from '@cloudflare/workers-types';
import type { EmailRow } from '$lib/types';
import type { ClassifyCursor, ClassifyStep } from '$lib/mail/classify-progress';
import {
	bumpMailboxEpoch,
	expandToThreads,
	getEmailForUser,
	getThreadKey,
	getThreadUserCategory,
	setEmailFlags,
	countUnclassifiedInbound,
	listUnclassifiedInbound
} from './mail-store';
import { listAutoLabels, setEmailAutoLabels, getSenderPref } from './labels';
import { listAttachments } from './attachments';
import { decideClassification, persistClassification } from './classify-policy';
import { configuredTypesafeKey, judgeInboundMail } from './typesafe-classify';
import { stripHtml } from './html';
import { scheduleNewMailNotification, type PushNotificationEnv } from './push-notifications';
import {
	scheduleTelegramNotification,
	type StoredAttachment,
	type TelegramNotificationEnv
} from './telegram-notify';

export type ClassifyEnv = PushNotificationEnv &
	TelegramNotificationEnv & {
		TYPESAFE_API_KEY?: string;
	};

export type ClassifyMailInput = {
	emailId: string;
	userId: string;
	from: string;
	fromName?: string | null;
	to: string;
	subject: string;
	bodyText?: string | null;
	attachmentNames?: string[];
};

export type InboundClassifyInput = ClassifyMailInput & {
	attachmentNames: string[];
	telegram: {
		from: string;
		to: string;
		subject: string;
		body: string | null;
		attachments: StoredAttachment[];
	};
};

export type ClassifyApplyResult = {
	applied: boolean;
	notify: boolean;
	subject: string;
};

export type MailJudge = typeof judgeInboundMail;

/**
 * Classify after the message is stored, then notify unless it is spam or a
 * quiet category. Designed to run inside `waitUntil`.
 */
export async function classifyThenNotify(env: ClassifyEnv, input: InboundClassifyInput): Promise<void> {
	let notify = true;
	try {
		notify = await classifyInboundEmail(env.DB, env.TYPESAFE_API_KEY, input);
	} catch (error) {
		console.error('Inbound classification failed', input.emailId, error);
	}
	if (!notify) return;

	await scheduleNewMailNotification(env, {
		emailId: input.emailId,
		userId: input.userId,
		from: input.fromName || input.from,
		subject: input.subject
	});
	scheduleTelegramNotification(env, {
		...input.telegram,
		threadKey: await getThreadKey(env.DB, input.emailId)
	});
}

export function scheduleInboundClassification(
	env: ClassifyEnv,
	input: InboundClassifyInput
): void {
	const task = classifyThenNotify(env, input);
	if (env.waitUntil) {
		env.waitUntil(task);
		return;
	}
	void task;
}

export async function classifyInboundEmail(
	db: D1Database,
	apiKey: string | undefined,
	input: InboundClassifyInput
): Promise<boolean> {
	return (await classifyStoredEmail(db, apiKey, input)).notify;
}

export async function classifyStoredEmail(
	db: D1Database,
	apiKey: string | undefined,
	input: ClassifyMailInput,
	options?: { judge?: MailJudge }
): Promise<ClassifyApplyResult> {
	const email = await getEmailForUser(db, input.userId, input.emailId);
	if (!email) {
		return { applied: false, notify: true, subject: input.subject };
	}

	if (email.category_source || email.spam_source) {
		return { applied: false, notify: false, subject: email.subject };
	}

	const key = configuredTypesafeKey(apiKey);
	const threadId = email.thread_id ?? email.id;
	const [senderDisposition, userLockedCategory, autoLabels] = await Promise.all([
		getSenderPref(db, input.userId, input.from),
		getThreadUserCategory(db, input.userId, threadId),
		key ? listAutoLabels(db, input.userId) : Promise.resolve([])
	]);

	const judge = options?.judge ?? judgeInboundMail;
	const attachmentNames =
		input.attachmentNames ??
		(await listAttachments(db, input.emailId)).map((file) => file.filename);

	const judgments =
		senderDisposition === 'spam' || !key
			? null
			: await judge(key, {
					from: input.from,
					fromName: input.fromName,
					to: input.to,
					subject: input.subject,
					bodyText: input.bodyText,
					attachmentNames,
					autoLabels
				});

	const decision = persistClassification(
		decideClassification({
			senderDisposition,
			userLockedCategory,
			judgments
		}),
		Boolean(judgments)
	);

	const ids = await expandToThreads(db, input.userId, [input.emailId]);

	if (decision.spam) {
		await setEmailFlags(db, input.userId, ids, {
			spam: true,
			spamSource: 'auto'
		});
		return { applied: true, notify: false, subject: email.subject };
	}

	if (decision.categorySource === 'user') {
		await setEmailFlags(db, input.userId, [input.emailId], {
			category: decision.category,
			categorySource: 'user'
		});
	} else if (decision.categorySource === 'auto') {
		await setEmailFlags(db, input.userId, ids, {
			category: decision.category,
			categorySource: 'auto'
		});
	} else {
		return { applied: false, notify: decision.notify, subject: email.subject };
	}

	if (decision.labelIds.length > 0 && judgments) {
		const scores = new Map(judgments.labels.map((label) => [label.id, label.noul]));
		await setEmailAutoLabels(
			db,
			input.emailId,
			decision.labelIds.map((labelId) => ({
				labelId,
				score: scores.get(labelId) ?? 0
			}))
		);
		await bumpMailboxEpoch(db, input.userId);
	}

	return { applied: true, notify: decision.notify, subject: email.subject };
}

function bodyForJudge(email: EmailRow): string | null {
	const text = email.body_text?.trim();
	if (text) return text;
	if (email.body_html) return stripHtml(email.body_html) || null;
	return null;
}

/**
 * Classify the next unclassified inbound message. One email per call so the
 * settings page can paint progress after every TypeSafe response.
 */
export async function classifyNextExisting(
	db: D1Database,
	apiKey: string,
	userId: string,
	cursor: ClassifyCursor | null,
	options?: { judge?: MailJudge }
): Promise<ClassifyStep> {
	const emails = await listUnclassifiedInbound(db, userId, { after: cursor, limit: 1 });
	if (emails.length === 0) {
		return {
			enabled: true,
			applied: false,
			subject: null,
			remaining: await countUnclassifiedInbound(db, userId),
			cursor,
			complete: true
		};
	}

	const email = emails[0];
	const nextCursor: ClassifyCursor = { createdAt: email.created_at, id: email.id };
	const result = await classifyStoredEmail(
		db,
		apiKey,
		{
			emailId: email.id,
			userId,
			from: email.from_addr,
			fromName: email.from_name,
			to: email.to_addr,
			subject: email.subject,
			bodyText: bodyForJudge(email)
		},
		options
	);
	const remaining = await countUnclassifiedInbound(db, userId);

	return {
		enabled: true,
		applied: result.applied,
		subject: result.subject,
		remaining,
		cursor: nextCursor,
		complete: remaining === 0
	};
}
