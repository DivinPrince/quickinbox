import { BlobReader, ZipReader, type FileEntry } from '@zip.js/zip.js';
import { archivePath, MAX_ARCHIVE_BYTES, MAX_EML_BYTES, MAX_IMPORT_MESSAGES, MailTransferError } from './transfer';

export type ImportFile = { name: string; read: (signal: AbortSignal) => Promise<Uint8Array<ArrayBuffer>> };

/** Random-access ZIP reads keep the archive on disk; only one EML is expanded at a time. */
export async function openImportFiles(files: File[]) {
	const readers: ZipReader<Blob>[] = [];
	const messages: ImportFile[] = [];
	let expandedBytes = 0;
	let entriesSeen = 0;
	const close = async () => { await Promise.all(readers.map((reader) => reader.close())); };
	try {
		if (!files.length) throw new MailTransferError('Choose an EML file or ZIP archive.');
		if (files.reduce((sum, file) => sum + file.size, 0) > MAX_ARCHIVE_BYTES) {
			throw new MailTransferError('Select no more than 500 MB at a time.');
		}
		for (const file of files) {
			if (/\.eml$/i.test(file.name)) {
				add(file.name, file.size, async (signal) => {
					signal.throwIfAborted();
					return new Uint8Array(await file.arrayBuffer());
				});
			} else if (/\.zip$/i.test(file.name)) {
				const reader = new ZipReader(new BlobReader(file), { useWebWorkers: false });
				readers.push(reader);
				for await (const entry of reader.getEntriesGenerator()) {
					if (++entriesSeen > MAX_IMPORT_MESSAGES * 2) throw new MailTransferError('The archive has too many entries. Split it into smaller ZIP files.');
					if (entry.directory || !/\.eml$/i.test(entry.filename) || entry.filename.startsWith('__MACOSX/')) continue;
					add(entry.filename, entry.uncompressedSize, (signal) => readEntry(entry, signal));
				}
			} else {
				throw new MailTransferError('Only .eml and .zip files are supported.');
			}
		}
		if (!messages.length) throw new MailTransferError('No EML messages were found in the selected files.');
		return { messages, close };
	} catch (error) {
		await close();
		throw error;
	}
	function add(name: string, size: number, read: ImportFile['read']) {
		archivePath(name);
		expandedBytes += size;
		if (!Number.isSafeInteger(size) || size < 1 || size > MAX_EML_BYTES) {
			throw new MailTransferError(`“${name}” must be between 1 byte and 20 MB.`);
		}
		if (expandedBytes > MAX_ARCHIVE_BYTES || messages.length >= MAX_IMPORT_MESSAGES) {
			throw new MailTransferError('Import at most 10,000 messages and 500 MB of expanded mail at a time.');
		}
		messages.push({ name, read });
	}
}

async function readEntry(entry: FileEntry, signal: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
	if (entry.encrypted) throw new MailTransferError('Password-protected ZIP files are not supported.');
	const chunks: Uint8Array[] = [];
	let size = 0;
	await entry.getData(new WritableStream<Uint8Array>({
		write(chunk) {
			size += chunk.length;
			if (size > MAX_EML_BYTES || size > entry.uncompressedSize) throw new MailTransferError('Expanded message exceeds its size limit.');
			chunks.push(chunk);
		}
	}), { signal, checkSignature: true, useWebWorkers: false });
	if (size !== entry.uncompressedSize) throw new MailTransferError('The ZIP contains an incomplete message.');
	const bytes = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
	return bytes;
}
