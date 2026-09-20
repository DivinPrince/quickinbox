import assert from 'node:assert/strict';
import { test } from 'node:test';
import { testStore } from './testing/store';
import { saveContact, listContacts, getContact, deleteContact } from './contacts';
import { organizerBody } from './organizer-http';
import { recipientToken } from '$lib/organizer/contact-suggestions';
import { authorizeApiRequest } from './api-access';
const contact = {
	name: 'Alex Example',
	emails: ['Alex@Example.test', 'alex.work@example.test'],
	company: 'Example Co',
	phone: '+1 555 0100',
	notes: 'Met at conference',
	starred: true
};
test('contacts are searchable by name, company, and every address, and isolated by owner', async () => {
	const s = testStore();
	const saved = await saveContact(s.db, s.user.id, contact);
	assert.deepEqual(saved.emails, ['alex@example.test', 'alex.work@example.test']);
	for (const q of ['alex', 'example co', 'alex.work'])
		assert.equal((await listContacts(s.db, s.user.id, q)).total, 1);
	assert.equal((await listContacts(s.db, 'user-2')).total, 0);
	assert.equal(await getContact(s.db, 'user-2', saved.id), null);
	await assert.rejects(deleteContact(s.db, 'user-2', saved.id, 1), { status: 409 });
	assert.equal((await listContacts(s.db, s.user.id, '%')).total, 0);
});
test('contact updates are atomic, reject duplicates, and protect concurrent revisions', async () => {
	const s = testStore();
	const saved = await saveContact(s.db, s.user.id, contact);
	await assert.rejects(
		saveContact(s.db, s.user.id, { name: 'Duplicate', emails: ['alex@example.test'] }),
		{ status: 409 }
	);
	assert.equal((await listContacts(s.db, s.user.id)).total, 1);
	const updated = await saveContact(
		s.db,
		s.user.id,
		{ ...saved, emails: ['changed@example.test'], name: 'Changed' },
		saved.id
	);
	assert.equal(updated.version, 2);
	await assert.rejects(saveContact(s.db, s.user.id, saved, saved.id), { status: 409 });
	assert.equal((await getContact(s.db, s.user.id, saved.id))?.name, 'Changed');
	s.faults.sql = (sql) => {
		if (sql.startsWith('INSERT INTO contact_emails')) throw new Error('storage unavailable');
	};
	await assert.rejects(saveContact(s.db, s.user.id, { ...updated, name: 'Lost' }, saved.id));
	s.faults.sql = undefined;
	assert.deepEqual(await getContact(s.db, s.user.id, saved.id), updated);
	await deleteContact(s.db, s.user.id, saved.id, 2);
	assert.equal((await listContacts(s.db, s.user.id)).total, 0);
});
test('bounded JSON bodies reject cross-origin writes, form posts and oversize streams', async () => {
	const request = (body: string, headers = {}) =>
		new Request('https://mail.example.test/api/contacts', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', ...headers },
			body
		});
	assert.deepEqual(await organizerBody(request('{"name":"Alex"}')), { name: 'Alex' });
	await assert.rejects(organizerBody(request('{}', { Origin: 'https://evil.example' })), {
		status: 403
	});
	await assert.rejects(organizerBody(request('{}', { 'Content-Type': 'text/plain' })), {
		status: 415
	});
	await assert.rejects(organizerBody(request('x'.repeat(100)), 50), { status: 413 });
	await assert.rejects(organizerBody(request('{')), { status: 400 });
});
test('simultaneous contact edits cannot overwrite the winning email list', async () => {
	const s = testStore();
	const saved = await saveContact(s.db, s.user.id, contact);
	const outcomes = await Promise.allSettled(
		['one', 'two'].map((name) =>
			saveContact(s.db, s.user.id, { ...saved, name, emails: [`${name}@example.test`] }, saved.id)
		)
	);
	assert.equal(outcomes.filter((r) => r.status === 'fulfilled').length, 1);
	assert.equal(outcomes.filter((r) => r.status === 'rejected').length, 1);
	const current = (await getContact(s.db, s.user.id, saved.id))!;
	assert.equal(current.version, 2);
	assert.deepEqual(current.emails, [`${current.name}@example.test`]);
});
test('recipient token replacement preserves quoted commas and earlier addresses', () => {
	assert.deepEqual(recipientToken('"Example, Alex" <alex@example.test>, sam'), {
		prefix: '"Example, Alex" <alex@example.test>,',
		query: 'sam'
	});
	assert.deepEqual(recipientToken('alex'), { prefix: '', query: 'alex' });
});
test('existing mail tokens do not gain contacts or calendar privileges', () => {
	for (const pathname of [
		'/api/contacts',
		'/api/calendar',
		'/api/calendar/id',
		'/api/mail/id/invitations'
	]) {
		for (const method of ['GET', 'POST', 'PUT', 'DELETE'])
			assert.equal(
				authorizeApiRequest({
					pathname,
					method,
					authMethod: 'api_token',
					scopes: ['mail:read', 'mail:send']
				}).ok,
				false
			);
	}
});
