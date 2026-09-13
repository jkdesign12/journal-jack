import { describe, it, expect } from 'vitest';
import { effectiveSort, everyBlock, journalSpan, orderedBlocks } from './sort';
import type { Block, JournalDoc } from './types';

const b = (id: string, over: Partial<Block> = {}): Block => ({ id, kind: 'media', title: id, ...over });

describe('ordering a board', () => {
  it('leaves custom order exactly as stored', () => {
    const blocks = [b('c'), b('a'), b('b')];
    expect(orderedBlocks(blocks, 'manual')).toBe(blocks);
  });

  it('puts undated things last when reading oldest first', () => {
    const out = orderedBlocks(
      [b('none'), b('old', { date: '2020-01-01' }), b('new', { date: '2026-01-01' })],
      'date',
    );
    expect(out.map((x) => x.id)).toEqual(['old', 'new', 'none']);
  });

  it('groups by tag, with multi-tag tiles beside their first tag', () => {
    const out = orderedBlocks(
      [
        b('music', { tags: ['Music'] }),
        b('rewatch', { tags: ['Movie', 'Rewatch'] }),
        b('film', { tags: ['Movie'] }),
        b('book', { tags: ['Book'] }),
      ],
      'source',
    );
    expect(out.map((x) => x.id)).toEqual(['book', 'film', 'rewatch', 'music']);
  });

  it('sinks untagged things below every tagged one', () => {
    const out = orderedBlocks(
      [b('loose', { source: 'rss' }), b('film', { tags: ['Movie'] }), b('photo', { kind: 'photo' })],
      'source',
    );
    expect(out[out.length - 1].id).not.toBe('film');
    expect(out[0].id).toBe('film');
  });

  it('falls back to newest first in the everything view', () => {
    expect(effectiveSort('manual', true)).toBe('-date');
    expect(effectiveSort('manual', false)).toBe('manual');
    expect(effectiveSort('title', true)).toBe('title');
  });
});

describe('the span the journal covers', () => {
  const doc = (months: JournalDoc['months']): JournalDoc => ({ months });

  it('counts a month of undated uploads for its own year', () => {
    const d = doc({
      '2019-06': { blocks: [{ id: 'p', kind: 'photo' }] },
      '2026-09': { blocks: [{ id: 'm', kind: 'media', date: '2026-09-01' }] },
    });
    expect(journalSpan(d)).toEqual({ first: '2019', last: '2026' });
  });

  it('ignores a month with nothing in it', () => {
    const d = doc({
      '2020-01': { blocks: [] },
      '2021-03': { blocks: [{ id: 'a', kind: 'media', date: '2021-03-04' }] },
    });
    expect(journalSpan(d).first).toBe('2021');
  });

  it('counts a block dated outside the month it is filed under', () => {
    const d = doc({ '2026-09': { blocks: [{ id: 'a', kind: 'media', date: '2017-04-02' }] } });
    expect(journalSpan(d)).toEqual({ first: '2017', last: '2026' });
  });

  it('says nothing about an empty journal', () => {
    expect(journalSpan(doc({}))).toEqual({ first: undefined, last: undefined });
  });

  it('gathers every block, oldest month first', () => {
    const d = doc({
      '2026-09': { blocks: [b('new')] },
      '2022-02': { blocks: [b('old')] },
    });
    expect(everyBlock(d).map((x) => x.id)).toEqual(['old', 'new']);
  });
});
