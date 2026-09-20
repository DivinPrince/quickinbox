import assert from 'node:assert/strict';
import { test } from 'node:test';
import PostalMime from 'postal-mime';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { testStore } from './testing/store';
import { importMessage, parseImportOptions, readImportBody, type ImportOptions } from './mail-import';
import { exportScope, exportZip, prepareExport, validateExportPart } from './mail-transfer-export';
import { deleteEmailsPermanently, insertEmail } from './mail-store';
import { insertAttachments } from './attachments';
import { createLabel } from './labels';
import { mailArchive } from './mail-export';
import { openImportFiles } from '../mail/import-archive';
import { MAX_EML_BYTES } from '../mail/transfer';
import { POST as importRoute } from '../../routes/api/settings/mail-import/+server';
import { GET as exportRoute } from '../../routes/api/settings/mail-export/+server';

const source = [
	'From: Alice <alice@example.test>', 'To: me@example.test', 'Cc: cc@example.test', 'Bcc: private@example.test',
	'Subject: =?UTF-8?B?SGVsbG8g8J+Riw==?=', 'Date: Thu, 15 Jan 2026 13:45:00 -0600',
	'Message-ID: <original@example.test>', 'Reply-To: replies@example.test', 'MIME-Version: 1.0',
	'Content-Type: multipart/mixed; boundary="original"', '', '--original',
	'Content-Type: text/html; charset=utf-8', '', '<p>Hello <img src="cid:picture"></p>',
	'--original', 'Content-Type: image/png', 'Content-Disposition: inline; filename="picture.png"',
	'Content-ID: <picture>', 'Content-Transfer-Encoding: base64', '', btoa('image bytes'), '--original--', ''
].join('\r\n');
const raw = new TextEncoder().encode(source);
const options: ImportOptions = { addressId: 'address-1', folder: 'archive', labelId: null, path: 'original.eml', preserveFolders: false };

async function download(s: ReturnType<typeof testStore>, userId = s.user.id, params = new URLSearchParams()) {
	const scope = await exportScope(s.db, userId, params);
	const parts = await prepareExport(s.db, scope);
	assert.equal(parts.length, 1);
	const chunks: Uint8Array[] = [];
	for await (const chunk of exportZip(s.db, s.bucket, scope, parts[0])) chunks.push(chunk);
	const bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
	let offset = 0;
	for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
	return { bytes, files: unzipSync(bytes) };
}

test('EML import preserves original date, recipients, HTML, inline attachment and lossless export', async () => {
	const s = testStore();
	const result = await importMessage(s.db, s.bucket, s.user.id, raw, options);
	assert.equal(result.status, 'imported');
	const row = s.sqlite.query('SELECT * FROM emails WHERE id = ?').get(result.id) as Record<string, unknown>;
	assert.equal(row.created_at, '2026-01-15 19:45:00');
	assert.equal(row.subject, 'Hello 👋');
	assert.equal(row.cc_addr, 'cc@example.test');
	assert.equal(row.bcc_addr, 'private@example.test');
	assert.equal(row.archived_at, row.created_at);
	assert.equal(row.is_read, 1);
	assert.equal(row.category_source, 'user');
	const attachment = s.sqlite.query('SELECT * FROM email_attachments WHERE email_id = ?').get(result.id) as Record<string, unknown>;
	assert.equal(attachment.content_id, 'picture');
	assert.equal(attachment.content_disposition, 'inline');
	assert.equal(new TextDecoder().decode(s.objects.get(attachment.storage_key as string)), 'image bytes');
	const exported = await download(s);
	const name = Object.keys(exported.files).find((key) => key.endsWith('.eml'))!;
	assert.ok(name.startsWith('Archive/'));
	assert.equal(new TextDecoder().decode(exported.files[name]), source);
	assert.equal(JSON.parse(new TextDecoder().decode(exported.files['export-report.json'])).complete, true);
	const again = await importMessage(s.db, s.bucket, s.user.id, new Uint8Array(exported.files[name]), options);
	assert.equal(again.status, 'skipped');
	const lines = [];
	for await (const line of mailArchive(s.db, s.bucket)) lines.push(JSON.parse(line));
	assert.equal(atob(lines.find((line) => line.type === 'emails').data.raw_message_base64), source);
	await deleteEmailsPermanently(s.db, s.bucket, s.user.id, [result.id]);
	assert.equal(s.objects.size, 0);
});

