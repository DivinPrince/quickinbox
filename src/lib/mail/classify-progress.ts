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
