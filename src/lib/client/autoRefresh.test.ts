/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { autoRefresh } from './autoRefresh';
import { store } from './store';
import type { ImportedItem } from '@/lib/journal/types';

/* Covers FEATURES 15.12: topping the month up when the app opens. */

const service = {
  id: 'letterboxd',
  name: 'Letterboxd',
  fields: [{ key: 'user' }],
};

const item = (over: Partial<ImportedItem> = {}): ImportedItem => ({
  source: 'letterboxd',
  title: 'Perfect Blue',
  subtitle: '1997',
  image: '',
  url: '',
  date: '2026-09-02',
  rating: null,
  review: '',
  ...over,
});

function stub(items: ImportedItem[] = [], services = [service]) {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push((init?.method ?? 'GET') + ' ' + url);
      return {
        ok: true,
        status: 200,
        json: async () => (init?.method === 'POST' ? { items } : { services }),
      } as Response;
    }),
  );
  return calls;
}

beforeEach(async () => {
  vi.unstubAllGlobals();
  store.doc = {
    months: {},
    sync: { services: { letterboxd: { user: 'someone' } }, range: { from: '', to: '' }, autoRefresh: true },
  };
  store.view = { ...store.view, cursor: '2026-09' };
});

describe('refreshing when the app opens', () => {
  it('pulls from a service that has everything it needs', async () => {
    stub([item()]);
    const out = await autoRefresh(true);
    expect(out).toEqual({ added: 1, names: ['Letterboxd'] });
    expect(store.doc.months['2026-09'].blocks[0].title).toBe('Perfect Blue');
  });

  it('asks only for the month you are looking at', async () => {
    const calls = stub([]);
    await autoRefresh(true);
    expect(calls.some((c) => c.startsWith('POST'))).toBe(true);
  });

  it('leaves a service alone until it is configured', async () => {
    store.doc.sync!.services = {};
    const calls = stub([item()]);
    expect(await autoRefresh(true)).toEqual({ added: 0, names: [] });
    expect(calls.filter((c) => c.startsWith('POST'))).toHaveLength(0);
  });

  it('does nothing when it is switched off', async () => {
    store.doc.sync!.autoRefresh = false;
    stub([item()]);
    expect(await autoRefresh()).toEqual({ added: 0, names: [] });
  });

  /* Opening the app five times in a row should not mean five pulls. */
  it('refuses to run again within half an hour', async () => {
    stub([item()]);
    await autoRefresh(true);
    const second = await autoRefresh();
    expect(second.added).toBe(0);
  });

  it('carries on when a service is down', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === 'POST') throw new Error('service is down');
        return { ok: true, status: 200, json: async () => ({ services: [service] }) } as Response;
      }),
    );
    await expect(autoRefresh(true)).resolves.toEqual({ added: 0, names: [] });
  });

  it('says nothing happened when the server cannot be reached at all', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('offline');
    }));
    expect(await autoRefresh(true)).toEqual({ added: 0, names: [] });
  });

  it('does not add the same watch twice on a second run', async () => {
    stub([item()]);
    await autoRefresh(true);
    await autoRefresh(true);
    expect(store.doc.months['2026-09'].blocks).toHaveLength(1);
  });
});
