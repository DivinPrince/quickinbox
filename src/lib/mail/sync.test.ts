import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	isMailChangedMessage,
	MAIL_CHANGED_MESSAGE,
	MAILBOX_SYNC_PATH,
	mailboxSyncUrl,
	readMailboxCursor,
	shouldRefreshMailbox,
	waitForAbortable
} from './sync';

test('mailbox sync URLs carry the cursor only after the first snapshot', () => {
	assert.equal(mailboxSyncUrl(null), MAILBOX_SYNC_PATH);
	assert.equal(mailboxSyncUrl('9:41'), `${MAILBOX_SYNC_PATH}?cursor=9%3A41`);
});

test('the first cursor snapshot does not refresh, later changes do', () => {
	assert.equal(shouldRefreshMailbox(null, '0:0'), false);
	assert.equal(shouldRefreshMailbox('1:10', '1:10'), false);
	assert.equal(shouldRefreshMailbox('1:10', '2:11'), true);
});

test('cursor payloads must be non-empty strings', () => {
	assert.equal(readMailboxCursor({ cursor: '2:11' }), '2:11');
	assert.equal(readMailboxCursor({ cursor: '' }), null);
	assert.equal(readMailboxCursor({ cursor: 2 }), null);
	assert.equal(readMailboxCursor(null), null);
});

test('open tabs wake on the push worker mail-changed message', () => {
	assert.equal(isMailChangedMessage({ type: MAIL_CHANGED_MESSAGE }), true);
	assert.equal(isMailChangedMessage({ type: 'push' }), false);
	assert.equal(isMailChangedMessage('mail:changed'), false);
});

test('abortable waits resolve early when the signal fires', async () => {
	const controller = new AbortController();
	const started = Date.now();
	queueMicrotask(() => controller.abort());
	assert.equal(await waitForAbortable(5_000, controller.signal), false);
	assert.ok(Date.now() - started < 1_000);
	assert.equal(await waitForAbortable(1, new AbortController().signal), true);
});
