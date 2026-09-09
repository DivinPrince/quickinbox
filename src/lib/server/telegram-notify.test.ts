import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import {
	buildTelegramText,
	scheduleTelegramNotification,
	type TelegramNotificationEnv
} from './telegram-notify';

const notification = {
	from: 'Sam <sam@other.test>',
	to: 'hello@example.com',
	subject: 'Invoice #42'
};

const realFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = realFetch;
});

describe('buildTelegramText', () => {
	test('lists sender, recipient and subject', () => {
		assert.equal(
			buildTelegramText(notification),
			'📧 New mail\nFrom: Sam <sam@other.test>\nTo: hello@example.com\nSubject: Invoice #42'
		);
	});

	test('marks unrouted mail and appends the app URL', () => {
		const text = buildTelegramText({ ...notification, unrouted: true }, 'https://mail.example.com');
		assert.match(text, /^📭 Unrouted mail\n/);
		assert.match(text, /\nhttps:\/\/mail\.example\.com$/);
	});

	test('counts attachments only when there are any', () => {
		assert.match(buildTelegramText({ ...notification, attachments: 2 }), /📎 Attachments: 2/);
		assert.doesNotMatch(buildTelegramText({ ...notification, attachments: 0 }), /Attachments/);
	});

	test('collapses whitespace and truncates a long subject', () => {
		const text = buildTelegramText({ ...notification, subject: `a\n b${'c'.repeat(300)}` });
		const subject = text.split('\n').find((line) => line.startsWith('Subject: '))!;
		assert.equal(subject.length, 'Subject: '.length + 200);
		assert.ok(subject.endsWith('…'));
	});
});

describe('scheduleTelegramNotification', () => {
	function captureFetch() {
		const calls: { url: string; body: unknown }[] = [];
		globalThis.fetch = (async (url: string, init: { body: string }) => {
			calls.push({ url, body: JSON.parse(init.body) });
			return new Response('{}', { status: 200 });
		}) as unknown as typeof fetch;
		return calls;
	}

	test('does nothing unless both the token and the chat id are set', () => {
		const calls = captureFetch();
		for (const env of [
			{},
			{ TELEGRAM_BOT_TOKEN: 'token' },
			{ TELEGRAM_CHAT_ID: '42' },
			{ TELEGRAM_BOT_TOKEN: '  ', TELEGRAM_CHAT_ID: '42' }
		] satisfies TelegramNotificationEnv[]) {
			scheduleTelegramNotification(env, notification);
		}
		assert.equal(calls.length, 0);
	});

	test('posts to the bot API and hands the promise to waitUntil', async () => {
		const calls = captureFetch();
		const pending: Promise<void>[] = [];
		scheduleTelegramNotification(
			{
				TELEGRAM_BOT_TOKEN: 'token',
				TELEGRAM_CHAT_ID: '42',
				waitUntil: (promise) => pending.push(promise)
			},
			notification
		);

		assert.equal(pending.length, 1);
		await Promise.all(pending);
		assert.equal(calls.length, 1);
		assert.equal(calls[0].url, 'https://api.telegram.org/bottoken/sendMessage');
		assert.equal((calls[0].body as { chat_id: string }).chat_id, '42');
	});

	test('swallows a transport error so inbound handling still succeeds', async () => {
		const pending: Promise<void>[] = [];
		globalThis.fetch = (() => Promise.reject(new Error('network down'))) as unknown as typeof fetch;

		scheduleTelegramNotification(
			{
				TELEGRAM_BOT_TOKEN: 'token',
				TELEGRAM_CHAT_ID: '42',
				waitUntil: (promise) => pending.push(promise)
			},
			notification
		);

		await assert.doesNotReject(Promise.all(pending));
	});
});
