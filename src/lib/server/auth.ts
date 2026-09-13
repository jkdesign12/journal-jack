import 'server-only';
import crypto from 'node:crypto';
import { cookies } from 'next/headers';
import { ready, rows, sql } from './db';

export const SESSION_DAYS = 30;
export const SESSION_COOKIE = 'sid';

export interface User {
  id: string;
  email: string;
}

const now = () => Date.now();

const hashPassword = (password: string, salt: string) =>
  crypto.scryptSync(password, salt, 64).toString('hex');

export async function signup(email: string, password: string): Promise<User> {
  await ready();
  const db = sql();
  const address = String(email ?? '').trim().toLowerCase();

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) {
    throw new Error('That does not look like an email address');
  }
  if (String(password ?? '').length < 8) {
    throw new Error('Password needs at least 8 characters');
  }

  const taken = await rows<{ id: string }>(db`SELECT id FROM users WHERE email = ${address}`);
  if (taken.length) throw new Error('That email already has an account');

  const id = crypto.randomUUID();
  const salt = crypto.randomBytes(16).toString('hex');
  await db`INSERT INTO users (id, email, hash, salt, created)
           VALUES (${id}, ${address}, ${hashPassword(password, salt)}, ${salt}, ${now()})`;
  return { id, email: address };
}

export async function login(email: string, password: string): Promise<User> {
  await ready();
  const db = sql();
  const address = String(email ?? '').trim().toLowerCase();
  const [user] = await rows<{ id: string; email: string; hash: string; salt: string }>(
    db`SELECT * FROM users WHERE email = ${address}`,
  );

  // hash regardless, so a wrong address and a wrong password take the same time
  const salt = user ? user.salt : 'no-such-user';
  const attempt = Buffer.from(hashPassword(password ?? '', salt), 'hex');
  const known = Buffer.from(user ? user.hash : attempt.toString('hex'), 'hex');
  const ok = !!user && attempt.length === known.length && crypto.timingSafeEqual(attempt, known);

  if (!ok) throw new Error('Wrong email or password');
  return { id: user.id, email: user.email };
}

export async function openSession(userId: string): Promise<string> {
  await ready();
  const token = crypto.randomBytes(32).toString('hex');
  await sql()`INSERT INTO sessions (token, user_id, created) VALUES (${token}, ${userId}, ${now()})`;
  return token;
}

export async function closeSession(token: string): Promise<void> {
  await ready();
  await sql()`DELETE FROM sessions WHERE token = ${token}`;
}

export async function sessionUser(token: string | undefined): Promise<User | null> {
  if (!token) return null;
  await ready();
  const [row] = await rows<{ id: string; email: string; created: string | number }>(
    sql()`SELECT u.id, u.email, s.created FROM sessions s
          JOIN users u ON u.id = s.user_id
          WHERE s.token = ${token}`,
  );
  if (!row) return null;
  if (now() - Number(row.created) > SESSION_DAYS * 864e5) {
    await closeSession(token);
    return null;
  }
  return { id: row.id, email: row.email };
}

export async function userCount(): Promise<number> {
  await ready();
  const [row] = await rows<{ c: number }>(sql()`SELECT COUNT(*)::int AS c FROM users`);
  return row.c;
}

/** The signed-in user for this request, or null. */
export async function currentUser(): Promise<User | null> {
  const jar = await cookies();
  return sessionUser(jar.get(SESSION_COOKIE)?.value);
}

export async function setSessionCookie(token: string): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
}

/* Signing up is open until the first account exists; after that it needs the
   code, if one is set. A journal with no lock on the door is fine while it is
   only yours — but it should not stay that way by accident. */
export async function signupAllowed(code: string | undefined): Promise<true | string> {
  const required = process.env.SIGNUP_CODE;
  if (required) return code === required ? true : 'That signup code is not right';
  if ((await userCount()) === 0) return true;
  return 'This journal is private. Set SIGNUP_CODE on the server to invite someone.';
}

/* Slow down guessing without reaching for a dependency: attempts per address on
   the auth routes, counted in this instance's memory. A serverless instance is
   short-lived, so this is a speed bump rather than a wall — enough to make
   working through a password list unattractive. */
const attempts = new Map<string, { n: number; until: number }>();

export function rateLimited(key: string): boolean {
  const at = Date.now();
  const rec = attempts.get(key) ?? { n: 0, until: at + 15 * 60e3 };
  if (at > rec.until) {
    rec.n = 0;
    rec.until = at + 15 * 60e3;
  }
  rec.n++;
  attempts.set(key, rec);
  if (attempts.size > 5000) attempts.clear();
  return rec.n > 12;
}
