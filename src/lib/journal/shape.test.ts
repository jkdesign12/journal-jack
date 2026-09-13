import { describe, it, expect } from 'vitest';
import { ensureShape } from './shape';
import type { JournalDoc } from './types';

const doc = (over: Partial<JournalDoc> = {}): JournalDoc => ({ months: {}, ...over });

describe('bringing an older journal up to date', () => {
  it('gives an import the tag its source implies', () => {
    const d = doc({
      months: {
        '2026-09': {
          blocks: [
            { id: 'a', kind: 'media', source: 'letterboxd' },
            { id: 'b', kind: 'media', source: 'musicboard' },
            { id: 'c', kind: 'media', source: 'anilist', subtitle: 'MANGA' },
          ],
        },
      },
    });
    ensureShape(d);
    const blocks = d.months['2026-09'].blocks;
    expect(blocks[0].tags).toEqual(['Movie']);
    expect(blocks[1].tags).toEqual(['Music']);
    expect(blocks[2].tags).toEqual(['Manga']);
  });

  it('carries a single tag into the list', () => {
    const d = doc({ months: { m: { blocks: [{ id: 'a', kind: 'media', tag: 'Music' }] } } });
    ensureShape(d);
    expect(d.months.m.blocks[0].tags).toEqual(['Music']);
    expect(d.months.m.blocks[0].tag).toBeUndefined();
  });

  it('leaves a tag you cleared on purpose cleared', () => {
    const d = doc({
      months: { m: { blocks: [{ id: 'a', kind: 'media', source: 'letterboxd', tag: '' }] } },
    });
    ensureShape(d);
    expect(d.months.m.blocks[0].tags).toEqual([]);

    // and again on the next load, now that it is stored as an empty list
    ensureShape(d);
    expect(d.months.m.blocks[0].tags).toEqual([]);
  });

  it('guesses nothing for a photo you uploaded', () => {
    const d = doc({ months: { m: { blocks: [{ id: 'p', kind: 'photo' }] } } });
    ensureShape(d);
    expect(d.months.m.blocks[0].tags).toBeUndefined();
  });

  it('lifts colours from the month they used to live on to their year', () => {
    const d = doc({
      months: {
        '2024-03': { blocks: [], bg: '#111', ink: '#eee' },
        '2024-11': { blocks: [], bg: '#222', ink: '#ddd' },
      },
    });
    ensureShape(d);
    // the later month wins, being the more recent choice
    expect(d.yearColours!['2024']).toEqual({ bg: '#222', ink: '#ddd' });
    expect(d.months['2024-03'].bg).toBeUndefined();
  });

  it('drops view settings that used to travel with the document', () => {
    const d = { months: {}, cursor: '2020-01', sort: 'title', theme: 'light' } as unknown as JournalDoc;
    ensureShape(d);
    expect(d).not.toHaveProperty('cursor');
    expect(d).not.toHaveProperty('sort');
    expect(d).not.toHaveProperty('theme');
  });

  it('fills in the settings a brand new journal needs', () => {
    const d = { months: {} } as JournalDoc;
    ensureShape(d);
    expect(d.sync).toEqual({ services: {}, range: { from: '', to: '' }, autoRefresh: true });
  });
});
