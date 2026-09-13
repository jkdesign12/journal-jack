import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/server/auth';
import { getBlob, putBlob } from '@/lib/server/blobs';

type Params = { params: Promise<{ id: string }> };

const unauthorised = () => NextResponse.json({ error: 'Not signed in' }, { status: 401 });

export async function GET(_req: Request, { params }: Params) {
  const user = await currentUser();
  if (!user) return unauthorised();
  const { id } = await params;

  const blob = await getBlob(user.id, decodeURIComponent(id));
  if (!blob) return NextResponse.json({ error: 'No such file' }, { status: 404 });

  if ('url' in blob) {
    // a public blob: let the browser fetch it directly
    return NextResponse.redirect(blob.url, {
      status: 302,
      headers: { 'Cache-Control': 'private, max-age=3600' },
    });
  }

  /* a private blob: unreachable without credentials, so it is streamed through
     here, and the signed-in check above is what guards it */
  return new NextResponse(blob.stream, {
    headers: {
      'Content-Type': blob.mime || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-cache',
    },
  });
}

export async function PUT(req: Request, { params }: Params) {
  const user = await currentUser();
  if (!user) return unauthorised();
  const { id } = await params;

  try {
    const buf = Buffer.from(await req.arrayBuffer());
    await putBlob(user.id, decodeURIComponent(id), req.headers.get('content-type'), buf);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
