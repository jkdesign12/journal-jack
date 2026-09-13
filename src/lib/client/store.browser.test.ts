/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { JournalStore } from './store';
import { DB } from './db';
import type { JournalDoc } from '@/lib/journal/types';

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('the journal while the app is running', () => {
  beforeEach(async () => {
    await DB.init();
    await DB.clearState();
    sessionStorage.clear();
    localStorage.clear();
  });

  it('starts empty, with this month on the cursor', async () => {
    const store = new JournalStore();
    await store.init();
    expect(store.ready).toBe(true);
    expect(store.doc.months).toEqual({});
    expect(store.view.cursor).toMatch(/^\d{4}-\d{2}$/);
  });

  it('makes a month the first time something needs one', async () => {
    const store = new JournalStore();
    await store.init();
    const m = store.month('2026-09');
    m.blocks.push({ id: 'a', kind: 'photo' });
    expect(store.doc.months['2026-09'].blocks).toHaveLength(1);
  });

  it('tells React something changed without diffing the document', async () => {
    const store = new JournalStore();
    await store.init();
    const before = store.getSnapshot();
    store.save();
    expect(store.getSnapshot()).toBeGreaterThan(before);
  });

  it('writes the journal to this device', async () => {
    const store = new JournalStore();
    await store.init();
    store.month('2026-09').blocks.push({ id: 'a', kind: 'photo', title: 'A photo' });
    await store.flush();

    const onDisk = await DB.loadState();
    expect(onDisk!.months['2026-09'].blocks[0].title).toBe('A photo');
  });

  it('keeps what another tab wrote while this one was editing', async () => {
    const store = new JournalStore();
    await store.init();
    store.month('2026-09').blocks.push({ id: 'mine', kind: 'photo' });

    // another tab saves a different month in the meantime
    const other: JournalDoc = {
      months: { '2026-08': { blocks: [{ id: 'theirs', kind: 'photo' }], updatedAt: Date.now() } },
      updatedAt: Date.now(),
    };
    await DB.saveState(other);

    await store.flush();
    const onDisk = await DB.loadState();
    expect(onDisk!.months['2026-09'].blocks[0].id).toBe('mine');
    expect(onDisk!.months['2026-08'].blocks[0].id).toBe('theirs');
  });

  it('stamps only the month that actually changed', async () => {
    const store = new JournalStore();
    await store.init();
    store.month('2026-09').blocks.push({ id: 'a', kind: 'photo' });
    store.month('2026-08'); // looked at, not changed
    await store.flush();

    expect(store.doc.months['2026-09'].updatedAt).toBeTypeOf('number');
    expect(store.doc.months['2026-08'].updatedAt).toBeUndefined();
  });

  it('folds in the account copy rather than replacing anything', async () => {
    const store = new JournalStore();
    await store.init();
    store.month('2026-09').blocks.push({ id: 'local', kind: 'photo' });
    await store.flush();

    await store.mergeRemote({
      months: { '2026-09': { blocks: [{ id: 'remote', kind: 'photo' }], updatedAt: Date.now() } },
      updatedAt: Date.now(),
    });

    const ids = store.doc.months['2026-09'].blocks.map((b) => b.id).sort();
    expect(ids).toEqual(['local', 'remote']);
  });

  it('brings an older journal up to date as it loads it', async () => {
    await DB.saveState({
      months: { '2026-09': { blocks: [{ id: 'a', kind: 'media', source: 'letterboxd' }] } },
    } as JournalDoc);

    const store = new JournalStore();
    await store.init();
    expect(store.doc.months['2026-09'].blocks[0].tags).toEqual(['Movie']);
  });

  it('keeps the view in this tab and out of the journal', async () => {
    const store = new JournalStore();
    await store.init();
    store.setView({ cursor: '2022-06', sort: 'title' });
    await settle();

    expect(JSON.parse(sessionStorage.getItem('journal:view')!).cursor).toBe('2022-06');
    expect(store.doc).not.toHaveProperty('cursor');
  });
});
