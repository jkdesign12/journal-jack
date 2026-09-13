import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { Backend } from './backend/types';
import type { JournalDoc } from '@/lib/journal/types';

/* A stand-in for the store: two Maps behind the same interface the real ones
   implement. Faking the driver would prove only that functions were called;
   this way the logic runs for real — the duplicate check, the session expiry,
   the hashing — against something that behaves like a database. */
const users = new Map<string, { id: string; email: string; hash: string; salt: string }>();
const sessions = new Map<string, { user_id: string; created: number }>();

const fake: Backend = {
  kind: 'sqlite',
  async userByEmail(email) {
    return users.get(email) ?? null;
  },
  async createUser(row) {
    users.set(row.email, { id: row.id, email: row.email, hash: row.hash, salt: row.salt });
  },
  async userCount() {
    return users.size;
  },
  async createSession(token, userId, created) {
    sessions.set(token, { user_id: userId, created });
  },
  async sessionOwner(token) {
    const session = sessions.get(token);
    if (!session) return null;
    const owner = [...users.values()].find((u) => u.id === session.user_id);
    return owner ? { id: owner.id, email: owner.email, created: session.created } : null;
  },
  async deleteSession(token) {
    sessions.delete(token);
  },
  async getJournal() {
    return { doc: null as JournalDoc | null, version: 0, updated: 0 };
  },
  async putJournal() {
    return { conflict: false, version: 1, updated: 0 };
  },
  async putBlob() {},
  async recordBlob() {},
  async getBlob() {
    return null;
  },
  async listBlobs() {
    return [];
  },
  async artLookup() {
    return undefined;
  },
  async artStore() {},
};

vi.mock('./backend', () => ({
  backend: async () => fake,
  usingPostgres: () => false,
  connectionString: () => null,
}));

const {
  signup,
  login,
  openSession,
  sessionUser,
  closeSession,
  userCount,
  signupAllowed,
  rateLimited,
  SESSION_DAYS,
} = await import('./auth');

beforeEach(() => {
  users.clear();
  sessions.clear();
  delete process.env.SIGNUP_CODE;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('making an account', () => {
  it('creates one and gives back who you are', async () => {
    const user = await signup('Someone@Example.com ', 'longenough');
    expect(user.email).toBe('someone@example.com'); // trimmed and lowered
    expect(await userCount()).toBe(1);
  });

  it('never stores the password in a readable form', async () => {
    await signup('a@b.co', 'correct horse battery');
    const stored = users.get('a@b.co')!;
    expect(stored.hash).not.toContain('correct');
    expect(stored.hash).toHaveLength(128); // 64 bytes of scrypt, as hex
    expect(stored.salt).toHaveLength(32);
  });

  it('gives two people with the same password different hashes', async () => {
    await signup('one@b.co', 'the same password');
    await signup('two@b.co', 'the same password');
    expect(users.get('one@b.co')!.hash).not.toBe(users.get('two@b.co')!.hash);
  });

  it('refuses an address that is not one', async () => {
    await expect(signup('not-an-address', 'longenough')).rejects.toThrow(/email address/);
  });

  it('refuses a password short enough to guess', async () => {
    await expect(signup('a@b.co', 'short')).rejects.toThrow(/8 characters/);
  });

  it('refuses an address that already has an account', async () => {
    await signup('a@b.co', 'longenough');
    await expect(signup('a@b.co', 'longenough')).rejects.toThrow(/already has an account/);
  });
});

describe('signing in', () => {
  beforeEach(async () => {
    await signup('a@b.co', 'longenough');
  });

  it('lets the right password through', async () => {
    expect((await login('a@b.co', 'longenough')).email).toBe('a@b.co');
  });

  it('turns the wrong password away', async () => {
    await expect(login('a@b.co', 'wrongpassword')).rejects.toThrow(/Wrong email or password/);
  });

  /* A wrong address must not answer faster than a wrong password, or the
     difference tells anyone asking which addresses have accounts. */
  it('says the same thing whether the address exists or not', async () => {
    await expect(login('nobody@b.co', 'longenough')).rejects.toThrow(/Wrong email or password/);
  });
});

describe('sessions', () => {
  it('remembers who a token belongs to', async () => {
    const user = await signup('a@b.co', 'longenough');
    const token = await openSession(user.id);
    expect(await sessionUser(token)).toEqual({ id: user.id, email: 'a@b.co' });
  });

  it('knows nothing about a token it never issued', async () => {
    expect(await sessionUser('made-up')).toBeNull();
    expect(await sessionUser(undefined)).toBeNull();
  });

  it('forgets a session once it is signed out', async () => {
    const user = await signup('a@b.co', 'longenough');
    const token = await openSession(user.id);
    await closeSession(token);
    expect(await sessionUser(token)).toBeNull();
  });

  it('lets a session expire, and clears it out on the way past', async () => {
    const user = await signup('a@b.co', 'longenough');
    const token = await openSession(user.id);

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + (SESSION_DAYS + 1) * 864e5);

    expect(await sessionUser(token)).toBeNull();
    expect(sessions.has(token)).toBe(false);
  });

  it('gives out a different token every time', async () => {
    const user = await signup('a@b.co', 'longenough');
    const a = await openSession(user.id);
    const b = await openSession(user.id);
    expect(a).not.toBe(b);
    expect(a).toHaveLength(64); // 32 bytes, as hex
  });
});

describe('who is allowed to sign up', () => {
  it('is open until the first account exists', async () => {
    expect(await signupAllowed(undefined)).toBe(true);
    await signup('a@b.co', 'longenough');
    expect(await signupAllowed(undefined)).toMatch(/private/);
  });

  it('asks for the code when one is set, whether or not anyone has signed up', async () => {
    process.env.SIGNUP_CODE = 'let-me-in';
    expect(await signupAllowed('let-me-in')).toBe(true);
    expect(await signupAllowed('wrong')).toMatch(/not right/);
    expect(await signupAllowed(undefined)).toMatch(/not right/);
  });
});

describe('slowing down guessing', () => {
  it('allows a reasonable number of attempts, then stops', () => {
    const who = 'someone@' + Math.random();
    for (let i = 0; i < 12; i++) expect(rateLimited(who)).toBe(false);
    expect(rateLimited(who)).toBe(true);
  });

  it('counts each address separately', () => {
    const a = 'a@' + Math.random();
    const b = 'b@' + Math.random();
    for (let i = 0; i < 13; i++) rateLimited(a);
    expect(rateLimited(a)).toBe(true);
    expect(rateLimited(b)).toBe(false);
  });

  it('forgets the attempts once the window has passed', () => {
    const who = 'c@' + Math.random();
    for (let i = 0; i < 13; i++) rateLimited(who);
    expect(rateLimited(who)).toBe(true);

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 16 * 60e3);
    expect(rateLimited(who)).toBe(false);
  });
});