test('duplicate imports are race-safe and do not change archived or snoozed conversations', async () => {
	const s = testStore();
	const parent = await insertEmail(s.db, { userId: s.user.id, direction: 'inbound', from: 'alice@example.test', to: s.user.email, subject: 'Hello', messageId: 'parent@example.test', domainId: s.from.domain_id });
	s.sqlite.query("UPDATE emails SET archived_at = '2026-01-01', snoozed_until = '2099-01-01' WHERE id = ?").run(parent);
	const reply = new TextEncoder().encode(source.replace('Message-ID:', 'In-Reply-To: <parent@example.test>\r\nMessage-ID:'));
	const results = await Promise.all([importMessage(s.db, s.bucket, s.user.id, reply, options), importMessage(s.db, s.bucket, s.user.id, reply, options)]);
	assert.deepEqual(results.map((result) => result.status).sort(), ['imported', 'skipped']);
	assert.equal(s.objects.size, 2);
	const row = s.sqlite.query('SELECT archived_at, snoozed_until FROM emails WHERE id = ?').get(parent);
	assert.deepEqual(row, { archived_at: '2026-01-01', snoozed_until: '2099-01-01' });
});

test('failed attachment or database writes leave no partial message and allow retry', async () => {
	for (const fault of ['r2', 'db']) {
		const s = testStore();
		if (fault === 'r2') s.faults.put = (key) => { if (!key.endsWith('original.eml')) throw new Error('R2 unavailable'); };
		else s.faults.sql = (sql) => { if (sql.startsWith('INSERT INTO email_attachments')) throw new Error('DB unavailable'); };
		await assert.rejects(importMessage(s.db, s.bucket, s.user.id, raw, options));
		assert.equal((s.sqlite.query('SELECT COUNT(*) AS n FROM emails').get() as { n: number }).n, 0);
		assert.equal(s.objects.size, 0);
		s.faults.put = undefined; s.faults.sql = undefined;
		assert.equal((await importMessage(s.db, s.bucket, s.user.id, raw, options)).status, 'imported');
	}
});

test('imports enforce address/label ownership and scope duplicate detection to the account', async () => {
	const s = testStore();
	await assert.rejects(importMessage(s.db, s.bucket, 'user-2', raw, options), /address not found/);
	const label = await createLabel(s.db, 'user-2', { name: 'Private' });
	await assert.rejects(importMessage(s.db, s.bucket, s.user.id, raw, { ...options, labelId: label.id }), /label not found/);
	await importMessage(s.db, s.bucket, s.user.id, raw, options);
	s.sqlite.exec("INSERT INTO addresses (id, user_id, domain_id, address) VALUES ('address-2', 'user-2', 'domain-1', 'other@example.test')");
	assert.equal((await importMessage(s.db, s.bucket, 'user-2', raw, { ...options, addressId: 'address-2' })).status, 'imported');
	const exported = await download(s, 'user-2');
	assert.equal(Object.keys(exported.files).filter((key) => key.endsWith('.eml')).length, 1);
	await assert.rejects(exportScope(s.db, 'user-2', new URLSearchParams({ address: 'address-1' })), /Address not found/);
});

test('ZIP folder paths reuse labels and nest below an optional destination label', async () => {
	const s = testStore();
	const label = await createLabel(s.db, s.user.id, { name: 'Imported' });
	for (let i = 0; i < 2; i++) await importMessage(s.db, s.bucket, s.user.id, new TextEncoder().encode(source.replace('original@example.test', `message-${i}@example.test`)),
		{ ...options, preserveFolders: true, labelId: label.id, path: `Projects/2025/message-${i}.eml` });
	assert.equal((s.sqlite.query("SELECT COUNT(*) AS n FROM labels WHERE name = 'Imported/Projects/2025'").get() as { n: number }).n, 1);
	assert.equal((s.sqlite.query('SELECT COUNT(*) AS n FROM email_labels').get() as { n: number }).n, 2);
	await assert.rejects(importMessage(s.db, s.bucket, s.user.id, raw, { ...options, preserveFolders: true, path: '../escape.eml' }), /invalid file path/);
});

