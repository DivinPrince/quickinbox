import assert from 'node:assert/strict';
import { test } from 'node:test';
import { testStore } from './testing/store';
import type { ThreadViewData } from '$lib/types';
import { insertEmail } from './mail-store';
import { GET } from '../../routes/api/mail/[id]/+server';
import { load } from '../../routes/mail/[id]/+page.server';

test('Classic preview and full-page readers return the same thread and reply identity', async () => {
	const s = testStore();
	try {
		s.sqlite.exec("UPDATE addresses SET label = 'Support' WHERE id = 'address-1'");
		const id = await insertEmail(s.db, { userId: s.user.id, direction: 'inbound', from: 'sender@example.test', to: s.user.email,
			subject: 'Reader test', bodyText: 'Original message', domainId: s.from.domain_id, addressId: s.from.id });
		const event = { params: { id }, locals: { user: s.user, uiTheme: 'classic' }, platform: { env: s.env },
			url: new URL(`https://mail.test/api/mail/${id}?view=classic`) };
		const preview = await GET(event as never);
		assert.equal(preview.status, 200);
		const body = await preview.json() as ThreadViewData;
		assert.deepEqual(await load(event as never), body);
		assert.equal(body.focusId, id);
		assert.equal(body.replyFrom, s.user.email);
		assert.equal(body.replyFromName, 'Support');
		assert.equal(body.messages[0].received_label, 'Support');
		assert.equal(body.messages[0].body_text, 'Original message');
		assert.equal(body.messages[0].is_read, true);
		assert.equal((s.sqlite.query('SELECT is_read FROM emails WHERE id = ?').get(id) as { is_read: number }).is_read, 1);
	} finally { s.sqlite.close(); }
});

test('Classic preview requires ownership before reading or marking mail', async () => {
	const s = testStore();
	try {
		const id = await insertEmail(s.db, { userId: s.user.id, direction: 'inbound', from: 'sender@example.test', to: s.user.email, subject: 'Private' });
		const event = { params: { id }, platform: { env: s.env }, url: new URL(`https://mail.test/api/mail/${id}?view=classic`) };
		assert.equal((await GET({ ...event, locals: {} } as never)).status, 401);
		assert.equal((await GET({ ...event, locals: { user: { ...s.user, id: 'user-2' } } } as never)).status, 404);
		assert.equal((s.sqlite.query('SELECT is_read FROM emails WHERE id = ?').get(id) as { is_read: number }).is_read, 0);
	} finally { s.sqlite.close(); }
});

test('Classic previews preserve catch-all reply identities and the default API shape', async () => {
	const s = testStore();
	try {
		const id = await insertEmail(s.db, { userId: s.user.id, direction: 'inbound', from: 'sender@example.test', to: 'alias@example.test', subject: 'Catch-all', domainId: s.from.domain_id });
		const event = { params: { id }, platform: { env: s.env }, locals: { user: s.user }, url: new URL(`https://mail.test/api/mail/${id}?view=classic`) };
		const body = await (await GET(event as never)).json();
		assert.equal(body.replyFrom, 'alias@example.test');
		assert.equal(body.messages[0].received_label, null);
		event.url.search = '';
		const regular = await (await GET(event as never)).json();
		assert.deepEqual(Object.keys(regular).sort(), ['messages', 'subject', 'threadId']);
	} finally { s.sqlite.close(); }
});
