#!/usr/bin/env node
/**
 * Refuse changes to migrations that have already shipped.
 *
 * D1 records applied migrations by filename. Editing, renaming or deleting one
 * that is already on main changes what a new install gets but never reaches an
 * existing one, so their schemas drift apart — and every fork that syncs from
 * main inherits the drift. New migrations are fine; old ones are history.
 *
 * Checks the working tree against the merge base with base-ref, so uncommitted
 * edits count too. A new migration may not reuse a number that is already taken
 * (shipped history is left alone); otherwise any free number is fine, because
 * parallel branches reserve numbers and land out of order.
 *
 * A shipped migration that truly has to change (one that never applied anywhere,
 * say) is a maintainer's call: merge with this check red and say why in the PR.
 *
 * Usage: node scripts/check-migrations.mjs [base-ref]   (default: origin/main)
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'migrations';
const NAME = /^(\d{4})_[a-z0-9_-]+\.sql$/;

function git(...args) {
	return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

/** NUL-separated git output, untouched: no quoting of odd names, no trimming. */
function gitList(command, ...args) {
	return execFileSync('git', ['-C', root, command, '-z', ...args], { encoding: 'utf8' })
		.split('\0')
		.filter(Boolean);
}

const root = git('rev-parse', '--show-toplevel');
const failures = [];

// An explicit argument, even an empty one, must resolve; only the default may fall back.
const explicitBase = process.argv.length > 2;
const baseRef = explicitBase ? process.argv[2] : 'origin/main';
let base = '';
try {
	base = git('merge-base', 'HEAD', baseRef);
} catch {
	// CI names its base explicitly; if that commit is missing the check did not run.
	if (explicitBase) {
		console.error(`✗ Could not find a merge base with "${baseRef}" — fetch full history (fetch-depth: 0).`);
		process.exit(1);
	}
	console.warn('Could not find a merge base with origin/main; checking names and numbers only.');
}

// Name-status pairs (renames carry two paths), paths relative to the repo root.
const changes = [];
if (base) {
	const tokens = gitList('diff', '--name-status', '--find-renames', base, '--', DIR);
	for (let i = 0; i < tokens.length; ) {
		const status = tokens[i++];
		const count = /^[RC]/.test(status) ? 2 : 1;
		changes.push([status, ...tokens.slice(i, i + count)]);
		i += count;
	}
}
const present = gitList('ls-files', '--cached', '--others', '--exclude-standard', '--', DIR).filter((path) =>
	existsSync(join(root, path))
);
const untracked = gitList('ls-files', '--others', '--exclude-standard', '--', DIR);
// New means added since the base, committed or not; without a base, every file is.
const added = base
	? [...changes.filter(([status]) => status === 'A').map(([, path]) => path), ...untracked]
	: present;
const relative = (path) => path.slice(DIR.length + 1);

// 1. New migrations sit directly in migrations/, are named NNNN_description.sql,
//    and take a number nobody else has.
// Every file on disk counts as an owner, ignored or not: wrangler applies them all.
const owners = new Map();
for (const file of readdirSync(join(root, DIR))) {
	const match = NAME.exec(file);
	if (match) owners.set(match[1], [...(owners.get(match[1]) ?? []), file]);
}
for (const file of [...new Set(added.map(relative))].sort()) {
	if (file.startsWith('.')) continue;
	const match = NAME.exec(file);
	if (!match) {
		failures.push(
			`${DIR}/${file} must sit directly in ${DIR}/ and be named NNNN_description.sql (lowercase letters, digits, _ or -)`
		);
		continue;
	}
	const others = owners.get(match[1]).filter((other) => other !== file);
	if (others.length > 0) {
		failures.push(`${DIR}/${file} reuses number ${match[1]} from ${others.map((o) => `${DIR}/${o}`).join(', ')}`);
	}
}

// 2. Against the base, migrations may only be added.
for (const [status, ...paths] of changes) {
	if (status === 'A') continue;
	failures.push(
		`${paths.join(' -> ')} was ${describe(status)} — a shipped migration never changes; add a new one instead`
	);
}

function describe(status) {
	if (status.startsWith('M')) return 'modified';
	if (status.startsWith('D')) return 'deleted';
	if (status.startsWith('R')) return 'renamed';
	if (status.startsWith('T')) return 'changed type';
	return `changed (${status})`;
}

if (failures.length > 0) {
	console.error(`\n✗ Migrations check failed — ${failures.length} problem(s):\n`);
	for (const failure of failures) console.error(`  • ${failure}`);
	console.error('');
	process.exit(1);
}

console.log(
	base
		? `✓ Migrations are append-only — ${present.length} file(s) checked.`
		: `✓ Names and numbers OK — append-only NOT checked (no base) — ${present.length} file(s).`
);
