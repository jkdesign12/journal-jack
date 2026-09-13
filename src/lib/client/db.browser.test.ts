/** @vitest-environment jsdom */
import { describe, it, expect, beforeAll } from 'vitest';
import 'fake-indexeddb/auto';
import { DB } from './db';
import type { JournalDoc } from '@/lib/journal/types';

const doc = (over: Partial<JournalDoc> = {}): JournalDoc => ({ months: {}, ...over });

describe('the copy on this device', () => {
  beforeAll(async () => {
    await DB.init();
  });

  it('opens the database existing journals are already stored in', async () => {
    // renaming this would strand every film, photo and song in an orphan
    const names = await indexedDB.databases();
    expect(names.map((d) => d.name)).toContain('journal-io');
  });

  it('keeps a document across a save and a load', async () => {
    const saved = doc({ months: { '2026-09': { blocks: [{ id: 'a', kind: 'photo' }] } } });
    expect(await DB.saveState(saved)).toBe(true);
    const back = await DB.loadState();
    expect(back!.months['2026-09'].blocks[0].id).toBe('a');
  });

  it('has nothing to say once the document is cleared', async () => {
    await DB.saveState(doc());
    await DB.clearState();
    expect(await DB.loadState()).toBeNull();
  });

  /* The stand-in database used here does not clone a Blob faithfully — what
     comes back is an empty husk — so these check the wiring: that a file is
     stored under its id, listed, and forgotten when deleted. Whether the bytes
     survive is the browser's own business and is checked against a real one. */
  it('keeps files, and lists what it holds', async () => {
    await DB.putBlob('file-1', new Blob(['hello'], { type: 'text/plain' }));
    expect(await DB.getBlob('file-1')).not.toBeNull();
    expect(await DB.allBlobIds()).toContain('file-1');
  });

  it('forgets a file that was deleted', async () => {
    await DB.putBlob('file-2', new Blob(['x']));
    await DB.delBlob('file-2');
    expect(await DB.getBlob('file-2')).toBeNull();
    expect(await DB.allBlobIds()).not.toContain('file-2');
  });

  it('says nothing rather than throwing for a file it never had', async () => {
    expect(await DB.getBlob('never-existed')).toBeNull();
  });
});
