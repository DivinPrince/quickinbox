import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import {
	buildTelegramMessage,
	formatBytes,
	scheduleTelegramNotification,
	type TelegramNotification,
	type TelegramNotificationEnv
} from './telegram-notify';

const notification: TelegramNotification = {
	from: 'Sam <sam@other.test>',
	to: 'hello@example.com',
	subject: 'Invoice #42'
};

const realFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = realFetch;
});

describe('buildTelegramMessage', () => {
	test('leads with the subject, then sender and recipient', () => {
		const text = buildTelegramMessage(notification);
		assert.equal(
			text,
			'📧 <b>Invoice #42</b>\n<b>From:</b> Sam &lt;sam@other.test&gt;\n<b>To:</b> hello@example.com'
		);
	});

	test('escapes markup the sender controls', () => {
		// An unescaped angle bracket makes Telegram reject the whole message.
		const text = buildTelegramMessage({
			...notification,
			subject: '<b>Sale</b> & more',
			body: 'a < b & c'
		});
		assert.match(text, /&lt;b&gt;Sale&lt;\/b&gt; &amp; more/);
		assert.match(text, /a &lt; b &amp; c/);
	});

	test('quotes a short body without collapsing it', () => {
		const text = buildTelegramMessage({ ...notification, body: 'Short note.' });
		assert.match(text, /<blockquote>Short note\.<\/blockquote>/);
	});

	test('collapses a long body behind an expandable quote', () => {
		const text = buildTelegramMessage({ ...notification, body: 'x'.repeat(400) });
		assert.match(text, /<blockquote expandable>/);
	});

	test('truncates a body past the message limit', () => {
		const text = buildTelegramMessage({ ...notification, body: 'x'.repeat(9000) });
		assert.ok(text.length < 4096);
		assert.match(text, /…<\/blockquote>/);
	});

	test('tidies the blank runs quoted replies leave', () => {
		const text = buildTelegramMessage({ ...notification, body: 'one\n\n\n\n\ntwo' });
		assert.match(text, /<blockquote>one\n\ntwo<\/blockquote>/);
	});

	test('omits the quote when there is no body', () => {
		assert.doesNotMatch(buildTelegramMessage({ ...notification, body: '   ' }), /blockquote/);
		assert.doesNotMatch(buildTelegramMessage(notification), /blockquote/);
	});

	test('lists each attachment with its size', () => {
		const text = buildTelegramMessage({
			...notification,
			attachments: [
				{ filename: 'shot.jpg', sizeBytes: 485541, contentType: 'image/jpeg' },
				{ filename: 'notes.txt', sizeBytes: 512, contentType: 'text/plain' }
			]
		});
		assert.match(text, /📎 shot\.jpg · 474 KB/);
		assert.match(text, /📎 notes\.txt · 512 B/);
	});

	test('marks unrouted mail and links the app', () => {
		const text = buildTelegramMessage({ ...notification, unrouted: true }, 'https://mail.example.com');
		assert.match(text, /^📭 /);
		assert.match(text, /No mailbox matched this address\./);
		assert.match(text, /<a href="https:\/\/mail\.example\.com">Open the message<\/a>$/);
	});

	test('links straight to the conversation when one is known', () => {
		const text = buildTelegramMessage(
			{ ...notification, threadKey: 'thread-1' },
			'https://mail.example.com/'
		);
		assert.match(text, /href="https:\/\/mail\.example\.com\/inbox\?thread=thread-1"/);
	});

	test('omits the link when no app URL is configured', () => {
		assert.doesNotMatch(buildTelegramMessage({ ...notification, threadKey: 'thread-1' }), /<a href/);
	});

	test('truncates a long subject', () => {
		const text = buildTelegramMessage({ ...notification, subject: 'c'.repeat(300) });
		const subject = text.split('\n')[0];
		assert.ok(subject.includes('…'));
		assert.ok(subject.length < 200);
	});

	test('keeps the complete fallback message within Telegram’s 4096 limit', () => {
		const text = buildTelegramMessage({
			...notification,
			subject: 'S'.repeat(200),
			from: 'F'.repeat(200),
			to: 'T'.repeat(200),
			body: 'B'.repeat(8000),
			attachments: Array.from({ length: 20 }, (_, i) => ({
				filename: `file-${i}.pdf`,
				sizeBytes: 1_000_000,
				contentType: 'application/pdf'
			}))
		});
		assert.ok(text.length <= 4096);
	});
});

describe('formatBytes', () => {
	test('scales the unit and keeps the number short', () => {
		assert.equal(formatBytes(512), '512 B');
		assert.equal(formatBytes(1536), '1.5 KB');
		assert.equal(formatBytes(485541), '474 KB');
		assert.equal(formatBytes(5 * 1024 * 1024), '5.0 MB');
		assert.equal(formatBytes(20 * 1024 * 1024), '20 MB');
	});
});

