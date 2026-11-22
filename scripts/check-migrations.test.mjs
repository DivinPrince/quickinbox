import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

const script = fileURLToPath(new URL('./check-migrations.mjs', import.meta.url));

// Never let a caller's GIT_DIR or GIT_INDEX_FILE (say, from a git hook) point
// these throwaway repos at the real one.
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));

function git(cwd, ...args) {
	execFileSync('git', args, { cwd, env, stdio: 'ignore' });
}

/** A repo whose `main` has two shipped migrations, checked out on a feature branch. */
function repo() {
	const cwd = mkdtempSync(join(tmpdir(), 'quickinbox-migrations-'));
	git(cwd, 'init', '-q', '-b', 'main');
	git(cwd, 'config', 'user.name', 'Migrations Test');
	git(cwd, 'config', 'user.email', 'migrations@example.com');
	git(cwd, 'config', 'commit.gpgsign', 'false');
	mkdirSync(join(cwd, 'migrations'));
	writeFileSync(join(cwd, 'migrations', '0001_init.sql'), 'CREATE TABLE users (id TEXT PRIMARY KEY);\n');
	writeFileSync(join(cwd, 'migrations', '0002_names.sql'), 'ALTER TABLE users ADD COLUMN name TEXT;\n');
	git(cwd, 'add', '.');
	git(cwd, 'commit', '-q', '-m', 'shipped');
	git(cwd, 'checkout', '-q', '-b', 'feature');

	return {
		cwd,
		write(name, sql = 'SELECT 1;\n') {
			mkdirSync(join(cwd, 'migrations', name, '..'), { recursive: true });
			writeFileSync(join(cwd, 'migrations', name), sql);
		},
		remove(name) {
			unlinkSync(join(cwd, 'migrations', name));
		},
		commit() {
			git(cwd, 'add', '-A');
			git(cwd, 'commit', '-q', '-m', 'change');
		},
		run(...args) {
			const argv = args.length ? args : ['main'];
			return spawnSync(process.execPath, [script, ...(args[0] === null ? [] : argv)], { cwd, env, encoding: 'utf8' });
		},
		cleanup() {
			rmSync(cwd, { recursive: true, force: true });
		}
	};
}

function check(setup, expectStatus, expectOutput) {
	const r = repo();
	try {
		setup(r);
		const result = r.run();
		assert.equal(result.status, expectStatus, result.stderr || result.stdout);
		if (expectOutput) assert.match(expectStatus === 0 ? result.stdout : result.stderr, expectOutput);
	} finally {
		r.cleanup();
	}
}

describe('migrations check', () => {
	test('passes when nothing changed', () => {
		check(() => {}, 0, /append-only/);
	});

	test('passes a new migration numbered after the last one', () => {
		check((r) => {
			r.write('0003_labels.sql');
			r.commit();
		}, 0);
	});

	test('fails when a shipped migration is edited', () => {
		check((r) => {
			r.write('0001_init.sql', 'CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT);\n');
			r.commit();
		}, 1, /0001_init\.sql was modified/);
	});

	test('fails when a shipped migration is deleted', () => {
		check((r) => {
			r.remove('0002_names.sql');
			r.commit();
		}, 1, /0002_names\.sql was deleted/);
	});

	test('fails when a shipped migration is renamed', () => {
		check((r) => {
			r.remove('0002_names.sql');
			r.write('0002_display_names.sql', 'ALTER TABLE users ADD COLUMN name TEXT;\n');
			r.commit();
		}, 1, /was renamed/);
	});

	test('fails when a new migration reuses a shipped number', () => {
		check((r) => {
			r.write('0002_other.sql');
			r.commit();
		}, 1, /reuses number 0002/);
	});

	test('passes a new migration that takes a free lower number, as parallel branches do', () => {
		check((r) => {
			r.write('0000_reserved_earlier.sql');
			r.commit();
		}, 0);
	});

	test('counts an uncommitted edit to a shipped migration', () => {
		check((r) => {
			r.write('0001_init.sql', 'CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT);\n');
		}, 1, /0001_init\.sql was modified/);
	});

	test('accepts the hyphenated names wrangler generates', () => {
		check((r) => {
			r.write('0003_add-users.sql');
			r.commit();
		}, 0);
	});

	test('fails on a badly named migration', () => {
		check((r) => {
			r.write('3_Labels.sql');
			r.commit();
		}, 1, /and be named NNNN_description\.sql/);
	});

	test('fails when the base it was given cannot be found', () => {
		const r = repo();
		try {
			const result = r.run('no-such-ref');
			assert.equal(result.status, 1, result.stdout);
			assert.match(result.stderr, /Could not find a merge base with "no-such-ref"/);
		} finally {
			r.cleanup();
		}
	});

	test('leaves a number clash that already shipped alone', () => {
		const r = repo();
		try {
			r.write('0002_also_shipped.sql');
			r.commit();
			execFileSync('git', ['checkout', '-q', '-B', 'main'], { cwd: r.cwd, env, stdio: 'ignore' });
			execFileSync('git', ['checkout', '-q', '-b', 'next'], { cwd: r.cwd, env, stdio: 'ignore' });
			r.write('0003_next.sql');
			r.commit();
			const result = r.run();
			assert.equal(result.status, 0, result.stderr);
		} finally {
			r.cleanup();
		}
	});

	test('counts an untracked new migration that reuses a number', () => {
		check((r) => {
			r.write('0001_untracked.sql');
		}, 1, /0001_untracked\.sql reuses number 0001/);
	});

	for (const [label, name] of [
		['a non-ASCII name', '0003_café.sql'],
		['a trailing space', '0003_ok.sql '],
		['a subdirectory', 'sub/0003_nested.sql']
	]) {
		test(`fails a new migration with ${label}`, () => {
			for (const commit of [true, false]) {
				check((r) => {
					r.write(name);
					if (commit) r.commit();
				}, 1, /must sit directly in migrations\/ and be named/);
			}
		});
	}

	test('counts a git-ignored migration as taking its number', () => {
		check((r) => {
			writeFileSync(join(r.cwd, '.gitignore'), 'migrations/0003_local.sql\n');
			r.write('0003_local.sql');
			r.write('0003_new.sql');
			r.commit();
		}, 1, /0003_new\.sql reuses number 0003 from migrations\/0003_local\.sql/);
	});

	test('fails when given an empty base', () => {
		const r = repo();
		try {
			const result = r.run('');
			assert.equal(result.status, 1, result.stdout);
			assert.match(result.stderr, /Could not find a merge base with ""/);
		} finally {
			r.cleanup();
		}
	});

	test('says append-only was not checked when there is no base', () => {
		const r = repo();
		try {
			const result = r.run(null);
			assert.equal(result.status, 0, result.stderr);
			assert.match(result.stdout, /append-only NOT checked/);
		} finally {
			r.cleanup();
		}
	});
});
