/**
 * Telegram ping on inbound mail.
 *
 * Fire-and-forget on purpose: a failed notification must never fail the
 * inbound handler, or the provider would retry a delivery that was already
 * stored. Disabled unless both the bot token and the chat id are configured.
 */
export type TelegramNotificationEnv = {
	TELEGRAM_BOT_TOKEN?: string;
	TELEGRAM_CHAT_ID?: string;
	/** Topic to post into, when the chat is a forum supergroup. */
	TELEGRAM_THREAD_ID?: string;
	APP_URL?: string;
	waitUntil?: (promise: Promise<void>) => void;
};

export type StoredAttachment = {
	filename: string;
	sizeBytes: number;
	contentType: string;
	/** The file itself, so it can be handed to the reader in the chat. */
	bytes?: Uint8Array;
};

export type TelegramNotification = {
	from: string;
	to: string;
	subject: string;
	/** Plain-text body, so the message can be read without opening the app. */
	body?: string | null;
	attachments?: StoredAttachment[];
	/** Opens the conversation directly, rather than the inbox it sits in. */
	threadKey?: string | null;
	/** Mail stored in `unrouted_emails` — no mailbox matched it. */
	unrouted?: boolean;
};

/** Telegram rejects anything past 4096 characters; leave room for the markup. */
const MAX_MESSAGE_LENGTH = 3500;
const MAX_HEADER_LENGTH = 150;
/** Past this the body is worth collapsing so the chat stays scannable. */
const COLLAPSE_BODY_OVER = 280;