describe('scheduleTelegramNotification', () => {
	type Call = { method: string; json?: Record<string, unknown>; form?: FormData };

	/** `richOk` decides whether sendRichMessage succeeds, so both paths are testable. */
	function captureFetch(richOk = false) {
		const calls: Call[] = [];
		globalThis.fetch = (async (url: string, init: { body: FormData | string }) => {
			const method = url.split('/').pop()!;
			const call: Call =
				typeof init.body === 'string'
					? { method, json: JSON.parse(init.body) }
					: { method, form: init.body };
			calls.push(call);

			const ok = method !== 'sendRichMessage' || richOk;
			return new Response('{}', { status: ok ? 200 : 400 });
		}) as unknown as typeof fetch;
		return calls;
	}

	function run(env: TelegramNotificationEnv, payload = notification) {
		const pending: Promise<void>[] = [];
		scheduleTelegramNotification({ ...env, waitUntil: (p) => pending.push(p) }, payload);
		return Promise.all(pending);
	}

	const configured = { TELEGRAM_BOT_TOKEN: 'token', TELEGRAM_CHAT_ID: '42' };

	test('does nothing unless both the token and the chat id are set', async () => {
		const calls = captureFetch();
		for (const env of [
			{},
			{ TELEGRAM_BOT_TOKEN: 'token' },
			{ TELEGRAM_CHAT_ID: '42' },
			{ TELEGRAM_BOT_TOKEN: '  ', TELEGRAM_CHAT_ID: '42' }
		] satisfies TelegramNotificationEnv[]) {
			await run(env);
		}
		assert.equal(calls.length, 0);
	});

	test('sends one rich message when the API supports it', async () => {
		const calls = captureFetch(true);
		await run(configured);
		assert.deepEqual(
			calls.map((call) => call.method),
			['sendRichMessage']
		);
	});

	test('rich upload uses the valid file when an earlier attachment cannot be sent', async () => {
		const calls = captureFetch(true);
		await run(configured, {
			...notification,
			attachments: [
				{ filename: 'empty.txt', sizeBytes: 0, contentType: 'text/plain', bytes: new Uint8Array(0) },
				{ filename: 'shot.jpg', sizeBytes: 4, contentType: 'image/jpeg', bytes: new Uint8Array(4) }
			]
		});

		const rich = calls.find((call) => call.method === 'sendRichMessage');
		assert.ok(rich?.form);
		const payload = JSON.parse(String(rich.form.get('rich_message'))) as {
			media: { id: string }[];
		};
		assert.equal(payload.media.length, 1);
		assert.equal(payload.media[0].id, 'att0');
		assert.equal(rich.form.has('file0'), true);
		assert.equal(rich.form.has('file1'), false);
	});

	test('falls back to a card plus uploads when rich messages are unavailable', async () => {
		// Older Bot API versions reject sendRichMessage; everything must still arrive.
		const calls = captureFetch(false);
		await run({ ...configured }, {
			...notification,
			attachments: [
				{ filename: 'shot.jpg', sizeBytes: 4, contentType: 'image/jpeg', bytes: new Uint8Array(4) },
				{ filename: 'a.pdf', sizeBytes: 4, contentType: 'application/pdf', bytes: new Uint8Array(4) }
			]
		});
		assert.deepEqual(
			calls.map((call) => call.method),
			['sendRichMessage', 'sendMessage', 'sendPhoto', 'sendDocument']
		);
	});

	test('sends an image refused as a photo as a document instead', async () => {
		// Telegram answers IMAGE_PROCESS_FAILED for images it will not process.
		const calls: string[] = [];
		globalThis.fetch = (async (url: string) => {
			const method = url.split('/').pop()!;
			calls.push(method);
			const ok = method !== 'sendRichMessage' && method !== 'sendPhoto';
			return new Response('{}', { status: ok ? 200 : 400 });
		}) as unknown as typeof fetch;

		await run(configured, {
			...notification,
			attachments: [
				{ filename: 'odd.png', sizeBytes: 4, contentType: 'image/png', bytes: new Uint8Array(4) }
			]
		});
		assert.deepEqual(calls, ['sendRichMessage', 'sendMessage', 'sendPhoto', 'sendDocument']);
	});

	test('addresses the card and every upload to the same forum topic', async () => {
		const calls = captureFetch(false);
		await run({ ...configured, TELEGRAM_THREAD_ID: '3' }, {
			...notification,
			attachments: [
				{ filename: 'a.pdf', sizeBytes: 4, contentType: 'application/pdf', bytes: new Uint8Array(4) }
			]
		});

		for (const call of calls) {
			const topic = call.json
				? call.json.message_thread_id
				: Number(call.form!.get('message_thread_id'));
			assert.equal(topic, 3);
		}
	});

	test('omits the topic when it is unset or not a positive number', async () => {
		// A forum chat drops an untargeted message into General; a non-forum chat
		// rejects an invalid topic outright. Neither is worth sending.
		const calls = captureFetch(false);
		for (const threadId of [undefined, '', '  ', 'general', '0', '-4', '3.5']) {
			await run({ ...configured, TELEGRAM_THREAD_ID: threadId });
		}

		for (const call of calls) {
			if (call.json) assert.ok(!('message_thread_id' in call.json));
			else assert.equal(call.form!.get('message_thread_id'), null);
		}
	});

	test('swallows a transport error so inbound handling still succeeds', async () => {
		globalThis.fetch = (() => Promise.reject(new Error('network down'))) as unknown as typeof fetch;
		await assert.doesNotReject(run(configured));
	});
});

