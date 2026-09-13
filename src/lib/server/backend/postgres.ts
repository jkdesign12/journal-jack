import 'server-only';
import { neon } from '@neondatabase/serverless';
import type { Backend, BlobRead, StoredJournal, UserRow } from './types';
import type { JournalDoc } from '@/lib/journal/types';
import { connectionString } from './choose';

/* The same store, for a host with no disk that survives a deploy.
 *
 * Journals, accounts, sessions and the artwork cache live in Postgres; photos
 * and songs go to a blob store. The schema here is the one the live journal is
 * already in, so the columns are fixed by the data already sitting in them. */

let client: ReturnType<typeof neon> | null = null;

function sql() {
  const url = connectionString();
  if (!url) throw new Error('No database connected');
  client ??= neon(url);
  return client;
}

// the driver's return type covers every way it can be configured; queries here
// always come back as rows, so this says so once rather than at every call
const rows = async <T>(query: Promise<unknown>): Promise<T[]> => (await query) as T[];

/* A serverless function starts cold and forgets everything, so the schema is
   ensured once per instance rather than once per deploy. */
let schema: Promise<void> | null = null;

function ready(): Promise<void> {
  schema ??= (async () => {
    const db = sql();
    await db`CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL,
      hash TEXT NOT NULL, salt TEXT NOT NULL, created BIGINT NOT NULL)`;
    await db`CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY, user_id TEXT NOT NULL, created BIGINT NOT NULL)`;
    await db`CREATE TABLE IF NOT EXISTS journals (
      user_id TEXT PRIMARY KEY, doc JSONB NOT NULL,
      version INTEGER NOT NULL, updated BIGINT NOT NULL)`;
    await db`CREATE TABLE IF NOT EXISTS blobs (
      id TEXT NOT NULL, user_id TEXT NOT NULL, mime TEXT, size INTEGER,
      url TEXT NOT NULL, created BIGINT NOT NULL, PRIMARY KEY (id, user_id))`;
    await db`CREATE TABLE IF NOT EXISTS artwork (
      key TEXT PRIMARY KEY, url TEXT, at BIGINT NOT NULL)`;
  })();
  return schema;
}

export const NO_STORE =
  'This site has no file storage connected yet, so photos and songs cannot be saved. ' +
  'In Vercel open this project, go to Storage, create a Blob store, connect it to the ' +
  'project, then redeploy.';

/* A connected store authenticates one of two ways: a long-lived read-write
   token, or credentials issued at runtime. Insisting on the token alone would
   reject a perfectly working setup. */
export const hasBlobStore = () =>
  !!(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID || process.env.VERCEL_OIDC_TOKEN);

/* A store is created private or public and cannot be switched afterwards, so
   rather than make anyone configure which one they made, try private first.
   Private is the better answer for a journal: files are readable only through
   this server, which checks you are signed in. */
let blobAccess: 'private' | 'public' | null =
  (process.env.BLOB_ACCESS as 'private' | 'public' | undefined) ?? null;

async function putWithAccess(pathname: string, body: Buffer, contentType: string) {
  const { put } = await import('@vercel/blob');
  const order: Array<'private' | 'public'> = blobAccess ? [blobAccess] : ['private', 'public'];
  let lastError: unknown;

  for (const access of order) {
    try {
      const saved = await put(pathname, body, {
        access: access as 'public',
        contentType,
        addRandomSuffix: false,
        allowOverwrite: true,
      });
      blobAccess = access;
      return saved;
    } catch (e) {
      lastError = e;
      if (!/access|private|public/i.test(e instanceof Error ? e.message : '')) throw e;
    }
  }
  throw lastError;
}

