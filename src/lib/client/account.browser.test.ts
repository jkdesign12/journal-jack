/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Account, explainUploadError } from './account';

/** A stand-in for the network: hands back what each route is told to say. */
function stubFetch(routes: Record<string, { status?: number; body?: unknown }>) {
  const calls: Array<{ url: string; method: string }> = [];
  const fetcher = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const method = init.method ?? 'GET';
    calls.push({ url, method });

    const key = Object.keys(routes).find((k) => url.includes(k));
    const route = key ? routes[key] : { status: 404, body: { error: 'No such endpoint' } };
    const status = route.status ?? 200;

    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => route.body ?? {},
      blob: async () => new Blob(['x']),
    } as Response;
  });

  vi.stubGlobal('fetch', fetcher);
  return calls;
}

const big = (mb: number) => new Blob([new Uint8Array(mb * 1024 * 1024)], { type: 'image/jpeg' });

describe('uploading a file to the account', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    Account.user = { id: 'u1', email: 'someone@example.com' };
    Account.version = 0;
  });

  it('sends a small file straight through the site', async () => {
    const calls = stubFetch({ '/api/blob/': { body: { ok: true } } });
    expect(await Account.uploadBlob('f1', new Blob(['small']))).toBe(true);
    expect(calls).toEqual([{ url: '/api/blob/f1', method: 'PUT' }]);
  });

  /* The bug this exists to stop: a file too big to shrink was reported as a
     failure without the upload ever being attempted, which stranded exactly the
     files that most needed sending — Live Photos above all. */
  it('falls back to the ordinary route when there is no direct one', async () => {
    const calls = stubFetch({
      '/api/blob-token': { status: 404, body: { error: 'no token' } },
      '/api/blob/': { body: { ok: true } },
    });

    expect(await Account.uploadBlob('f2', big(5), { loud: true })).toBe(true);
    expect(calls.map((c) => c.url)).toEqual(['/api/blob-token', '/api/blob/f2']);
  });

  it('explains both failures when neither route will take it', async () => {
    stubFetch({
      '/api/blob-token': { status: 404, body: {} },
      '/api/blob/': { status: 413, body: { error: 'Payload too large' } },
    });

    await expect(Account.uploadBlob('f3', big(9), { loud: true })).rejects.toThrow(
      /larger than the host accepts.*ordinary route said.*Payload too large/s,
    );
  });

  it('stays quiet and reports failure when it was not asked to be loud', async () => {
    stubFetch({ '/api/blob/': { status: 500, body: { error: 'boom' } } });
    expect(await Account.uploadBlob('f4', new Blob(['x']))).toBe(false);
  });

  it('does nothing at all when signed out', async () => {
    Account.user = null;
    const calls = stubFetch({ '/api/blob/': { body: { ok: true } } });
    expect(await Account.uploadBlob('f5', new Blob(['x']))).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

describe('pushing the journal', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    Account.user = { id: 'u1', email: 'someone@example.com' };
    Account.version = 3;
  });

  it('reports a conflict rather than throwing, so the caller can merge', async () => {
    stubFetch({
      '/api/journal': { status: 409, body: { conflict: true, version: 9, doc: { months: {} } } },
    });

    const res = await Account.pushDoc({ months: {} });
    expect(res.conflict).toBe(true);
    expect(res.doc).toEqual({ months: {} });
    // and takes the newer version, or every later push is stale as well
    expect(Account.version).toBe(9);
  });

  it('keeps the version the server gives back after a clean push', async () => {
    stubFetch({ '/api/journal': { body: { conflict: false, version: 4 } } });
    expect(await Account.pushDoc({ months: {} })).toEqual({ ok: true, version: 4 });
    expect(Account.version).toBe(4);
  });
});

describe('saying why an upload failed', () => {
  it('turns a missing blob store into something you can act on', () => {
    expect(explainUploadError('No token found: BLOB_READ_WRITE_TOKEN')).toMatch(/Storage, create a Blob store/);
  });

  it('tells you a big file will be resized next time', () => {
    expect(explainUploadError('413 Payload too large')).toMatch(/resized first/);
  });

  it('separates being signed out from being offline', () => {
    expect(explainUploadError('401 not signed in')).toMatch(/Sign in and press sync/);
    expect(explainUploadError('Failed to fetch')).toMatch(/back online/);
  });

  it('passes anything it does not recognise through unchanged', () => {
    expect(explainUploadError('something new went wrong')).toBe('something new went wrong');
  });
});
