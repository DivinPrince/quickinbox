import { TypeSafeClient, choice, noul, type TypeSafeClientConfig } from '@typesafe-ai/sdk';
import type { MailLabel } from '$lib/types';
import type { ClassificationJudgments } from './classify-policy';

const BODY_CHARS = 4_000;
const REQUEST_TIMEOUT_MS = 8_000;

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

/**
 * One TypeSafe call per message: spam/phishing Nouls, a category Choice, and
 * optional custom-label Nouls. Failures return null so ingest can fail open.
 */
export async function judgeInboundMail(
	apiKey: string,
	input: InboundJudgeInput,
	fetchImpl: typeof fetch = fetch
): Promise<ClassificationJudgments | null> {
	const key = apiKey.trim();
	if (!key) return null;

	const state = {
		from: input.from,
		fromName: input.fromName?.trim() || null,
		to: input.to,
		subject: input.subject,
		bodyText: (input.bodyText ?? '').slice(0, BODY_CHARS),
		attachmentNames: input.attachmentNames.slice(0, 20)
	};

	const questions: Record<string, ReturnType<typeof noul> | ReturnType<typeof choice>> = {
		is_spam: noul('Is this unsolicited junk, a scam, malware, or a fake invoice?', {
			true: 'Spam, phishing, malware, or a fraudulent invoice the recipient did not ask for. Not a newsletter the person likely subscribed to.',
			false: 'Legitimate personal, transactional, social, or marketing mail the recipient could reasonably want.'
		}),
		is_phishing: noul('Is this trying to steal credentials, payment details, or account access?', {
			true: 'Credential theft, fake login pages, payment-detail harvesting, or impersonation of a trusted brand to take over an account.',
			false: 'No attempt to steal credentials or payment details.'
		}),
		category: choice('Which inbox tab should this email live in?', {
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
		})
	};

	for (const label of input.autoLabels) {
		const instructions = label.auto_instructions?.trim();
		if (!instructions) continue;
		questions[`label_${label.id}`] = noul(
			`Should this email receive the user-defined label "${label.name}"?`,
			{
				true: instructions,
				false: `The email does not match: ${instructions}`
			}
		);
	}

	try {
		const client = new TypeSafeClient({
			apiKey: key,
			fetch: fetchImpl as TypeSafeClientConfig['fetch'],
			timeout: REQUEST_TIMEOUT_MS,
			logLevel: 'error'
		});
		const result = await client.systemOne({ state, questions });
		const answers = result.answers;

		const spam = answers.is_spam;
		const phishing = answers.is_phishing;
		const category = answers.category;
		if (spam?.type !== 'noul' || phishing?.type !== 'noul') return null;

		const labels: ClassificationJudgments['labels'] = [];
		for (const label of input.autoLabels) {
			const answer = answers[`label_${label.id}`];
			if (answer?.type === 'noul') labels.push({ id: label.id, noul: answer.noul });
		}

		return {
			isSpam: spam.noul,
			isPhishing: phishing.noul,
			category:
				category?.type === 'choice'
					? { choice: String(category.choice), confidence: category.confidence }
					: null,
			labels
		};
	} catch (error) {
		console.error('TypeSafe classification failed', error);
		return null;
	}
}
