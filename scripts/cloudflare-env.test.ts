import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	applyCloudflareAuthEnv,
	cloudflareAuthFromDotEnv,
	isCloudflareAccountId,
	parseDotEnv,
	setAccountIdInWrangler
} from './cloudflare-env.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const SAMPLE_ID = '0123456789abcdef0123456789abcdef';

describe('Cloudflare account id', () => {
	test('accepts a 32-character hex id and rejects placeholders', () => {
		assert.equal(isCloudflareAccountId(SAMPLE_ID), true);
		assert.equal(isCloudflareAccountId(SAMPLE_ID.toUpperCase()), true);
		assert.equal(isCloudflareAccountId(''), false);
		assert.equal(isCloudflareAccountId('REPLACE_WITH_YOUR_ACCOUNT_ID'), false);
		assert.equal(isCloudflareAccountId('${CLOUDFLARE_ACCOUNT_ID}'), false);
	});
});

describe('dotenv parsing', () => {
	test('reads Cloudflare auth keys and ignores worker secrets', () => {
		const parsed = parseDotEnv(`
# comment
CLOUDFLARE_ACCOUNT_ID=${SAMPLE_ID} # sidebar
export CLOUDFLARE_API_TOKEN="tok_abc"
RESEND_API_KEY=re_not_for_wrangler
`);
		assert.equal(parsed.CLOUDFLARE_ACCOUNT_ID, SAMPLE_ID);
		assert.equal(parsed.CLOUDFLARE_API_TOKEN, 'tok_abc');
		assert.equal(parsed.RESEND_API_KEY, 're_not_for_wrangler');

		const auth = cloudflareAuthFromDotEnv(`CLOUDFLARE_ACCOUNT_ID=${SAMPLE_ID}\nRESEND_API_KEY=re_x`);
		assert.deepEqual(auth, { CLOUDFLARE_ACCOUNT_ID: SAMPLE_ID });
	});

	test('does not overwrite an env var already set by the shell or CI', () => {
		const env = { CLOUDFLARE_ACCOUNT_ID: 'already-set' };
		applyCloudflareAuthEnv(env, [`CLOUDFLARE_ACCOUNT_ID=${SAMPLE_ID}`]);
		assert.equal(env.CLOUDFLARE_ACCOUNT_ID, 'already-set');

		const empty = {};
		applyCloudflareAuthEnv(empty, [`CLOUDFLARE_ACCOUNT_ID=${SAMPLE_ID}`]);
		assert.equal(empty.CLOUDFLARE_ACCOUNT_ID, SAMPLE_ID);
	});
});

describe('wrangler.jsonc account_id', () => {
	test('uncomments the template placeholder without inventing a committed id', () => {
		const template = readFileSync(join(root, 'wrangler.jsonc'), 'utf8');
		assert.match(template, /^\t\/\/ "account_id": ""/m);
		assert.doesNotMatch(template, /^\s*"account_id"\s*:\s*"[0-9a-f]{32}"/m);
		assert.match(template, /mail\.example\.com/);
		assert.doesNotMatch(template, /mail\.yourdomain\.com/);

		const next = setAccountIdInWrangler(template, SAMPLE_ID);
		assert.match(next, new RegExp(`^\\t"account_id": "${SAMPLE_ID}",`, 'm'));
		assert.doesNotMatch(next, /^\t\/\/ "account_id":/m);
	});

	test('replaces an existing account_id value', () => {
		const source = '{\n\t"account_id": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",\n\t"name": "quickmail"\n}\n';
		const next = setAccountIdInWrangler(source, SAMPLE_ID);
		assert.equal(next.includes(SAMPLE_ID), true);
		assert.equal(next.includes('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'), false);
	});
});
