import { describe, it, expect } from 'vitest';
import { effectiveSort, everyBlock, groupByMonth, journalSpan, orderedBlocks } from './sort';
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

describe('grouping everything by month', () => {
  const b = (id: string, date: string | null): Block => ({ id, kind: 'media', title: id, date });

  it('puts each thing under the month it belongs to', () => {
    const groups = groupByMonth([
      b('june', '2020-06-11'),
      b('may', '2020-05-02'),
      b('june2', '2020-06-29'),
    ]);

    expect(groups.map((g) => g.key)).toEqual(['2020-05', '2020-06']);
    expect(groups[1].blocks.map((x) => x.id)).toEqual(['june', 'june2']);
  });

  /* The wireframe reads down the page in the order things happened, so the
     sections run forwards and so does each section inside itself. */
  it('runs oldest month first, and oldest first inside a month', () => {
    const groups = groupByMonth([
      b('later', '2026-03-20'),
      b('earlier', '2019-11-02'),
      b('middle', '2026-03-01'),
    ]);

    expect(groups.map((g) => g.key)).toEqual(['2019-11', '2026-03']);
    expect(groups[1].blocks.map((x) => x.id)).toEqual(['middle', 'later']);
  });

  it('names each month the way the header does', () => {
    expect(groupByMonth([b('a', '2020-05-02')])[0].label).toBe('May 2020');
    expect(groupByMonth([b('a', '2026-12-31')])[0].label).toBe('December 2026');
  });

  /* Something with no date has no month to sit under, but hiding it would be
     worse than putting it at the end where it can be found and dated. */
  it('collects undated things at the end, under their own heading', () => {
    const groups = groupByMonth([b('loose', null), b('dated', '2020-05-02')]);
    expect(groups.map((g) => g.label)).toEqual(['May 2020', 'No date']);
    expect(groups[1].blocks.map((x) => x.id)).toEqual(['loose']);
  });

  it('says nothing at all about an empty journal', () => {
    expect(groupByMonth([])).toEqual([]);
  });

  it('leaves out a month heading nothing falls under', () => {
    const groups = groupByMonth([b('a', '2020-05-02'), b('b', '2020-07-02')]);
    expect(groups.map((g) => g.key)).toEqual(['2020-05', '2020-07']);
  });
});

describe('choosing the order', () => {
  /* Grouping by month is about reading the whole journal. In one month it
     would be a single heading repeating the one already at the top, so it
     falls back the way custom order does. */
  it('groups by month only in the everything view', () => {
    expect(effectiveSort('month', true)).toBe('month');
    expect(effectiveSort('month', false)).toBe('-date');
  });
});
