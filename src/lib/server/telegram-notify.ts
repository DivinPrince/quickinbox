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
	APP_URL?: string;
	waitUntil?: (promise: Promise<void>) => void;
};

export type TelegramNotification = {
	from: string;
	to: string;
	subject: string;
	attachments?: number;
	/** Mail stored in `unrouted_emails` — no mailbox matched it. */
	unrouted?: boolean;
};

const MAX_FIELD_LENGTH = 200;

function clamp(value: string, limit = MAX_FIELD_LENGTH): string {
	const collapsed = value.replace(/\s+/g, ' ').trim();
	return collapsed.length > limit ? `${collapsed.slice(0, limit - 1)}…` : collapsed;
}

/** Plain text, not Markdown — subjects routinely contain unescaped `*` and `_`. */
export function buildTelegramText(payload: TelegramNotification, appUrl?: string): string {
	const lines = [
		payload.unrouted ? '📭 Unrouted mail' : '📧 New mail',
		`From: ${clamp(payload.from)}`,
		`To: ${clamp(payload.to)}`,
		`Subject: ${clamp(payload.subject)}`
	];

	if (payload.attachments) {
		lines.push(`📎 Attachments: ${payload.attachments}`);
	}

	const url = appUrl?.trim();
	if (url) lines.push(url);

	return lines.join('\n');
}

export function scheduleTelegramNotification(
	env: TelegramNotificationEnv,
	payload: TelegramNotification
): void {
	const token = env.TELEGRAM_BOT_TOKEN?.trim();
	const chatId = env.TELEGRAM_CHAT_ID?.trim();
	if (!token || !chatId) return;

	const delivery = fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			chat_id: chatId,
			text: buildTelegramText(payload, env.APP_URL),
			disable_web_page_preview: true
		})
	})
		.then(async (response) => {
			if (!response.ok) {
				console.error('Telegram notification failed', response.status, await response.text());
			}
		})
		.catch((error) => {
			console.error('Telegram notification error', error);
		});

	env.waitUntil?.(delivery);
}
