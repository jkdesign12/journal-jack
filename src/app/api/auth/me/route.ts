import { NextResponse } from 'next/server';
import { currentUser, signupAllowed } from '@/lib/server/auth';

export async function GET() {
  return NextResponse.json({
    user: await currentUser(),
    signupOpen: (await signupAllowed('__probe__')) === true || !!process.env.SIGNUP_CODE,
    needsCode: !!process.env.SIGNUP_CODE,
  });
}
