import { NextResponse } from 'next/server';
import { connectionString } from '@/lib/server/db';
import { hasBlobStore } from '@/lib/server/blobs';

/* One page that says whether this deployment can actually keep anything, and
   what to do about it if not. */
export async function GET() {
  const db = connectionString();
  const blobAuth = process.env.BLOB_READ_WRITE_TOKEN
    ? 'read-write token'
    : process.env.BLOB_STORE_ID || process.env.VERCEL_OIDC_TOKEN
      ? 'OIDC'
      : null;

  return NextResponse.json({
    database: db ? 'connected' : 'MISSING — accounts and sync cannot work',
    fileStorage: blobAuth ? `connected (${blobAuth})` : 'MISSING — photos and songs cannot be saved',
    clientUploads: process.env.BLOB_READ_WRITE_TOKEN
      ? 'available'
      : 'unavailable — big files rely on resizing first',
    whatToDo:
      db && blobAuth
        ? 'Nothing: storage is set up.'
        : 'In Vercel open this project, go to Storage, and connect what is missing, then redeploy.',
  });
}
