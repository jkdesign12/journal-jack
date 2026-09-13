import { NextResponse } from 'next/server';
import { rateLimited, setSessionCookie, signup, signupAllowed, openSession } from '@/lib/server/auth';

export async function POST(req: Request) {
  const { email, password, code } = (await req.json().catch(() => ({}))) as {
    email?: string;
    password?: string;
    code?: string;
  };

  if (rateLimited(String(email ?? '').toLowerCase())) {
    return NextResponse.json({ error: 'Too many attempts. Try again in a few minutes.' }, { status: 429 });
  }

  const allowed = await signupAllowed(code);
  if (allowed !== true) return NextResponse.json({ error: allowed }, { status: 403 });

  try {
    const user = await signup(email ?? '', password ?? '');
    await setSessionCookie(await openSession(user.id));
    return NextResponse.json({ user });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
