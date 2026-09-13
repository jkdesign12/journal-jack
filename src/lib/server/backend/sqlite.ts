import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Backend, BlobRead, StoredJournal, UserRow } from './types';
import type { JournalDoc } from '@/lib/journal/types';

/* Running the journal on your own machine.
 *
 * SQLite for the document and the accounts, ordinary files for the photos and
 * songs, all under ./data. Nothing here needs configuring, which is the point:
 * `npm run dev` should give you a working journal, not a sign-in page that
 * cannot work because no database is connected.
 */

const ROOT = path.join(process.cwd(), 'data');
const BLOBS = path.join(ROOT, 'blobs');

let db: DatabaseSync | null = null;

function open(): DatabaseSync {
  if (db) return db;
  fs.mkdirSync(BLOBS, { recursive: true });
  db = new DatabaseSync(path.join(ROOT, 'journal.db'));

  // survives a crash without a full fsync on every write
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL,
    hash TEXT NOT NULL, salt TEXT NOT NULL, created INTEGER NOT NULL)`);
  db.exec(`CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY, user_id TEXT NOT NULL, created INTEGER NOT NULL)`);
  db.exec(`CREATE TABLE IF NOT EXISTS journals (
    user_id TEXT PRIMARY KEY, doc TEXT NOT NULL,
    version INTEGER NOT NULL, updated INTEGER NOT NULL)`);
  db.exec(`CREATE TABLE IF NOT EXISTS blobs (
    id TEXT NOT NULL, user_id TEXT NOT NULL, mime TEXT, size INTEGER,
    created INTEGER NOT NULL, PRIMARY KEY (id, user_id))`);
  db.exec(`CREATE TABLE IF NOT EXISTS artwork (
    key TEXT PRIMARY KEY, url TEXT, at INTEGER NOT NULL)`);
  return db;
}

const fileFor = (userId: string, id: string) => path.join(BLOBS, userId, id);

export const sqliteBackend: Backend = {
  kind: 'sqlite',

  async userByEmail(email) {
    const row = open().prepare('SELECT * FROM users WHERE email = ?').get(email);
    return (row as UserRow | undefined) ?? null;
  },

  async createUser(row) {
    open()
      .prepare('INSERT INTO users (id, email, hash, salt, created) VALUES (?, ?, ?, ?, ?)')
      .run(row.id, row.email, row.hash, row.salt, row.created);
  },

  async userCount() {
    const row = open().prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number };
    return row.c;
  },

  async createSession(token, userId, created) {
    open()
      .prepare('INSERT INTO sessions (token, user_id, created) VALUES (?, ?, ?)')
      .run(token, userId, created);
  },

  async sessionOwner(token) {
    const row = open()
      .prepare(
        `SELECT u.id AS id, u.email AS email, s.created AS created
         FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`,
      )
      .get(token) as { id: string; email: string; created: number } | undefined;
    return row ?? null;
  },

  async deleteSession(token) {
    open().prepare('DELETE FROM sessions WHERE token = ?').run(token);
  },

  async getJournal(userId): Promise<StoredJournal> {
    const row = open()
      .prepare('SELECT doc, version, updated FROM journals WHERE user_id = ?')
      .get(userId) as { doc: string; version: number; updated: number } | undefined;
    if (!row) return { doc: null, version: 0, updated: 0 };
    return { doc: JSON.parse(row.doc) as JournalDoc, version: row.version, updated: row.updated };
  },

  async putJournal(userId, doc, baseVersion) {
    const d = open();
    const cur = d.prepare('SELECT version FROM journals WHERE user_id = ?').get(userId) as
      | { version: number }
      | undefined;
    const version = cur ? cur.version : 0;

    // a push built on a version that has moved on is refused, not merged blindly
    if (baseVersion != null && cur && baseVersion !== version) {
      return { conflict: true, ...(await this.getJournal(userId)) };
    }

    const next = version + 1;
    const stamp = Date.now();
    d.prepare(
      `INSERT INTO journals (user_id, doc, version, updated) VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET doc = excluded.doc,
         version = excluded.version, updated = excluded.updated`,
    ).run(userId, JSON.stringify(doc), next, stamp);
    return { conflict: false, version: next, updated: stamp };
  },

  async putBlob(userId, id, mime, buf) {
    fs.mkdirSync(path.join(BLOBS, userId), { recursive: true });
    fs.writeFileSync(fileFor(userId, id), buf);
    open()
      .prepare(
        `INSERT INTO blobs (id, user_id, mime, size, created) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id, user_id) DO UPDATE SET mime = excluded.mime, size = excluded.size`,
      )
      .run(id, userId, mime ?? 'application/octet-stream', buf.length, Date.now());
  },

  async recordBlob() {
    // nothing to record: a disk-backed host has no direct-to-storage route
  },

  async getBlob(userId, id): Promise<BlobRead> {
    const row = open()
      .prepare('SELECT mime FROM blobs WHERE id = ? AND user_id = ?')
      .get(id, userId) as { mime: string } | undefined;
    if (!row) return null;
    try {
      return { mime: row.mime, buf: fs.readFileSync(fileFor(userId, id)) };
    } catch {
      return null; // the row outlived the file
    }
  },

  async listBlobs(userId) {
    const rows = open().prepare('SELECT id FROM blobs WHERE user_id = ?').all(userId) as {
      id: string;
    }[];
    return rows.map((r) => r.id);
  },

  async artLookup(key) {
    const row = open().prepare('SELECT url FROM artwork WHERE key = ?').get(key) as
      | { url: string }
      | undefined;
    return row ? row.url : undefined; // undefined = never looked up, '' = none exists
  },

  async artStore(key, url) {
    open()
      .prepare(
        `INSERT INTO artwork (key, url, at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET url = excluded.url, at = excluded.at`,
      )
      .run(key, url, Date.now());
  },
};
