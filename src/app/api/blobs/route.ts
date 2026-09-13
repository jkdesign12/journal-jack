import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/server/auth';
import { listBlobs } from '@/lib/server/blobs';

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  return NextResponse.json({ ids: await listBlobs(user.id) });
}