test('native stored mail exports MIME that parses back with Unicode, alternatives and attachments', async () => {
	const s = testStore();
	const id = await insertEmail(s.db, { userId: s.user.id, direction: 'outbound', from: s.user.email,
		fromName: 'Élodie 👋', to: 'alice@example.test', cc: 'copy@example.test', bcc: 'hidden@example.test',
		subject: 'Réunion 日本語', bodyText: 'Plain café', bodyHtml: '<p>HTML café<img src="cid:picture"></p>', messageId: 'native@example.test', status: 'sent' });
	await insertAttachments(s.db, s.bucket, id, [{ filename: '日本語.png', type: 'image/png', content: btoa('bytes'), disposition: 'inline', contentId: 'picture' }]);
	const { files, bytes } = await download(s, s.user.id, new URLSearchParams({ folder: 'sent' }));
	const mime = files[Object.keys(files).find((key) => key.endsWith('.eml'))!];
	const parsed = await PostalMime.parse(mime);
	assert.equal(parsed.subject, 'Réunion 日本語');
	assert.equal(parsed.from?.name, 'Élodie 👋');
	assert.equal(parsed.text?.trim(), 'Plain café');
	assert.equal(parsed.attachments[0].filename, '日本語.png');
	assert.equal(parsed.attachments[0].contentId, '<picture>');
	assert.equal(parsed.bcc?.[0].address, 'hidden@example.test');
	const archive = await openImportFiles([new File([bytes], 'export.zip')]);
	assert.equal(archive.messages.length, 1);
	assert.deepEqual(await archive.messages[0].read(new AbortController().signal), mime);
	await archive.close();
});

test('date filters include both UTC endpoints, label filters are scoped, and drafts are excluded', async () => {
	const s = testStore();
	const label = await createLabel(s.db, s.user.id, { name: 'Work' });
	const imported = await importMessage(s.db, s.bucket, s.user.id, raw, { ...options, labelId: label.id });
	await insertEmail(s.db, { userId: s.user.id, direction: 'outbound', from: s.user.email, to: 'a@example.test', subject: 'Draft', status: 'draft' });
	const params = new URLSearchParams({ from: '2026-01-15', to: '2026-01-15', label: label.id });
	const scope = await exportScope(s.db, s.user.id, params);
	assert.equal((await prepareExport(s.db, scope))[0].count, 1);
	s.sqlite.query("UPDATE emails SET created_at = '2026-01-16 00:00:00' WHERE id = ?").run(imported.id);
	assert.equal((await prepareExport(s.db, scope)).length, 0);
	assert.equal((await prepareExport(s.db, await exportScope(s.db, s.user.id, new URLSearchParams())))[0].count, 1);
	const invalidFilters: Record<string, string>[] = [{ from: '2026-02-30' }, { from: '2026-02-01', to: '2026-01-01' }, { folder: 'drafts' }];
	for (const invalid of invalidFilters) {
		await assert.rejects(exportScope(s.db, s.user.id, new URLSearchParams(invalid)));
	}
});

test('large exports split into bounded ZIP parts and cannot bypass size limits', async () => {
	const s = testStore();
	const insert = s.sqlite.query("INSERT INTO emails (id, user_id, direction, from_addr, to_addr, subject) VALUES (?, 'user-1', 'inbound', 'a@example.test', 'me@example.test', 'test')");
	s.sqlite.transaction(() => { for (let i = 0; i < 1001; i++) insert.run(`mail-${i}`); })();
	const scope = await exportScope(s.db, s.user.id, new URLSearchParams());
	const parts = await prepareExport(s.db, scope);
	assert.deepEqual(parts.map((part) => part.count), [1000, 1]);
	assert.equal(parts[1].after, parts[0].through);
	await assert.rejects(validateExportPart(s.db, scope, new URLSearchParams({ after: '0', through: '1001' })), /split/);
	s.sqlite.exec('UPDATE emails SET raw_message_bytes = 20971520');
	assert.ok((await prepareExport(s.db, scope)).every((part) => part.count <= 20));
});

