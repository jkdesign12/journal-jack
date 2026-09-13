import 'server-only';
import { ready, sql } from './db';

/* Photos and songs do not belong in Postgres, so the bytes go to a blob store
   and the database keeps only an index: which file, whose, and where it landed. */

export const safeId = (id: string) => /^[A-Za-z0-9_-]{1,64}$/.test(id);

export const NO_STORE =
  'This site has no file storage connected yet, so photos and songs cannot be saved. ' +
  'In Vercel open this project, go to Storage, create a Blob store, connect it to the ' +
  'project, then redeploy.';

/* A connected store authenticates one of two ways: a long-lived read-write
   token, or credentials issued at runtime (a store id plus a rotating OIDC
   token). Insisting on the token alone would reject a working OIDC setup. */
export const hasBlobStore = () =>
  !!(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID || process.env.VERCEL_OIDC_TOKEN);

/* A store is created private or public and cannot be switched afterwards, so
   rather than make anyone configure which one they made, try private first and
   fall back. Private is the better answer for a journal: files are readable
   only through this server, which checks you are signed in. */
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
      blobAccess = access; // remember for the rest of this instance
      return saved;
    } catch (e) {
      lastError = e;
      const message = e instanceof Error ? e.message : '';
      if (!/access|private|public/i.test(message)) throw e; // a real failure
    }
  }
  throw lastError;
}

export async function putBlob(
  userId: string,
  id: string,
  mime: string | null,
  buf: Buffer,
): Promise<void> {
  if (!safeId(id)) throw new Error('Bad blob id');
  if (!hasBlobStore()) throw new Error(NO_STORE);
  await ready();

  const type = mime || 'application/octet-stream';
  const saved = await putWithAccess(`${userId}/${id}`, buf, type);

  await sql()`INSERT INTO blobs (id, user_id, mime, size, url, created)
              VALUES (${id}, ${userId}, ${type}, ${buf.length}, ${saved.url}, ${Date.now()})
              ON CONFLICT (id, user_id) DO UPDATE
                SET mime = EXCLUDED.mime, size = EXCLUDED.size, url = EXCLUDED.url`;
}

/** The browser uploaded straight to the store; all that is left is to remember where. */
export async function recordBlob(
  userId: string,
  id: string,
  mime: string | null,
  size: number,
  url: string,
): Promise<void> {
  if (!safeId(id)) throw new Error('Bad blob id');
  await ready();
  await sql()`INSERT INTO blobs (id, user_id, mime, size, url, created)
              VALUES (${id}, ${userId}, ${mime || 'application/octet-stream'}, ${size}, ${url}, ${Date.now()})
              ON CONFLICT (id, user_id) DO UPDATE
                SET mime = EXCLUDED.mime, size = EXCLUDED.size, url = EXCLUDED.url`;
}

export type BlobRead =
  | { mime: string; url: string }
  | { mime: string; stream: ReadableStream }
  | null;

/**
 * A public file can be handed to the browser as a URL. A private one is not
 * reachable without credentials, so it is fetched here and streamed on — which
 * makes the signed-in check on the route the thing that guards it.
 */
export async function getBlob(userId: string, id: string): Promise<BlobRead> {
  if (!safeId(id)) return null;
  await ready();
  const [row] = (await sql()`SELECT mime, url FROM blobs
                             WHERE id = ${id} AND user_id = ${userId}`) as Array<{
    mime: string;
    url: string;
  }>;
  if (!row) return null;

  const isPrivate =
    blobAccess === 'private' || /\.private\.blob\.vercel-storage\.com/.test(row.url ?? '');
  if (!isPrivate) return { mime: row.mime, url: row.url };

  const { get } = (await import('@vercel/blob')) as unknown as {
    get: (
      path: string,
      opts: { access: 'private' },
    ) => Promise<{ statusCode: number; stream: ReadableStream; blob?: { contentType?: string } }>;
  };
  const result = await get(`${userId}/${id}`, { access: 'private' });
  if (!result || result.statusCode !== 200) return null;
  return { mime: result.blob?.contentType ?? row.mime, stream: result.stream };
}

export async function listBlobs(userId: string): Promise<string[]> {
  await ready();
  const rows = (await sql()`SELECT id FROM blobs WHERE user_id = ${userId}`) as Array<{ id: string }>;
  return rows.map((r) => r.id);
}
