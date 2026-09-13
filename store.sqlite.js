/* store.js — accounts, journals and files.
 *
 * Uses node:sqlite, which ships with Node itself, so the whole app still has zero
 * npm dependencies. Everything lives in ./data:
 *
 *   data/journal.db          users, sessions, journal documents, artwork cache
 *   data/blobs/<user>/<id>   the actual photos and mp3s
 *
 * Passwords are scrypt-hashed with a per-user salt; sessions are random 32-byte
 * tokens held in an HttpOnly cookie. Nothing here is sent anywhere — it is your
 * machine talking to your own server.
 */

const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DATA = process.env.DATA_DIR || path.join(__dirname, 'data');
const BLOBS = path.join(DATA, 'blobs');
fs.mkdirSync(BLOBS, { recursive: true });

const db = new DatabaseSync(path.join(DATA, 'journal.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL,
    hash TEXT NOT NULL, salt TEXT NOT NULL, created INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY, user_id TEXT NOT NULL, created INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS journals (
    user_id TEXT PRIMARY KEY, doc TEXT NOT NULL,
    version INTEGER NOT NULL, updated INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS blobs (
    id TEXT NOT NULL, user_id TEXT NOT NULL, mime TEXT, size INTEGER,
    created INTEGER NOT NULL, PRIMARY KEY (id, user_id));
  CREATE TABLE IF NOT EXISTS artwork (
    key TEXT PRIMARY KEY, url TEXT, at INTEGER NOT NULL);
`);

const now = () => Date.now();
const q = (sql) => db.prepare(sql);

/* ---------------- accounts ---------------- */

const SESSION_DAYS = 30;

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function signup(email, password) {
  email = String(email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('That does not look like an email address');
  if (String(password || '').length < 8) throw new Error('Password needs at least 8 characters');
  if (q('SELECT id FROM users WHERE email = ?').get(email)) throw new Error('That email already has an account');

  const id = crypto.randomUUID();
  const salt = crypto.randomBytes(16).toString('hex');
  q('INSERT INTO users (id, email, hash, salt, created) VALUES (?, ?, ?, ?, ?)')
    .run(id, email, hashPassword(password, salt), salt, now());
  return { id, email };
}

function login(email, password) {
  email = String(email || '').trim().toLowerCase();
  const user = q('SELECT * FROM users WHERE email = ?').get(email);
  // compare even on a miss so a wrong email and a wrong password cost the same
  const salt = user ? user.salt : 'no-such-user';
  const attempt = Buffer.from(hashPassword(password || '', salt), 'hex');
  const known = Buffer.from(user ? user.hash : attempt.toString('hex'), 'hex');
  const ok = user && attempt.length === known.length && crypto.timingSafeEqual(attempt, known);
  if (!ok) throw new Error('Wrong email or password');
  return { id: user.id, email: user.email };
}

function openSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  q('INSERT INTO sessions (token, user_id, created) VALUES (?, ?, ?)').run(token, userId, now());
  return token;
}

function sessionUser(token) {
  if (!token) return null;
  const row = q(`SELECT u.id, u.email, s.created FROM sessions s
                 JOIN users u ON u.id = s.user_id WHERE s.token = ?`).get(token);
  if (!row) return null;
  if (now() - row.created > SESSION_DAYS * 864e5) { closeSession(token); return null; }
  return { id: row.id, email: row.email };
}

const closeSession = (token) => q('DELETE FROM sessions WHERE token = ?').run(token);

const userCount = () => q('SELECT COUNT(*) AS c FROM users').get().c;

/* ---------------- journal document ---------------- */

function getJournal(userId) {
  const row = q('SELECT doc, version, updated FROM journals WHERE user_id = ?').get(userId);
  if (!row) return { doc: null, version: 0, updated: 0 };
  return { doc: JSON.parse(row.doc), version: row.version, updated: row.updated };
}

/* Optimistic concurrency: a client sends the version it last saw. If the server
   has moved on, the write is refused and the caller gets the newer document back
   rather than silently overwriting another device. */
function putJournal(userId, doc, baseVersion) {
  const cur = q('SELECT version FROM journals WHERE user_id = ?').get(userId);
  const version = cur ? cur.version : 0;
  if (baseVersion != null && cur && baseVersion !== version) {
    return { conflict: true, ...getJournal(userId) };
  }
  const next = version + 1;
  const body = JSON.stringify(doc);
  if (cur) q('UPDATE journals SET doc = ?, version = ?, updated = ? WHERE user_id = ?').run(body, next, now(), userId);
  else q('INSERT INTO journals (user_id, doc, version, updated) VALUES (?, ?, ?, ?)').run(userId, body, next, now());
  return { conflict: false, version: next, updated: now() };
}

/* ---------------- blobs ---------------- */

const safeId = (id) => /^[A-Za-z0-9_-]{1,64}$/.test(id);
const blobPath = (userId, id) => path.join(BLOBS, userId, id);

function putBlob(userId, id, mime, buf) {
  if (!safeId(id)) throw new Error('Bad blob id');
  fs.mkdirSync(path.join(BLOBS, userId), { recursive: true });
  fs.writeFileSync(blobPath(userId, id), buf);
  q(`INSERT INTO blobs (id, user_id, mime, size, created) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id, user_id) DO UPDATE SET mime = excluded.mime, size = excluded.size`)
    .run(id, userId, mime || 'application/octet-stream', buf.length, now());
}

function getBlob(userId, id) {
  if (!safeId(id)) return null;
  const row = q('SELECT mime FROM blobs WHERE id = ? AND user_id = ?').get(id, userId);
  const file = blobPath(userId, id);
  if (!row || !fs.existsSync(file)) return null;
  return { mime: row.mime, buf: fs.readFileSync(file) };
}

/* Only meaningful when files live in a separate blob store; on a disk-backed
   host the ordinary upload handles every size. */
function recordBlob() {
  throw new Error('This host stores files itself; upload directly');
}

const listBlobs = (userId) =>
  q('SELECT id FROM blobs WHERE user_id = ?').all(userId).map((r) => r.id);

/* ---------------- artwork cache ---------------- */

const artLookup = (key) => {
  const row = q('SELECT url FROM artwork WHERE key = ?').get(key);
  return row ? row.url : undefined;      // undefined = never looked up, '' = looked up, no poster
};
const artStore = (key, url) =>
  q('INSERT INTO artwork (key, url, at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET url = excluded.url')
    .run(key, url, now());

module.exports = {
  signup, login, openSession, sessionUser, closeSession, userCount,
  getJournal, putJournal,
  putBlob, getBlob, listBlobs, recordBlob,
  artLookup, artStore
};
