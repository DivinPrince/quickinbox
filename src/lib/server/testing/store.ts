import { Database } from 'bun:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import type { MailAddress, User } from '$lib/types';

/** Real SQLite migrations/constraints, with in-memory R2 and fault injection. */
export function testStore() {
  const sqlite = new Database(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  const migrations = new URL('../../../../migrations/', import.meta.url);
  for (const file of readdirSync(migrations).filter((name) => name.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(new URL(file, migrations), 'utf8'));
  }
  const faults: { sql?: (sql: string) => void; put?: (key: string) => void } = {};
  class Statement {
    constructor(readonly sql: string, readonly args: (string | number | null)[] = []) {}
    bind(...args: (string | number | null)[]) { return new Statement(this.sql, args); }
    execute() {
      faults.sql?.(this.sql);
      const results = sqlite.query(this.sql).all(...this.args);
      const changes = sqlite.query('SELECT changes() AS n').get() as { n: number };
      return { success: true, results, meta: { changes: changes.n, size_after: 4096 } };
    }
    async all() { return this.execute(); }
    async run() { return this.execute(); }
    async first(column?: string) {
      const row = this.execute().results[0] as Record<string, unknown> | undefined;
      return row ? column ? row[column] : row : null;
    }
  }
  const db = {
    prepare(sql: string) { return new Statement(sql); },
    async batch(statements: Statement[]) { return sqlite.transaction(() => statements.map((statement) => statement.execute()))(); }
  } as unknown as D1Database;
  const objects = new Map<string, Uint8Array>();
  const bucket = {
    async put(key: string, value: string | Uint8Array) {
      faults.put?.(key);
      objects.set(key, typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value));
      return {};
    },
    async get(key: string) {
      const bytes = objects.get(key);
      if (!bytes) return null;
      return { async text() { return new TextDecoder().decode(bytes); },
        async json() { return JSON.parse(new TextDecoder().decode(bytes)); },
        async arrayBuffer() { return new Uint8Array(bytes).buffer; } };
    },
    async delete(key: string | string[]) { for (const item of Array.isArray(key) ? key : [key]) objects.delete(item); },
    async list() { return { objects: [], truncated: false }; }
  } as unknown as R2Bucket;
  const user: User = { id: 'user-1', email: 'me@example.test', name: 'Test User', is_admin: true, must_change_password: false, created_at: '2026-01-01' };
  sqlite.exec("INSERT INTO users (id, email, name, password_hash, is_admin) VALUES ('user-1', 'me@example.test', 'Test User', 'SECRET-PASSWORD-HASH', 1), ('user-2', 'other@example.test', 'Other', 'OTHER-SECRET', 0)");
  sqlite.exec("INSERT INTO domains (id, name, status, sending_enabled, receiving_enabled, catchall_user_id) VALUES ('domain-1', 'example.test', 'verified', 1, 1, 'user-1')");
  sqlite.exec("INSERT INTO addresses (id, user_id, domain_id, address, is_default) VALUES ('address-1', 'user-1', 'domain-1', 'me@example.test', 1)");
  const from: MailAddress = { id: 'address-1', user_id: user.id, domain_id: 'domain-1', domain_name: 'example.test', address: user.email, label: 'Test User', is_default: true, signature: null, created_at: user.created_at };
  return { env: { DB: db, ATTACHMENTS: bucket }, db, bucket, sqlite, objects, faults, user, from };
}
