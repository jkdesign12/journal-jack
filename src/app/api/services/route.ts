import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/server/auth';
import { manifest, pull } from '@/lib/server/services/sources';

export const maxDuration = 300; // a full history is thousands of rows, politely paced

export async function GET() {
  return NextResponse.json({ services: manifest() });
}

export async function POST(req: Request) {
  /* These fetch other people's servers on your behalf, so they are only offered
     to someone signed in — unless nobody has made an account, in which case the
     journal is still being set up on one machine. */
  const { id, cfg, range } = (await req.json().catch(() => ({}))) as {
    id?: string;
    cfg?: Record<string, string>;
    range?: { from?: string; to?: string };
  };

  const user = await currentUser();
  if (!user && process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Sign in to pull from a service' }, { status: 401 });
  }

  try {
    const items = await pull(id ?? '', cfg ?? {}, range ?? {});
    return NextResponse.json({ items });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
