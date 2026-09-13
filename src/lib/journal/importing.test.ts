import { describe, it, expect } from 'vitest';
import { applyImport, dupKey, filmKey, mergeDuplicates, purgeFeedEntries } from './importing';
import type { Block, ImportedItem, JournalDoc } from './types';

const doc = (months: JournalDoc['months'] = {}): JournalDoc => ({ months });

const item = (over: Partial<ImportedItem> = {}): ImportedItem => ({
  source: 'letterboxd',
  title: 'Perfect Blue',
  subtitle: '1997',
  image: '',
  url: '',
  date: '2026-02-03',
  rating: null,
  review: '',
  ...over,
});

const logged = (over: Partial<Block> = {}): Block => ({
  id: Math.random().toString(36).slice(2),
  kind: 'media',
  title: 'Perfect Blue',
  subtitle: '1997',
  source: 'letterboxd',
  origin: 'export',
  ...over,
});

describe('landing an import', () => {
  it('files each row under the month its date belongs to', () => {
    const d = doc();
    applyImport(d, [item({ date: '2026-02-03' }), item({ date: '2024-07-20' })], {
      cursor: '2026-09',
    });
    expect(Object.keys(d.months).sort()).toEqual(['2024-07', '2026-02']);
  });

  it('tags an import from what it is', () => {
    const d = doc();
    applyImport(d, [item()], { cursor: '2026-09' });
    expect(d.months['2026-02'].blocks[0].tags).toEqual(['Movie']);
  });

  it('does not add the same watch twice', () => {
    const d = doc();
    applyImport(d, [item()], { cursor: '2026-09' });
    const second = applyImport(d, [item()], { cursor: '2026-09' });
    expect(second.added).toBe(0);
    expect(d.months['2026-02'].blocks).toHaveLength(1);
  });

  it('fills in what a re-pull carries and the first one lacked', () => {
    const d = doc();
    applyImport(d, [item()], { cursor: '2026-09' });
    const again = applyImport(d, [item({ review: 'written later', rating: 4.5 })], {
      cursor: '2026-09',
    });
    expect(again.enriched).toBe(1);
    expect(d.months['2026-02'].blocks[0].note).toBe('written later');
    expect(d.months['2026-02'].blocks[0].rating).toBe(4.5);
  });

  it('never overwrites a note you wrote yourself', () => {
    const d = doc();
    applyImport(d, [item({ review: 'mine' })], { cursor: '2026-09' });
    applyImport(d, [item({ review: 'theirs' })], { cursor: '2026-09' });
    expect(d.months['2026-02'].blocks[0].note).toBe('mine');
  });
});

describe('what counts as the same thing', () => {
  it('tells two watches of one film apart by their day', () => {
    const feb3 = logged({ date: '2026-02-03' });
    const feb14 = logged({ date: '2026-02-14' });
    expect(filmKey(feb3)).toBe(filmKey(feb14)); // the same film
    expect(dupKey(feb3)).not.toBe(dupKey(feb14)); // a different watch
  });
});

describe('merging duplicates', () => {
  /* The bug this exists to stop: the key ignored the date, so every rewatch was
     deleted as a copy of the first one. */
  it('keeps every rewatch', () => {
    const d = doc({
      '2026-02': {
        blocks: [
          logged({ date: '2026-02-03' }),
          logged({ date: '2026-02-14' }),
          logged({ date: '2026-02-20' }),
        ],
      },
      '2026-03': { blocks: [logged({ date: '2026-03-01' })] },
    });
    expect(mergeDuplicates(d)).toBe(0);
    expect(d.months['2026-02'].blocks).toHaveLength(3);
    expect(d.months['2026-03'].blocks).toHaveLength(1);
  });

  it('collapses the feed copy of a watch the export also has', () => {
    const d = doc({
      '2026-02': {
        blocks: [
          logged({ date: '2026-02-03', origin: 'export', note: 'my review' }),
          logged({ date: '2026-02-03', origin: 'feed', src: 'poster.jpg' }),
        ],
      },
    });
    expect(mergeDuplicates(d)).toBe(1);
    const kept = d.months['2026-02'].blocks[0];
    expect(kept.origin).toBe('export');
    expect(kept.note).toBe('my review');
    expect(kept.src).toBe('poster.jpg'); // the feed's one gift
  });

  it('leaves two logs made on one day by the same export alone', () => {
    const d = doc({
      '2026-02': {
        blocks: [logged({ date: '2026-02-03' }), logged({ date: '2026-02-03' })],
      },
    });
    expect(mergeDuplicates(d)).toBe(0);
  });

  it('marks what it removed, so a merge cannot bring it back', () => {
    const d = doc({
      '2026-02': {
        blocks: [
          logged({ id: 'keep', date: '2026-02-03', origin: 'export' }),
          logged({ id: 'drop', date: '2026-02-03', origin: 'feed' }),
        ],
      },
    });
    mergeDuplicates(d);
    expect(d.months['2026-02'].removed).toHaveProperty('drop');
  });
});

describe('clearing the feed out after an export lands', () => {
  it('gives the poster to every log of that film, not just the matching one', () => {
    const d = doc({
      '2026-02': {
        blocks: [
          logged({ id: 'a', date: '2026-02-05', origin: 'export' }),
          logged({ id: 'b', date: '2026-02-18', origin: 'export' }),
          logged({ id: 'feed', date: '2026-02-18', origin: 'feed', src: 'poster.jpg' }),
        ],
      },
      '2026-03': { blocks: [logged({ id: 'c', date: '2026-03-09', origin: 'export' })] },
    });

    const out = purgeFeedEntries(d);
    expect(out.removed).toBe(1);
    expect(out.donated).toBe(3);
    expect(d.months['2026-02'].blocks.every((b) => b.src === 'poster.jpg')).toBe(true);
    expect(d.months['2026-03'].blocks[0].src).toBe('poster.jpg');
  });

  it('keeps watches newer than the export', () => {
    const d = doc({
      '2026-02': { blocks: [logged({ date: '2026-02-05', origin: 'export' })] },
      '2026-09': { blocks: [logged({ date: '2026-09-30', origin: 'feed' })] },
    });
    const out = purgeFeedEntries(d);
    expect(out.keptNewer).toBe(1);
    expect(d.months['2026-09'].blocks).toHaveLength(1);
  });

  it('does nothing at all when no export has landed', () => {
    const d = doc({ '2026-02': { blocks: [logged({ origin: 'feed' })] } });
    expect(purgeFeedEntries(d)).toEqual({ removed: 0, donated: 0, keptNewer: 0 });
  });
});
