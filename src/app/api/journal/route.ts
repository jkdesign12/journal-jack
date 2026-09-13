import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/server/auth';
import { getJournal, putJournal } from '@/lib/server/journal';
import type { JournalDoc } from '@/lib/journal/types';

const unauthorised = () => NextResponse.json({ error: 'Not signed in' }, { status: 401 });

export async function GET() {
  const user = await currentUser();
  if (!user) return unauthorised();
  return NextResponse.json(await getJournal(user.id));
}

export async function PUT(req: Request) {
  const user = await currentUser();
  if (!user) return unauthorised();

  const body = (await req.json().catch(() => ({}))) as {
    doc?: JournalDoc;
    baseVersion?: number | null;
  };
  if (!body.doc || typeof body.doc !== 'object') {
    return NextResponse.json({ error: 'No document' }, { status: 400 });
  }

  const out = await putJournal(user.id, body.doc, body.baseVersion);
  // 409 is the signal to merge and try again, not an error to show anyone
  return NextResponse.json(out, { status: out.conflict ? 409 : 200 });
}