test('missing attachments are explicitly reported without creating incomplete EML files', async () => {
	const s = testStore();
	await importMessage(s.db, s.bucket, s.user.id, raw, options);
	s.objects.clear();
	const { files } = await download(s);
	assert.equal(Object.keys(files).filter((key) => key.endsWith('.eml')).length, 0);
	const report = JSON.parse(new TextDecoder().decode(files['export-report.json']));
	assert.equal(report.complete, false);
	assert.equal(report.failures.length, 1);
	assert.match(report.failures[0].error, /missing/);
});

test('archive import checks ZIP CRC, rejects unsafe paths, malformed files and oversized requests', async () => {
	const zip = zipSync({ 'Projects/2025/one.eml': raw, 'readme.txt': strToU8('ignored') }, { level: 0 });
	const archive = await openImportFiles([new File([zip], 'mail.zip')]);
	assert.equal(archive.messages[0].name, 'Projects/2025/one.eml');
	assert.deepEqual(await archive.messages[0].read(new AbortController().signal), raw);
	await archive.close();
	const corrupt = new Uint8Array(zip);
	const contentOffset = 30 + new DataView(zip.buffer).getUint16(26, true) + new DataView(zip.buffer).getUint16(28, true);
	corrupt[contentOffset + 2] ^= 1;
	const bad = await openImportFiles([new File([corrupt], 'bad.zip')]);
	await assert.rejects(bad.messages[0].read(new AbortController().signal));
	await bad.close();
	await assert.rejects(openImportFiles([new File([zipSync({ '../evil.eml': raw })], 'unsafe.zip')]), /invalid file path|Unsafe filename/);
	await assert.rejects(openImportFiles([new File(['invalid'], 'broken.zip')]));
	await assert.rejects(openImportFiles([new File(['not mail'], 'file.pst')]), /Only/);
	assert.throws(() => parseImportOptions(new URLSearchParams({ address: 'address-1', folder: 'drafts' })));
	await assert.rejects(readImportBody(new Request('https://mail.test', { method: 'POST', headers: { 'Content-Length': String(MAX_EML_BYTES + 1) }, body: 'x' })), /20 MB/);
	const s = testStore();
	await assert.rejects(importMessage(s.db, s.bucket, s.user.id, new TextEncoder().encode('not an email'), options), /From header/);
});

test('transfer APIs reject anonymous, external-token and cross-origin requests before accessing mail', async () => {
	assert.equal((await importRoute({ locals: {} } as never)).status, 401);
	assert.equal((await exportRoute({ locals: {} } as never)).status, 401);
	const s = testStore();
	const locals = { user: s.user, authMethod: 'api_token' };
	assert.equal((await importRoute({ locals } as never)).status, 403);
	assert.equal((await exportRoute({ locals } as never)).status, 403);
	assert.equal((await importRoute({ locals: { ...locals, authMethod: 'session' }, url: new URL('https://mail.test'), request: new Request('https://mail.test', { method: 'POST', headers: { origin: 'https://evil.test' } }) } as never)).status, 403);
	const params = new URLSearchParams({ address: 'address-1', folder: 'inbox' });
	const url = new URL(`https://mail.test/api/settings/mail-import?${params}`);
	const response = await importRoute({ locals: { ...locals, authMethod: 'session' }, platform: { env: s.env }, url,
		request: new Request(url, { method: 'POST', body: raw, headers: { origin: url.origin } }) } as never);
	assert.equal(response.status, 200);
	assert.equal((await response.json()).status, 'imported');
});
