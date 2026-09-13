import { NextResponse } from 'next/server';
import { usingPostgres } from '@/lib/server/backend';

/* One page that says whether this deployment can actually keep anything, and
   what to do about it if not. */
export async function GET() {
  const postgres = usingPostgres();
  const blobAuth = process.env.BLOB_READ_WRITE_TOKEN
    ? 'read-write token'
    : process.env.BLOB_STORE_ID || process.env.VERCEL_OIDC_TOKEN
      ? 'OIDC'
      : null;

  return NextResponse.json({
    storage: postgres ? 'Postgres and a blob store' : 'SQLite and files under ./data',
    database: postgres ? 'connected' : 'on this machine',
    fileStorage: postgres
      ? blobAuth
        ? `connected (${blobAuth})`
        : 'MISSING — photos and songs cannot be saved'
      : 'on this machine',
    clientUploads:
      postgres && !process.env.BLOB_READ_WRITE_TOKEN
        ? 'unavailable — big files rely on resizing first'
        : 'available',
    whatToDo:
      !postgres || blobAuth
        ? 'Nothing: storage is set up.'
        : 'In Vercel open this project, go to Storage, connect a Blob store, then redeploy.',
  });
}
