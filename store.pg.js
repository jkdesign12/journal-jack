/* store.pg.js — the same store, for hosts with no disk.
 *
 * Journals, accounts, sessions and the poster cache live in Postgres; photos and
 * mp3s go to a blob store. Used whenever DATABASE_URL is set, which is how a
 * Vercel deploy is configured.
 *
 * Every function here is async. The SQLite version is synchronous, and the
 * router awaits both — awaiting a plain value is harmless, so one code path
 * serves both backends.
 */

const crypto = require('node:crypto');
const { neon } = require('@neondatabase/serverless');

const sql = neon(process.env.DATABASE_URL);
const SESSION_DAYS = 30;

/* Serverless functions start cold and forget everything, so the schema is
   ensured once per instance rather than once per deploy. */
let schema = null;
function ready() {
  schema ||= (async () => {
    await sql`CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL,
      hash TEXT NOT NULL, salt TEXT NOT NULL, created BIGINT NOT NULL)`;
    await sql`CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY, user_id TEXT NOT NULL, created BIGINT NOT NULL)`;
    await sql`CREATE TABLE IF NOT EXISTS journals (
      user_id TEXT PRIMARY KEY, doc JSONB NOT NULL,
      version INTEGER NOT NULL, updated BIGINT NOT NULL)`;
    await sql`CREATE TABLE IF NOT EXISTS blobs (
      id TEXT NOT NULL, user_id TEXT NOT NULL, mime TEXT, size INTEGER,
      url TEXT NOT NULL, created BIGINT NOT NULL, PRIMARY KEY (id, user_id))`;
    await sql`CREATE TABLE IF NOT EXISTS artwork (
      key TEXT PRIMARY KEY, url TEXT, at BIGINT NOT NULL)`;
  })();
  return schema;
}

const now = () => Date.now();
const hashPassword = (password, salt) => crypto.scryptSync(password, salt, 64).toString('hex');

/* ---------------- accounts ---------------- */