export const postgresBackend: Backend = {
  kind: 'postgres',

  async userByEmail(email) {
    await ready();
    const [row] = await rows<UserRow>(sql()`SELECT * FROM users WHERE email = ${email}`);
    return row ?? null;
  },

  async createUser(row) {
    await ready();
    await sql()`INSERT INTO users (id, email, hash, salt, created)
                VALUES (${row.id}, ${row.email}, ${row.hash}, ${row.salt}, ${row.created})`;
  },

  async userCount() {
    await ready();
    const [row] = await rows<{ c: number }>(sql()`SELECT COUNT(*)::int AS c FROM users`);
    return row.c;
  },

  async createSession(token, userId, created) {
    await ready();
    await sql()`INSERT INTO sessions (token, user_id, created) VALUES (${token}, ${userId}, ${created})`;
  },

  async sessionOwner(token) {
    await ready();
    const [row] = await rows<{ id: string; email: string; created: string | number }>(
      sql()`SELECT u.id, u.email, s.created FROM sessions s
            JOIN users u ON u.id = s.user_id WHERE s.token = ${token}`,
    );
    return row ? { id: row.id, email: row.email, created: Number(row.created) } : null;
  },

  async deleteSession(token) {
    await ready();
    await sql()`DELETE FROM sessions WHERE token = ${token}`;
  },

  async getJournal(userId): Promise<StoredJournal> {
    await ready();
    const [row] = await rows<{ doc: JournalDoc; version: number; updated: string | number }>(
      sql()`SELECT doc, version, updated FROM journals WHERE user_id = ${userId}`,
    );
    if (!row) return { doc: null, version: 0, updated: 0 };
    return { doc: row.doc, version: row.version, updated: Number(row.updated) };
  },

  async putJournal(userId, doc, baseVersion) {
    await ready();
    const db = sql();
    const [cur] = await rows<{ version: number }>(
      db`SELECT version FROM journals WHERE user_id = ${userId}`,
    );
    const version = cur ? cur.version : 0;

    if (baseVersion != null && cur && baseVersion !== version) {
      return { conflict: true, ...(await this.getJournal(userId)) };
    }

    const next = version + 1;
    const stamp = Date.now();
    await db`INSERT INTO journals (user_id, doc, version, updated)
             VALUES (${userId}, ${JSON.stringify(doc)}::jsonb, ${next}, ${stamp})
             ON CONFLICT (user_id) DO UPDATE
               SET doc = EXCLUDED.doc, version = EXCLUDED.version, updated = EXCLUDED.updated`;
    return { conflict: false, version: next, updated: stamp };
  },

  async putBlob(userId, id, mime, buf) {
    if (!hasBlobStore()) throw new Error(NO_STORE);
    await ready();
    const type = mime || 'application/octet-stream';
    const saved = await putWithAccess(`${userId}/${id}`, buf, type);
    await sql()`INSERT INTO blobs (id, user_id, mime, size, url, created)
                VALUES (${id}, ${userId}, ${type}, ${buf.length}, ${saved.url}, ${Date.now()})
                ON CONFLICT (id, user_id) DO UPDATE
                  SET mime = EXCLUDED.mime, size = EXCLUDED.size, url = EXCLUDED.url`;
  },

  async recordBlob(userId, id, mime, size, url) {
    await ready();
    await sql()`INSERT INTO blobs (id, user_id, mime, size, url, created)
                VALUES (${id}, ${userId}, ${mime || 'application/octet-stream'}, ${size}, ${url}, ${Date.now()})
                ON CONFLICT (id, user_id) DO UPDATE
                  SET mime = EXCLUDED.mime, size = EXCLUDED.size, url = EXCLUDED.url`;
  },

  async getBlob(userId, id): Promise<BlobRead> {
    await ready();
    const [row] = await rows<{ mime: string; url: string }>(
      sql()`SELECT mime, url FROM blobs WHERE id = ${id} AND user_id = ${userId}`,
    );
    if (!row) return null;

    const isPrivate =
      blobAccess === 'private' || /\.private\.blob\.vercel-storage\.com/.test(row.url ?? '');
    if (!isPrivate) return { mime: row.mime, url: row.url };

    /* a private blob is unreachable without credentials, so it is fetched here
       and streamed on — which makes the signed-in check on the route the thing
       that guards it */
    const { get } = (await import('@vercel/blob')) as unknown as {
      get: (
        p: string,
        o: { access: 'private' },
      ) => Promise<{ statusCode: number; stream: ReadableStream; blob?: { contentType?: string } }>;
    };
    const result = await get(`${userId}/${id}`, { access: 'private' });
    if (!result || result.statusCode !== 200) return null;
    return { mime: result.blob?.contentType ?? row.mime, stream: result.stream };
  },

  async listBlobs(userId) {
    await ready();
    const found = await rows<{ id: string }>(sql()`SELECT id FROM blobs WHERE user_id = ${userId}`);
    return found.map((r) => r.id);
  },

  async artLookup(key) {
    await ready();
    const [row] = await rows<{ url: string }>(sql()`SELECT url FROM artwork WHERE key = ${key}`);
    return row ? row.url : undefined;
  },

  async artStore(key, url) {
    await ready();
    await sql()`INSERT INTO artwork (key, url, at) VALUES (${key}, ${url}, ${Date.now()})
                ON CONFLICT (key) DO UPDATE SET url = EXCLUDED.url, at = EXCLUDED.at`;
  },
};
