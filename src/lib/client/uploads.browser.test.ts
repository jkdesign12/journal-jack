/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { DB } from './db';
import { store } from './store';
import { addFiles, addImageByLink } from './uploads';
import { tagsOf } from '@/lib/journal/tags';

/* Covers FEATURES 10.2: tagging a batch on the way in. */

const png = (name: string) => new File([new Uint8Array([1, 2, 3])], name, { type: 'image/png' });

const added = () => store.doc.months[store.view.cursor]?.blocks ?? [];

beforeEach(async () => {
  await DB.init();
  store.doc = { months: {} };
  store.view = { ...store.view, cursor: '2026-09', all: false };
});

describe('tagging a batch as it is uploaded', () => {
  /* The point of the box in the Add media popup: twenty holiday photos should
     not need twenty trips through the details panel. */
  it('puts the chosen tags on every file in the batch', async () => {
    await addFiles([png('a.png'), png('b.png'), png('c.png')], null, ['Photo', 'Holiday']);
    expect(added()).toHaveLength(3);
    for (const b of added()) expect(tagsOf(b)).toEqual(['Photo', 'Holiday']);
  });

  it('leaves them untagged when nothing was chosen', async () => {
    await addFiles([png('a.png')]);
    expect(tagsOf(added()[0])).toEqual([]);
  });

  /* The same cleaning the details panel does: no blanks, no repeats, and the
     spelling you already use wins over the one you just typed. */
  it('tidies what was typed, and keeps the spelling already in the journal', async () => {
    store.doc = { months: { '2026-08': { blocks: [{ id: 'old', kind: 'media', tags: ['Movie'] }] } } };
    await addFiles([png('a.png')], null, [' movie ', '', 'movie']);
    expect(tagsOf(added()[0])).toEqual(['Movie']);
  });

  it('tags a linked picture too', () => {
    addImageByLink('https://a.test/photo.jpg', ['Photo']);
    expect(tagsOf(added()[0])).toEqual(['Photo']);
  });
});
