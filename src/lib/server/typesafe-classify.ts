import { TypeSafeClient, choice, noul, type TypeSafeClientConfig } from '@typesafe-ai/sdk';
import type { MailLabel } from '$lib/types';
import type { ClassificationJudgments } from './classify-policy';

const BODY_CHARS = 4_000;
const REQUEST_TIMEOUT_MS = 8_000;
const BATCH_TIMEOUT_MS = 20_000;
/** Emails per TypeSafe HTTP call. Questions run in parallel inside one call. */
export const TYPESAFE_MAIL_CHUNK = 25;

/** Real keys only — deploy-button placeholders must not enable classification. */
export function configuredTypesafeKey(value: string | undefined): string | undefined {
	const key = value?.trim() ?? '';
	if (!key || /^REPLACE_WITH_/i.test(key)) return undefined;
	return key;
}

export type InboundJudgeInput = {
	from: string;
	fromName?: string | null;
	to: string;
	subject: string;
	bodyText?: string | null;
	attachmentNames: string[];
	autoLabels: Pick<MailLabel, 'id' | 'name' | 'auto_instructions'>[];
};

type Question = ReturnType<typeof noul> | ReturnType<typeof choice>;
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type MailSlot = {
	from: string;
	fromName: string | null;
	to: string;
	subject: string;
	bodyText: string;
	attachmentNames: string[];
};

const SPAM_CRITERIA = {
	true: 'Spam, phishing, malware, or a fraudulent invoice the recipient did not ask for. Not a newsletter the person likely subscribed to.',
	false: 'Legitimate personal, transactional, social, or marketing mail the recipient could reasonably want.'
};

const PHISHING_CRITERIA = {
	true: 'Credential theft, fake login pages, payment-detail harvesting, or impersonation of a trusted brand to take over an account.',
	false: 'No attempt to steal credentials or payment details.'
};

const CATEGORY_CRITERIA = {
	primary:
		'A person talking to the recipient: 1:1 mail, replies, introductions, or anything that is not clearly another tab.',
	social:
		'Social networks and community: GitHub, Twitter/X, LinkedIn, Facebook, dating, comments, friend requests.',
	promotions:
		'Marketing whose point is to sell: sales, ads, discount newsletters, product launches, “% off”.',
	updates:
		'Transactional mail the recipient may need: receipts, invoices, shipping, statements, security or login alerts, calendar, order status.',
	forums:
		'Mailing lists and groups: Google Groups, Discourse, list-id / “via list”, bulk discussion that is not 1:1.'
};

function mailSlot(index: number): string {
	return `m${index}`;
}

function spamQuestion(which: string): ReturnType<typeof noul> {
	return noul(`Is ${which} unsolicited junk, a scam, malware, or a fake invoice?`, SPAM_CRITERIA);
}

function phishingQuestion(which: string): ReturnType<typeof noul> {
	return noul(
		`Is ${which} trying to steal credentials, payment details, or account access?`,
		PHISHING_CRITERIA
	);
}

function categoryQuestion(which: string): ReturnType<typeof choice> {
	return choice(`Which inbox tab should ${which} live in?`, CATEGORY_CRITERIA);
}

function labelQuestions(
	which: string,
	autoLabels: InboundJudgeInput['autoLabels'],
	keyPrefix: string
): Record<string, ReturnType<typeof noul>> {
	const questions: Record<string, ReturnType<typeof noul>> = {};
	for (const label of autoLabels) {
		const instructions = label.auto_instructions?.trim();
		if (!instructions) continue;
		questions[`${keyPrefix}${label.id}`] = noul(
			`Should ${which} receive the user-defined label "${label.name}"?`,
			{
				true: instructions,
				false: `The email does not match: ${instructions}`
			}
		);
	}
	return questions;
}

export type MailBatchPayload = {
	state: { mail: Record<string, MailSlot> };
	questions: Record<string, Question>;
};

