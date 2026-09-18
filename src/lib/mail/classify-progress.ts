export type ClassifyCursor = {
	createdAt: string;
	id: string;
};

export type ClassifyStatus = {
	enabled: boolean;
	remaining: number;
};

export type ClassifyStep = ClassifyStatus & {
	applied: boolean;
	subject: string | null;
	cursor: ClassifyCursor | null;
	complete: boolean;
};

export function parseClassifyCursor(value: unknown): ClassifyCursor | null {
	if (!value || typeof value !== 'object') return null;
	const createdAt = 'createdAt' in value ? value.createdAt : undefined;
	const id = 'id' in value ? value.id : undefined;
	if (typeof createdAt !== 'string' || typeof id !== 'string') return null;
	if (!createdAt || !id) return null;
	return { createdAt, id };
}

/** One Worker request; Jev still chunks internally. Large enough for a typical backfill. */
export const CLASSIFY_EXISTING_MAX = 150;

/** How many messages to classify per settings POST. */
export function classifyExistingBatchSize(remaining: number): number {
	if (!Number.isFinite(remaining) || remaining <= 0) return 0;
	return Math.min(CLASSIFY_EXISTING_MAX, Math.floor(remaining));
}
