import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	PRIVATE_WRANGLER_CONFIG,
	TEMPLATE_WRANGLER_CONFIG,
	resolveWranglerConfig,
	wranglerArgsWithConfig
} from './wrangler-config.mjs';

describe('resolveWranglerConfig', () => {
	test('falls back to the template when no private deploy config exists', () => {
		const root = mkdtempSync(join(tmpdir(), 'qm-wrangler-'));
		try {
			const resolved = resolveWranglerConfig(root);
			assert.equal(resolved.file, TEMPLATE_WRANGLER_CONFIG);
			assert.equal(resolved.private, false);
			assert.equal(resolved.path, join(root, TEMPLATE_WRANGLER_CONFIG));
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test('prefers wrangler.deploy.jsonc when present', () => {
		const root = mkdtempSync(join(tmpdir(), 'qm-wrangler-'));
		try {
			writeFileSync(join(root, PRIVATE_WRANGLER_CONFIG), '{ "name": "mail" }\n');
			const resolved = resolveWranglerConfig(root);
			assert.equal(resolved.file, PRIVATE_WRANGLER_CONFIG);
			assert.equal(resolved.private, true);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe('wranglerArgsWithConfig', () => {
	test('injects --config for the private file', () => {
		const root = mkdtempSync(join(tmpdir(), 'qm-wrangler-'));
		try {
			writeFileSync(join(root, PRIVATE_WRANGLER_CONFIG), '{ "name": "mail" }\n');
			const { args, config } = wranglerArgsWithConfig(root, ['deploy']);
			assert.equal(config.private, true);
			assert.deepEqual(args, ['--config', PRIVATE_WRANGLER_CONFIG, 'deploy']);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test('leaves an explicit --config alone', () => {
		const root = mkdtempSync(join(tmpdir(), 'qm-wrangler-'));
		try {
			writeFileSync(join(root, PRIVATE_WRANGLER_CONFIG), '{ "name": "mail" }\n');
			const { args } = wranglerArgsWithConfig(root, ['deploy', '--config', 'other.jsonc']);
			assert.deepEqual(args, ['deploy', '--config', 'other.jsonc']);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