/** Pack many messages into one System One request. Jev scores the questions in parallel. */
export function mailBatchPayload(inputs: InboundJudgeInput[]): MailBatchPayload {
	const mail: Record<string, MailSlot> = {};
	const questions: Record<string, Question> = {};

	inputs.forEach((input, index) => {
		const slot = mailSlot(index);
		const which = `the email in \`mail.${slot}\``;
		mail[slot] = {
			from: input.from,
			fromName: input.fromName?.trim() || null,
			to: input.to,
			subject: input.subject,
			bodyText: (input.bodyText ?? '').slice(0, BODY_CHARS),
			attachmentNames: input.attachmentNames.slice(0, 20)
		};
		questions[`${slot}_spam`] = spamQuestion(which);
		questions[`${slot}_phish`] = phishingQuestion(which);
		questions[`${slot}_cat`] = categoryQuestion(which);
		Object.assign(questions, labelQuestions(which, input.autoLabels, `${slot}_l_`));
	});

	return { state: { mail }, questions };
}

type LooseAnswer = {
	type?: string;
	noul?: number;
	choice?: unknown;
	confidence?: number;
};

export function judgmentsFromBatchAnswers(
	answers: Record<string, LooseAnswer | undefined>,
	inputs: InboundJudgeInput[]
): (ClassificationJudgments | null)[] {
	return inputs.map((input, index) => {
		const slot = mailSlot(index);
		const spam = answers[`${slot}_spam`];
		const phishing = answers[`${slot}_phish`];
		const category = answers[`${slot}_cat`];
		if (spam?.type !== 'noul' || phishing?.type !== 'noul') return null;
		if (typeof spam.noul !== 'number' || typeof phishing.noul !== 'number') return null;

		const labels: ClassificationJudgments['labels'] = [];
		for (const label of input.autoLabels) {
			if (!label.auto_instructions?.trim()) continue;
			const answer = answers[`${slot}_l_${label.id}`];
			if (answer?.type === 'noul' && typeof answer.noul === 'number') {
				labels.push({ id: label.id, noul: answer.noul });
			}
		}

		return {
			isSpam: spam.noul,
			isPhishing: phishing.noul,
			category:
				category?.type === 'choice' && typeof category.confidence === 'number'
					? { choice: String(category.choice), confidence: category.confidence }
					: null,
			labels
		};
	});
}

function typesafeClient(
	apiKey: string,
	fetchImpl: typeof fetch,
	timeout: number
): TypeSafeClient {
	return new TypeSafeClient({
		apiKey,
		fetch: fetchImpl as TypeSafeClientConfig['fetch'],
		timeout,
		logLevel: 'error'
	});
}

function chunkInputs<T>(items: T[], size: number): T[][] {
	const groups: T[][] = [];
	for (let i = 0; i < items.length; i += size) {
		groups.push(items.slice(i, i + size));
	}
	return groups;
}

/**
 * One TypeSafe call per message: spam/phishing Nouls, a category Choice, and
 * optional custom-label Nouls. Failures return null so ingest can fail open.
 */
export async function judgeInboundMail(
	apiKey: string,
	input: InboundJudgeInput,
	fetchImpl: typeof fetch = fetch
): Promise<ClassificationJudgments | null> {
	const judged = await judgeInboundMailBatch(apiKey, [input], fetchImpl);
	return judged[0] ?? null;
}

/**
 * Classify many messages in a handful of TypeSafe calls. Independent questions
 * over one state run in parallel — this is how Jev stays fast at inbox scale.
 */
export async function judgeInboundMailBatch(
	apiKey: string,
	inputs: InboundJudgeInput[],
	fetchImpl: typeof fetch = fetch
): Promise<(ClassificationJudgments | null)[]> {
	if (inputs.length === 0) return [];

	const key = apiKey.trim();
	if (!key) return inputs.map(() => null);

	const client = typesafeClient(
		key,
		fetchImpl,
		inputs.length === 1 ? REQUEST_TIMEOUT_MS : BATCH_TIMEOUT_MS
	);
	const groups = chunkInputs(inputs, TYPESAFE_MAIL_CHUNK);
	const judged = await Promise.all(
		groups.map(async (group) => {
			try {
				const payload = mailBatchPayload(group);
				const result = await client.systemOne({
					state: { mail: payload.state.mail } as { mail: Record<string, JsonValue> },
					questions: payload.questions
				});
				return judgmentsFromBatchAnswers(
					result.answers as Record<string, LooseAnswer | undefined>,
					group
				);
			} catch (error) {
				console.error('TypeSafe classification failed', error);
				return group.map(() => null);
			}
		})
	);
	return judged.flat();
}
