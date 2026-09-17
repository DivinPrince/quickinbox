import type { D1Database } from '@cloudflare/workers-types';
import type { EmailRow, InboxCategory } from '$lib/types';
import { classifyExistingBatchSize, type ClassifyCursor, type ClassifyStep } from '$lib/mail/classify-progress';
import {
	bumpMailboxEpoch,
	expandToThreads,
	getEmailForUser,
	getThreadKey,
	getThreadUserCategory,
	listThreadUserCategories,
	setEmailFlags,
	countUnclassifiedInbound,
	listUnclassifiedInbound
} from './mail-store';
import { listAutoLabels, setEmailAutoLabels, getSenderPref, listSenderPrefs } from './labels';
import { listAttachments } from './attachments';
import {
	decideClassification,
	persistClassification,
	type ClassificationJudgments
} from './classify-policy';
import {
	configuredTypesafeKey,
	judgeInboundMail,
	judgeInboundMailBatch,
	type InboundJudgeInput
} from './typesafe-classify';
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
export type MailBatchJudge = typeof judgeInboundMailBatch;

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

	return persistMailDecision(db, input.userId, email, decision, judgments);
}

async function persistMailDecision(
	db: D1Database,
	userId: string,
	email: EmailRow,
	decision: ReturnType<typeof persistClassification>,
	judgments: ClassificationJudgments | null
): Promise<ClassifyApplyResult> {
	const ids = await expandToThreads(db, userId, [email.id]);

	if (decision.spam) {
		await setEmailFlags(db, userId, ids, {
			spam: true,
			spamSource: 'auto'
		});
		return { applied: true, notify: false, subject: email.subject };
	}

	if (decision.categorySource === 'user') {
		await setEmailFlags(db, userId, [email.id], {
			category: decision.category,
			categorySource: 'user'
		});
	} else if (decision.categorySource === 'auto') {
		await setEmailFlags(db, userId, ids, {
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
			email.id,
			decision.labelIds.map((labelId) => ({
				labelId,
				score: scores.get(labelId) ?? 0
			}))
		);
		await bumpMailboxEpoch(db, userId);
	}

	return { applied: true, notify: decision.notify, subject: email.subject };
}

function bodyForJudge(email: EmailRow): string | null {
	const text = email.body_text?.trim();
	if (text) return text;
	if (email.body_html) return stripHtml(email.body_html) || null;
	return null;
}

/** Classify the next unclassified window in one TypeSafe batch. */
export async function classifyNextExisting(
	db: D1Database,
	apiKey: string,
	userId: string,
	cursor: ClassifyCursor | null,
	options?: { judge?: MailJudge; batchJudge?: MailBatchJudge }
): Promise<ClassifyStep> {
	const remainingNow = await countUnclassifiedInbound(db, userId);
	const limit = classifyExistingBatchSize(remainingNow);
	if (limit === 0) {
		return {
			enabled: true,
			applied: false,
			subject: null,
			remaining: remainingNow,
			cursor,
			complete: true
		};
	}

	const emails = await listUnclassifiedInbound(db, userId, { limit });
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

	const key = configuredTypesafeKey(apiKey);
	const [autoLabels, senderPrefs, userCategories] = await Promise.all([
		key ? listAutoLabels(db, userId) : Promise.resolve([]),
		listSenderPrefs(db, userId),
		listThreadUserCategories(db, userId)
	]);
	const contexts = emails.map((email) => {
		const threadId = email.thread_id ?? email.id;
		const senderDisposition = senderPrefs.get(email.from_addr.trim().toLowerCase()) ?? null;
		const userLockedCategory = userCategories.get(threadId) ?? null;
		const input: InboundJudgeInput = {
			from: email.from_addr,
			fromName: email.from_name,
			to: email.to_addr,
			subject: email.subject,
			bodyText: bodyForJudge(email),
			attachmentNames: [],
			autoLabels
		};
		return { email, senderDisposition, userLockedCategory, input };
	});

	const needJudge = key
		? contexts.filter((item) => item.senderDisposition !== 'spam')
		: [];
	const judged =
		!key || needJudge.length === 0
			? []
			: options?.judge && !options.batchJudge
				? await Promise.all(needJudge.map((item) => options.judge!(key, item.input)))
				: await (options?.batchJudge ?? judgeInboundMailBatch)(
						key,
						needJudge.map((item) => item.input)
					);

	const byEmail = new Map<string, ClassificationJudgments | null>();
	needJudge.forEach((item, index) => {
		byEmail.set(item.email.id, judged[index] ?? null);
	});

	const spamIds: string[] = [];
	const userLocked: { id: string; category: InboxCategory }[] = [];
	const autoByCategory = new Map<InboxCategory, string[]>();
	const labeled: {
		emailId: string;
		labelIds: string[];
		judgments: ClassificationJudgments;
	}[] = [];
	let applied = false;
	let subject: string | null = null;

	for (const item of contexts) {
		const judgments =
			item.senderDisposition === 'spam' ? null : (byEmail.get(item.email.id) ?? null);
		const decision = persistClassification(
			decideClassification({
				senderDisposition: item.senderDisposition,
				userLockedCategory: item.userLockedCategory,
				judgments
			}),
			Boolean(judgments)
		);
		subject = item.email.subject;

		if (decision.spam) {
			spamIds.push(item.email.id);
			applied = true;
			continue;
		}
		if (decision.categorySource === 'user') {
			userLocked.push({ id: item.email.id, category: decision.category });
			applied = true;
		} else if (decision.categorySource === 'auto') {
			const bucket = autoByCategory.get(decision.category) ?? [];
			bucket.push(item.email.id);
			autoByCategory.set(decision.category, bucket);
			applied = true;
		}
		if (decision.labelIds.length > 0 && judgments) {
			labeled.push({ emailId: item.email.id, labelIds: decision.labelIds, judgments });
		}
	}

	if (spamIds.length > 0) {
		await setEmailFlags(db, userId, await expandToThreads(db, userId, spamIds), {
			spam: true,
			spamSource: 'auto'
		});
	}
	for (const row of userLocked) {
		await setEmailFlags(db, userId, [row.id], {
			category: row.category,
			categorySource: 'user'
		});
	}
	for (const [category, ids] of autoByCategory) {
		await setEmailFlags(db, userId, await expandToThreads(db, userId, ids), {
			category,
			categorySource: 'auto'
		});
	}
	for (const row of labeled) {
		const scores = new Map(row.judgments.labels.map((label) => [label.id, label.noul]));
		await setEmailAutoLabels(
			db,
			row.emailId,
			row.labelIds.map((labelId) => ({
				labelId,
				score: scores.get(labelId) ?? 0
			}))
		);
	}
	if (labeled.length > 0) await bumpMailboxEpoch(db, userId);

	const last = emails[emails.length - 1];
	const remaining = await countUnclassifiedInbound(db, userId);
	return {
		enabled: true,
		applied,
		subject,
		remaining,
		cursor: { createdAt: last.created_at, id: last.id },
		complete: remaining === 0 || !applied
	};
}
