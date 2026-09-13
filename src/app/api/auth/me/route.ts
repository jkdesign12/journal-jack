import { NextResponse } from 'next/server';
import { currentUser, signupAllowed } from '@/lib/server/auth';
import { hasDatabase } from '@/lib/server/db';

export async function GET() {
  if (!hasDatabase()) {
    return NextResponse.json({ user: null, signupOpen: false, needsCode: false, noDatabase: true });
  }
  return NextResponse.json({
    user: await currentUser(),
    signupOpen: (await signupAllowed('__probe__')) === true || !!process.env.SIGNUP_CODE,
    needsCode: !!process.env.SIGNUP_CODE,
  });
}
