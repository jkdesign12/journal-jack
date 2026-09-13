import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/server/auth';
import { recordBlob } from '@/lib/server/blobs';
import { usingPostgres } from '@/lib/server/backend';

/* A serverless host refuses request bodies over 4.5 MB, which is smaller than
   most songs. So big files never touch this function: the browser asks here for
   a short-lived upload token, sends the file straight to the blob store, and
   the store calls back to say where it landed.
   
   Only offered when there is a blob store to upload to; a disk-backed host has
   no size cap to dodge and the ordinary route handles any size. */
export async function POST(req: Request) {
  const configured =
    usingPostgres() &&
    (process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID || process.env.VERCEL_OIDC_TOKEN);

  if (!configured) {
    return NextResponse.json({ error: 'This deployment has no file storage connected' }, { status: 404 });
  }

  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const { handleUpload } = await import('@vercel/blob/client');
  const body = await req.json().catch(() => ({}));

  try {
    const result = await handleUpload({
      request: req,
      body,
      onBeforeGenerateToken: async (pathname: string) => {
        // the id the client wants is namespaced under the account, so one
        // person can never write over another's file
        if (!String(pathname).startsWith(user.id + '/')) {
          throw new Error('That upload path is not yours');
        }
        return {
          allowedContentTypes: ['audio/*', 'image/*', 'video/*'],
          addRandomSuffix: false,
          tokenPayload: JSON.stringify({ userId: user.id, pathname }),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        const { userId } = JSON.parse(tokenPayload || '{}') as { userId: string };
        const id = blob.pathname.split('/').pop()!;
        await recordBlob(userId, id, blob.contentType ?? null, 0, blob.url);
      },
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
