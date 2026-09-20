export const MAX_EML_BYTES = 20 * 1024 * 1024;
export const MAX_ARCHIVE_BYTES = 500 * 1024 * 1024;
export const MAX_IMPORT_MESSAGES = 10_000;
export const IMPORT_FOLDERS = ['inbox', 'archive', 'sent', 'spam', 'trash'] as const;
export type ImportFolder = (typeof IMPORT_FOLDERS)[number];
export const EXPORT_FOLDERS = ['all', ...IMPORT_FOLDERS, 'starred'] as const;
export type ExportFolder = (typeof EXPORT_FOLDERS)[number];

export class MailTransferError extends Error {
	constructor(message: string, readonly status = 400) { super(message); }
}

export function archivePath(value: string): string {
	const path = value.replace(/\\/g, '/');
	if (!path || path.length > 512 || /^[\/]|^[a-z]:/i.test(path) || /[\x00-\x1f\x7f]/.test(path)
		|| path.split('/').some((part) => part === '..' || part === '.')) {
		throw new MailTransferError('The archive contains an invalid file path.');
	}
	return path;
}

export type ImportResult = { status: 'imported' | 'skipped'; id: string; warning?: string };