function escapeHtml(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function clamp(value: string, limit: number): string {
	const text = value.trim();
	return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

/** Collapse the runs of blank lines that quoted replies and signatures leave. */
function tidyBody(body: string): string {
	return body
		.replace(/\r\n/g, '\n')
		.replace(/[ \t]+$/gm, '')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	const units = ['KB', 'MB', 'GB'];
	let value = bytes / 1024;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit += 1;
	}
	return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/**
 * Built for HTML parse mode. Everything interpolated is escaped — subjects and
 * sender names routinely carry `<`, `>` and `&`, and an unescaped one would
 * make Telegram reject the whole message.
 */
export function buildTelegramMessage(payload: TelegramNotification, appUrl?: string): string {
	const lines = [
		`${payload.unrouted ? '📭' : '📧'} <b>${escapeHtml(clamp(payload.subject, MAX_HEADER_LENGTH))}</b>`,
		`<b>From:</b> ${escapeHtml(clamp(payload.from, MAX_HEADER_LENGTH))}`,
		`<b>To:</b> ${escapeHtml(clamp(payload.to, MAX_HEADER_LENGTH))}`
	];

	if (payload.unrouted) {
		lines.push('<i>No mailbox matched this address.</i>');
	}

	const body = tidyBody(payload.body ?? '');
	if (body) {
		const shown = clamp(body, MAX_MESSAGE_LENGTH);
		// An expandable quote keeps a long message from flooding the chat while
		// still letting it be read in place.
		const expandable = shown.length > COLLAPSE_BODY_OVER ? ' expandable' : '';
		lines.push('', `<blockquote${expandable}>${escapeHtml(shown)}</blockquote>`);
	}

	const attachments = payload.attachments ?? [];
	if (attachments.length > 0) {
		lines.push('');
		for (const file of attachments) {
			lines.push(
				`📎 ${escapeHtml(clamp(file.filename, 80))} · ${formatBytes(file.sizeBytes)}`
			);
		}
	}

	const link = threadLink(appUrl, payload.threadKey);
	if (link) lines.push('', `<a href="${link}">Open the message</a>`);

	return lines.join('\n');
}

/** Deep link to the conversation; falls back to the app when there is no thread. */
export function threadLink(appUrl?: string, threadKey?: string | null): string | null {
	const base = appUrl?.trim().replace(/\/$/, '');
	if (!base) return null;
	return threadKey ? `${base}/inbox?thread=${encodeURIComponent(threadKey)}` : base;
}

/**
 * The same card as `buildTelegramMessage`, but as a rich message: one message
 * carrying the text *and* the files, instead of a card followed by a stream of
 * separate uploads. Media is referenced by `tg://…?id=` links resolved from the
 * `media` array. Rich messages need Bot API 10.1.
 */
export function buildRichMessage(
	payload: TelegramNotification,
	appUrl?: string
): { html: string; media: { id: string; type: 'photo' | 'document' }[] } {
	const parts = [
		`<h3>${escapeHtml(clamp(payload.subject, MAX_HEADER_LENGTH))}</h3>`,
		`<p><b>From:</b> ${escapeHtml(clamp(payload.from, MAX_HEADER_LENGTH))}<br>` +
			`<b>To:</b> ${escapeHtml(clamp(payload.to, MAX_HEADER_LENGTH))}</p>`
	];

	if (payload.unrouted) {
		parts.push('<p><i>No mailbox matched this address.</i></p>');
	}

	const body = tidyBody(payload.body ?? '');
	if (body) {
		const shown = clamp(body, MAX_MESSAGE_LENGTH);
		const expandable = shown.length > COLLAPSE_BODY_OVER ? ' expandable' : '';
		parts.push(
			`<blockquote${expandable}>${escapeHtml(shown).replace(/\n/g, '<br>')}</blockquote>`
		);
	}

	const media: { id: string; type: 'photo' | 'document' }[] = [];
	for (const [index, file] of (payload.attachments ?? []).entries()) {
		if (!file.bytes || file.bytes.byteLength === 0 || file.bytes.byteLength > MAX_UPLOAD_BYTES) {
			continue;
		}

		const id = `att${index}`;
		const asPhoto = isPhoto(file);
		const element = asPhoto
			? `<img src="tg://photo?id=${id}"/>`
			: `<tg-document src="tg://document?id=${id}"></tg-document>`;

		media.push({ id, type: asPhoto ? 'photo' : 'document' });
		parts.push(
			`<figure>${element}<figcaption>${escapeHtml(clamp(file.filename, 80))} · ${formatBytes(file.sizeBytes)}</figcaption></figure>`
		);
	}

	const link = threadLink(appUrl, payload.threadKey);
	if (link) parts.push(`<p><a href="${link}">Open the message</a></p>`);

	return { html: parts.join(''), media };
}

/** Telegram accepts up to 10MB on sendPhoto and 50MB on sendDocument. */
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

function isPhoto(file: StoredAttachment): boolean {
	const type = file.contentType.toLowerCase();
	return (
		type.startsWith('image/') &&
		!type.includes('svg') &&
		(file.bytes?.byteLength ?? 0) <= MAX_PHOTO_BYTES
	);
}

async function call(
	token: string,
	method: string,
	body: FormData | string,
	quiet = false
): Promise<boolean> {
	const init: RequestInit =
		typeof body === 'string'
			? { method: 'POST', headers: { 'content-type': 'application/json' }, body }
			: { method: 'POST', body };

	const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, init);
	if (response.ok) return true;

	if (!quiet) {
		console.error(`Telegram ${method} failed`, response.status, await response.text());
	}
	return false;
}

/**
 * Send the file itself, not just its name — the whole point of the ping is to
 * save opening the app. Images go as photos so they preview in the chat;
 * everything else as a document, which preserves the original bytes.
 */
async function sendAttachment(
	token: string,
	chatId: string,
	threadId: number | null,
	file: StoredAttachment
): Promise<void> {
	if (!file.bytes || file.bytes.byteLength === 0 || file.bytes.byteLength > MAX_UPLOAD_BYTES) {
		return;
	}

	const asPhoto = isPhoto(file);

	const blob = new Blob([file.bytes as BlobPart], { type: file.contentType });
	const caption = `📎 ${file.filename} · ${formatBytes(file.sizeBytes)}`;

	function upload(field: 'photo' | 'document'): FormData {
		const form = new FormData();
		form.set('chat_id', chatId);
		if (threadId !== null) form.set('message_thread_id', String(threadId));
		form.set('caption', caption);
		form.set(field, blob, file.filename);
		return form;
	}

	// Telegram refuses to process some images as photos — ones that are tiny, or
	// oddly proportioned, come back as IMAGE_PROCESS_FAILED. The reader should
	// still get the file, so fall back to sending it as a document.
	if (asPhoto && (await call(token, 'sendPhoto', upload('photo'), true))) return;

	await call(token, 'sendDocument', upload('document'));
}

async function sendRich(
	token: string,
	chatId: string,
	threadId: number | null,
	payload: TelegramNotification,
	appUrl?: string
): Promise<boolean> {
	const { html, media } = buildRichMessage(payload, appUrl);
	const attachments = payload.attachments ?? [];

	const form = new FormData();
	form.set('chat_id', chatId);
	if (threadId !== null) form.set('message_thread_id', String(threadId));

	const richMedia = media.map((item, index) => {
		const file = attachments[index];
		const field = `file${index}`;
		form.set(field, new Blob([file.bytes as BlobPart], { type: file.contentType }), file.filename);
		return { id: item.id, media: { type: item.type, media: `attach://${field}` } };
	});

	form.set(
		'rich_message',
		JSON.stringify({ html, ...(richMedia.length > 0 ? { media: richMedia } : {}) })
	);

	return call(token, 'sendRichMessage', form, true);
}

export function scheduleTelegramNotification(
	env: TelegramNotificationEnv,
	payload: TelegramNotification
): void {
	const token = env.TELEGRAM_BOT_TOKEN?.trim();
	const chatId = env.TELEGRAM_CHAT_ID?.trim();
	if (!token || !chatId) return;

	// A forum supergroup drops anything without a topic into General, which is
	// rarely where the mail is meant to land.
	const parsedThread = Number(env.TELEGRAM_THREAD_ID?.trim());
	const threadId = Number.isFinite(parsedThread) && parsedThread > 0 ? parsedThread : null;

	const delivery = (async () => {
		// One message carrying the text and the files beats a card followed by a
		// stream of uploads. Rich messages need Bot API 10.1; where that is not
		// available the call fails and the older path still delivers everything.
		if (await sendRich(token, chatId, threadId, payload, env.APP_URL)) return;

		await call(
			token,
			'sendMessage',
			JSON.stringify({
				chat_id: chatId,
				...(threadId !== null ? { message_thread_id: threadId } : {}),
				text: buildTelegramMessage(payload, env.APP_URL),
				parse_mode: 'HTML',
				link_preview_options: { is_disabled: true }
			})
		);

		// Sequential so the files arrive in the order the message listed them.
		for (const file of payload.attachments ?? []) {
			await sendAttachment(token, chatId, threadId, file);
		}
	})().catch((error) => {
		console.error('Telegram notification error', error);
	});

	env.waitUntil?.(delivery);
}