async function signup(email, password) {
  await ready();
  email = String(email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('That does not look like an email address');
  if (String(password || '').length < 8) throw new Error('Password needs at least 8 characters');

  const taken = await sql`SELECT id FROM users WHERE email = ${email}`;
  if (taken.length) throw new Error('That email already has an account');

  const id = crypto.randomUUID();
  const salt = crypto.randomBytes(16).toString('hex');
  await sql`INSERT INTO users (id, email, hash, salt, created)
            VALUES (${id}, ${email}, ${hashPassword(password, salt)}, ${salt}, ${now()})`;
  return { id, email };
}

async function login(email, password) {
  await ready();
  email = String(email || '').trim().toLowerCase();
  const [user] = await sql`SELECT * FROM users WHERE email = ${email}`;
  // hash regardless, so a wrong address and a wrong password take the same time
  const salt = user ? user.salt : 'no-such-user';
  const attempt = Buffer.from(hashPassword(password || '', salt), 'hex');
  const known = Buffer.from(user ? user.hash : attempt.toString('hex'), 'hex');
  const ok = user && attempt.length === known.length && crypto.timingSafeEqual(attempt, known);
  if (!ok) throw new Error('Wrong email or password');
  return { id: user.id, email: user.email };
}

async function openSession(userId) {
  await ready();
  const token = crypto.randomBytes(32).toString('hex');
  await sql`INSERT INTO sessions (token, user_id, created) VALUES (${token}, ${userId}, ${now()})`;
  return token;
}

async function sessionUser(token) {
  if (!token) return null;
  await ready();
  const [row] = await sql`SELECT u.id, u.email, s.created FROM sessions s
                          JOIN users u ON u.id = s.user_id WHERE s.token = ${token}`;
  if (!row) return null;
  if (now() - Number(row.created) > SESSION_DAYS * 864e5) { await closeSession(token); return null; }
  return { id: row.id, email: row.email };
}

async function closeSession(token) {
  await ready();
  await sql`DELETE FROM sessions WHERE token = ${token}`;
}

async function userCount() {
  await ready();
  const [row] = await sql`SELECT COUNT(*)::int AS c FROM users`;
  return row.c;
}

/* ---------------- journal document ---------------- */

async function getJournal(userId) {
  await ready();
  const [row] = await sql`SELECT doc, version, updated FROM journals WHERE user_id = ${userId}`;
  if (!row) return { doc: null, version: 0, updated: 0 };
  return { doc: row.doc, version: row.version, updated: Number(row.updated) };
}

/* Same optimistic lock as the SQLite version: a push built on a stale version is
   refused and the newer document handed back. */
async function putJournal(userId, doc, baseVersion) {
  await ready();
  const [cur] = await sql`SELECT version FROM journals WHERE user_id = ${userId}`;
  const version = cur ? cur.version : 0;
  if (baseVersion != null && cur && baseVersion !== version) {
    return { conflict: true, ...(await getJournal(userId)) };
  }
  const next = version + 1;
  const stamp = now();
  const body = JSON.stringify(doc);
  await sql`INSERT INTO journals (user_id, doc, version, updated)
            VALUES (${userId}, ${body}::jsonb, ${next}, ${stamp})
            ON CONFLICT (user_id) DO UPDATE
              SET doc = EXCLUDED.doc, version = EXCLUDED.version, updated = EXCLUDED.updated`;
  return { conflict: false, version: next, updated: stamp };
}

/* ---------------- blobs ---------------- */

const safeId = (id) => /^[A-Za-z0-9_-]{1,64}$/.test(id);

const NO_STORE =
  'This site has no file storage connected yet, so photos and songs cannot be saved. ' +
  'In Vercel open this project, go to Storage, create a Blob store, connect it to the ' +
  'project, then redeploy.';

/* A connected store authenticates one of two ways: a long-lived read-write
   token, or OIDC credentials issued at runtime (BLOB_STORE_ID plus a rotating
   VERCEL_OIDC_TOKEN). Insisting on the token alone would reject a perfectly
   working OIDC setup, so accept either and let the SDK decide. */
const hasBlobStore = () =>
  !!(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID || process.env.VERCEL_OIDC_TOKEN);

/* A store is created as private or public and cannot be switched afterwards, so
   rather than make you configure which one you made, try private first and fall
   back to public. Private is the better answer for a journal: files are only
   readable through this server, which checks you are signed in. */
let blobAccess = process.env.BLOB_ACCESS || null;

async function putWithAccess(pathname, body, options) {
  const { put } = require('@vercel/blob');
  const order = blobAccess ? [blobAccess] : ['private', 'public'];
  let lastError;
  for (const access of order) {
    try {
      const saved = await put(pathname, body, { ...options, access });
      blobAccess = access;                 // remember for the rest of this instance
      return saved;
    } catch (e) {
      lastError = e;
      if (!/access|private|public/i.test(e.message || '')) throw e;   // a real failure
    }
  }
  throw lastError;
}

async function putBlob(userId, id, mime, buf) {
  if (!safeId(id)) throw new Error('Bad blob id');
  if (!hasBlobStore()) throw new Error(NO_STORE);
  await ready();
  const saved = await putWithAccess(`${userId}/${id}`, buf, {
    contentType: mime || 'application/octet-stream',
    addRandomSuffix: false,
    allowOverwrite: true
  });
  await sql`INSERT INTO blobs (id, user_id, mime, size, url, created)
            VALUES (${id}, ${userId}, ${mime || 'application/octet-stream'}, ${buf.length}, ${saved.url}, ${now()})
            ON CONFLICT (id, user_id) DO UPDATE
              SET mime = EXCLUDED.mime, size = EXCLUDED.size, url = EXCLUDED.url`;
}

/* The browser uploaded straight to the blob store and the store called us back:
   all that is left is to remember where the file went. */
async function recordBlob(userId, id, mime, size, url) {
  if (!safeId(id)) throw new Error('Bad blob id');
  await ready();
  await sql`INSERT INTO blobs (id, user_id, mime, size, url, created)
            VALUES (${id}, ${userId}, ${mime || 'application/octet-stream'}, ${size}, ${url}, ${now()})
            ON CONFLICT (id, user_id) DO UPDATE
              SET mime = EXCLUDED.mime, size = EXCLUDED.size, url = EXCLUDED.url`;
}

/* Public files can be handed straight to the browser as a URL. Private ones are
   not reachable without credentials, so they are fetched here and streamed on —
   which also means the signed-in check in the router is what guards them. */
async function getBlob(userId, id) {
  if (!safeId(id)) return null;
  await ready();
  const [row] = await sql`SELECT mime, url FROM blobs WHERE id = ${id} AND user_id = ${userId}`;
  if (!row) return null;

  const isPrivate = blobAccess === 'private' ||
    /\.private\.blob\.vercel-storage\.com/.test(row.url || '');
  if (!isPrivate) return { mime: row.mime, url: row.url };

  const { get } = require('@vercel/blob');
  const result = await get(`${userId}/${id}`, { access: 'private' });
  if (!result || result.statusCode !== 200) return null;
  return { mime: result.blob?.contentType || row.mime, stream: result.stream };
}

async function listBlobs(userId) {
  await ready();
  const rows = await sql`SELECT id FROM blobs WHERE user_id = ${userId}`;
  return rows.map((r) => r.id);
}

/* ---------------- artwork cache ---------------- */

async function artLookup(key) {
  await ready();
  const [row] = await sql`SELECT url FROM artwork WHERE key = ${key}`;
  return row ? row.url : undefined;   // undefined = never looked up, '' = no poster exists
}

async function artStore(key, url) {
  await ready();
  await sql`INSERT INTO artwork (key, url, at) VALUES (${key}, ${url}, ${now()})
            ON CONFLICT (key) DO UPDATE SET url = EXCLUDED.url`;
}

module.exports = {
  signup, login, openSession, sessionUser, closeSession, userCount,
  getJournal, putJournal,
  putBlob, getBlob, listBlobs, recordBlob,
  artLookup, artStore
};
