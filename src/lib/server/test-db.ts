/**
 * Test-only: a D1Database backed by bun:sqlite with every migration applied,
 * for code whose correctness lives in its SQL (conditional claims, conflict
 * handling) where a hand-written mock would only echo the assumptions.
 * Covers the subset of D1 the server code uses: prepare/bind/first/all/run
 * and batch.
 */
import { readdirSync, readFileSync } from 'node:fs';
import type { D1Database } from '@cloudflare/workers-types';
// @ts-expect-error bun:sqlite exists under `bun test`; bun's types are not installed.
import { Database } from 'bun:sqlite';

const MIGRATIONS_DIR = new URL('../../../migrations/', import.meta.url);

type SqliteStatement = {
	all(...params: unknown[]): Record<string, unknown>[];
	run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
};
type Sqlite = { query(sql: string): SqliteStatement; exec(sql: string): void };

function returnsRows(sql: string): boolean {
	return /^\s*(SELECT|WITH)\b/i.test(sql) || /\bRETURNING\b/i.test(sql);
}

function execute(sqlite: Sqlite, sql: string, params: unknown[]) {
	const statement = sqlite.query(sql);
	if (returnsRows(sql)) {
		const results = statement.all(...params);
		return { success: true, results, meta: { changes: results.length } };
	}
	const outcome = statement.run(...params);
	return {
		success: true,
		results: [],
		meta: { changes: outcome.changes, last_row_id: Number(outcome.lastInsertRowid) }
	};
}

export function createTestDb(): { db: D1Database; sqlite: Sqlite } {
	const sqlite = new Database(':memory:') as Sqlite;
	sqlite.exec('PRAGMA foreign_keys = ON');
	for (const name of readdirSync(MIGRATIONS_DIR).filter((file) => file.endsWith('.sql')).sort()) {
		sqlite.exec(readFileSync(new URL(name, MIGRATIONS_DIR), 'utf8'));
	}

	const prepare = (sql: string) => {
		let params: unknown[] = [];
		const statement = {
			bind(...args: unknown[]) {
				params = args;
				return statement;
			},
			async first(column?: string) {
				const row = execute(sqlite, sql, params).results[0] ?? null;
				return column && row ? row[column] : row;
			},
			async all() {
				return execute(sqlite, sql, params);
			},
			async run() {
				return execute(sqlite, sql, params);
			},
			execute: () => execute(sqlite, sql, params)
		};
		return statement;
	};

	const db = {
		prepare,
		async batch(statements: { execute(): unknown }[]) {
			sqlite.exec('BEGIN');
			try {
				const results = statements.map((statement) => statement.execute());
				sqlite.exec('COMMIT');
				return results;
			} catch (error) {
				sqlite.exec('ROLLBACK');
				throw error;
			}
		}
	};

	return { db: db as unknown as D1Database, sqlite };
}

/** Insert a user row so foreign keys onto `users` are satisfied. */
export function insertTestUser(sqlite: Sqlite, id = 'user-1'): void {
	sqlite
		.query(`INSERT INTO users (id, email, name, password_hash) VALUES (?, ?, ?, 'x')`)
		.run(id, `${id}@example.com`, id);
}
