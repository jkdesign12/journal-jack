import { NextResponse } from 'next/server';
import { clearSessionCookie, SESSION_COOKIE, closeSession } from '@/lib/server/auth';
import { cookies } from 'next/headers';

export async function POST() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token) await closeSession(token);
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
}
