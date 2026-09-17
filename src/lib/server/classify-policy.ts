import { DEFAULT_INBOX_CATEGORY, isInboxCategory, isQuietCategory } from '$lib/mail/categories';
import type { InboxCategory } from '$lib/types';

export const SPAM_NOUL_THRESHOLD = 0.9;
export const PHISHING_NOUL_THRESHOLD = 0.85;
export const CATEGORY_CONFIDENCE_THRESHOLD = 0.55;
export const LABEL_NOUL_THRESHOLD = 0.7;

export type SenderDisposition = 'spam' | 'safe';

export type CategoryJudgment = {
	choice: string;
	confidence: number;
};

export type LabelJudgment = {
	id: string;
	noul: number;
};

export type ClassificationJudgments = {
	isSpam: number;
	isPhishing: number;
	category: CategoryJudgment | null;
	labels: LabelJudgment[];
};

export type ClassificationInput = {
	senderDisposition: SenderDisposition | null;
	/** User already picked a tab on this thread. */
	userLockedCategory: InboxCategory | null;
	judgments: ClassificationJudgments | null;
};

export type ClassificationDecision = {
	spam: boolean;
	notify: boolean;
	category: InboxCategory;
	categorySource: 'auto' | 'user' | null;
	labelIds: string[];
};

/**
 * Code owns the routing. TypeSafe supplies probabilities; this function decides
 * what the mailbox actually does with them.
 */
export function decideClassification(input: ClassificationInput): ClassificationDecision {
	const locked = input.userLockedCategory;

	if (input.senderDisposition === 'spam') {
		return {
			spam: true,
			notify: false,
			category: locked ?? DEFAULT_INBOX_CATEGORY,
			categorySource: locked ? 'user' : null,
			labelIds: []
		};
	}

	const judgments = input.judgments;
	if (!judgments) {
		return failOpen(locked);
	}

	const spam =
		input.senderDisposition !== 'safe' &&
		(judgments.isPhishing >= PHISHING_NOUL_THRESHOLD || judgments.isSpam >= SPAM_NOUL_THRESHOLD);

	if (spam) {
		return {
			spam: true,
			notify: false,
			category: locked ?? DEFAULT_INBOX_CATEGORY,
			categorySource: locked ? 'user' : null,
			labelIds: []
		};
	}

	const category = locked ?? pickCategory(judgments.category);
	const categorySource: 'auto' | 'user' | null = locked
		? 'user'
		: category === DEFAULT_INBOX_CATEGORY &&
			  (!judgments.category || judgments.category.confidence < CATEGORY_CONFIDENCE_THRESHOLD)
			? null
			: 'auto';

	const labelIds = judgments.labels
		.filter((label) => label.noul >= LABEL_NOUL_THRESHOLD)
		.map((label) => label.id);

	return {
		spam: false,
		notify: !isQuietCategory(category),
		category,
		categorySource,
		labelIds
	};
}

function failOpen(locked: InboxCategory | null): ClassificationDecision {
	const category = locked ?? DEFAULT_INBOX_CATEGORY;
	return {
		spam: false,
		notify: true,
		category,
		categorySource: locked ? 'user' : null,
		labelIds: []
	};
}

function pickCategory(judgment: CategoryJudgment | null): InboxCategory {
	if (!judgment || judgment.confidence < CATEGORY_CONFIDENCE_THRESHOLD) {
		return DEFAULT_INBOX_CATEGORY;
	}
	return isInboxCategory(judgment.choice) ? judgment.choice : DEFAULT_INBOX_CATEGORY;
}

export function shouldNotify(decision: ClassificationDecision): boolean {
	return decision.notify && !decision.spam;
}

/**
 * After TypeSafe answers, persist even a low-confidence Primary so a backfill
 * pass can finish. Fail-open (no judgments) stays unwritten.
 */
export function persistClassification(
	decision: ClassificationDecision,
	hasJudgments: boolean
): ClassificationDecision {
	if (!hasJudgments || decision.spam || decision.categorySource) {
		return decision;
	}
	return { ...decision, categorySource: 'auto' };
}
