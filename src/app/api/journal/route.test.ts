import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { JournalDoc } from '@/lib/journal/types';

/* The routes are thin on purpose, so what is worth checking is the contract
   they promise the client: refuse anyone who is not signed in, and answer a
   stale push with 409 and the newer document rather than overwriting it. */
const state = {
  user: null as { id: string; email: string } | null,
  stored: null as { doc: JournalDoc | null; version: number; updated: number } | null,
  conflictNext: false,
};

vi.mock('@/lib/server/auth', () => ({
  currentUser: async () => state.user,
}));

vi.mock('@/lib/server/journal', () => ({
  getJournal: async () => state.stored ?? { doc: null, version: 0, updated: 0 },
  putJournal: async (_id: string, doc: JournalDoc) => {
    if (state.conflictNext) {
      return { conflict: true, doc: state.stored?.doc ?? null, version: 9, updated: 1 };
    }
    const version = (state.stored?.version ?? 0) + 1;
    state.stored = { doc, version, updated: 2 };
    return { conflict: false, version, updated: 2 };
  },
}));

const { GET, PUT } = await import('./route');

const put = (body: unknown) =>
  PUT(new Request('http://localhost/api/journal', { method: 'PUT', body: JSON.stringify(body) }));

beforeEach(() => {
  state.user = { id: 'u1', email: 'a@b.co' };
  state.stored = null;
  state.conflictNext = false;
});

describe('reading the journal', () => {
  it('turns away anyone who is not signed in', async () => {
    state.user = null;
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('hands back an empty journal for a new account', async () => {
    const res = await GET();
    expect(await res.json()).toEqual({ doc: null, version: 0, updated: 0 });
  });
});

describe('writing the journal', () => {
  it('turns away anyone who is not signed in', async () => {
    state.user = null;
    expect((await put({ doc: { months: {} } })).status).toBe(401);
  });

  it('refuses a request with no document in it', async () => {
    const res = await put({ baseVersion: 1 });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/No document/);
  });

  it('survives a body that is not JSON at all', async () => {
    const res = await PUT(
      new Request('http://localhost/api/journal', { method: 'PUT', body: 'not json' }),
    );
    expect(res.status).toBe(400);
  });

  it('stores a document and gives back the new version', async () => {
    const res = await put({ doc: { months: {} }, baseVersion: 0 });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ conflict: false, version: 1 });
  });

  /* 409 is the signal to merge and try again, not an error to show anyone: the
     newer document comes back with it so the client has something to merge. */
  it('answers a stale push with 409 and the newer document', async () => {
    state.stored = { doc: { months: { '2026-09': { blocks: [] } } }, version: 9, updated: 1 };
    state.conflictNext = true;

    const res = await put({ doc: { months: {} }, baseVersion: 2 });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.conflict).toBe(true);
    expect(body.doc).toEqual({ months: { '2026-09': { blocks: [] } } });
  });
});
