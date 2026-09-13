import { NextResponse } from 'next/server';
import { login, openSession, rateLimited, setSessionCookie } from '@/lib/server/auth';

export async function POST(req: Request) {
  const { email, password } = (await req.json().catch(() => ({}))) as {
    email?: string;
    password?: string;
  };

  if (rateLimited(String(email ?? '').toLowerCase())) {
    return NextResponse.json({ error: 'Too many attempts. Try again in a few minutes.' }, { status: 429 });
  }

  try {
    const user = await login(email ?? '', password ?? '');
    await setSessionCookie(await openSession(user.id));
    return NextResponse.json({ user });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 401 });
  }
}
