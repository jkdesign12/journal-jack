import { describe, it, expect } from 'vitest';
import { mergeDocs, mergeMonths, mergedTombstones, tombstone, Stamper, TOMBSTONE_LIFE } from './merge';
import type { Block, JournalDoc, Month } from './types';

/* Real clock values: tombstones are pruned relative to now, so toy numbers
   like 10 and 90 are already older than the horizon and vanish. */
const T = Date.now();

const block = (id: string, over: Partial<Block> = {}): Block => ({
  id,
  kind: 'photo',
  title: id,
  ...over,
});

const month = (blocks: Block[], over: Partial<Month> = {}): Month => ({
  blocks,
  song: null,
  ...over,
});

const doc = (months: Record<string, Month>, over: Partial<JournalDoc> = {}): JournalDoc => ({
  months,
  ...over,
});

describe('merging months', () => {
  it('keeps what either side added', () => {
    const mine = month([block('a')], { updatedAt: T - 200 });
    const theirs = month([block('b')], { updatedAt: T - 300 });
    const out = mergeMonths(mine, theirs)!;
    expect(out.blocks.map((b) => b.id).sort()).toEqual(['a', 'b']);
  });

  it('does not resurrect a block that was deleted on purpose', () => {
    const mine = month([], { updatedAt: T - 100, removed: { a: T - 150 } });
    const theirs = month([block('a')], { updatedAt: T - 400 });
    const out = mergeMonths(mine, theirs)!;
    expect(out.blocks).toHaveLength(0);
    expect(out.removed).toHaveProperty('a');
  });

  it('lets an erase beat anything older than it', () => {
    const mine = month([], { erasedAt: T - 100, updatedAt: T - 100 });
    const theirs = month([block('a'), block('b')], { updatedAt: T - 200 });
    expect(mergeMonths(mine, theirs)!.blocks).toHaveLength(0);
  });

  it('does not let an erase beat work done after it', () => {
    const mine = month([], { erasedAt: T - 900, updatedAt: T - 900 });
    const theirs = month([block('a')], { updatedAt: T - 50 });
    expect(mergeMonths(mine, theirs)!.blocks.map((b) => b.id)).toEqual(['a']);
  });

  it('takes the later mark for a deletion both sides know about', () => {
    expect(mergedTombstones({ a: T - 20 }, { a: T - 5 })).toEqual({ a: T - 5 });
  });

  it('forgets tombstones old enough that no device can still be behind', () => {
    const now = Date.now();
    const out = mergedTombstones({ old: now - TOMBSTONE_LIFE - 1000, fresh: now }, {}, now);
    expect(out).not.toHaveProperty('old');
    expect(out).toHaveProperty('fresh');
  });

  it('marks a removal so the next merge leaves it out', () => {
    const m = month([block('a')]);
    tombstone(m, 'a', 42);
    expect(m.removed).toEqual({ a: 42 });
  });
});

describe('merging colour choices', () => {
  it('takes the colour chosen later, even from a document saved earlier', () => {
    // the bug this exists to stop: a photo dragged here made this side "newer"
    const mine = doc({}, {
      updatedAt: 5000,
      yearColours: { '2026': { bg: '#0000ff', at: 1000 } },
    });
    const theirs = doc({}, {
      updatedAt: 100,
      yearColours: { '2026': { bg: '#ff0000', at: 4000 } },
    });
    mergeDocs(mine, theirs);
    expect(mine.yearColours!['2026'].bg).toBe('#ff0000');
  });

  it('keeps a newer local colour when the account holds an older one', () => {
    const mine = doc({}, { updatedAt: 10, yearColours: { '2026': { bg: '#111', at: 9000 } } });
    const theirs = doc({}, { updatedAt: 99999, yearColours: { '2026': { bg: '#222', at: 100 } } });
    mergeDocs(mine, theirs);
    expect(mine.yearColours!['2026'].bg).toBe('#111');
  });

  it('lets two devices colour different years', () => {
    const mine = doc({}, { updatedAt: 500, yearColours: { '2026': { bg: '#aaa', at: 500 } } });
    const theirs = doc({}, { updatedAt: 400, yearColours: { '2025': { bg: '#bbb', at: 400 } } });
    mergeDocs(mine, theirs);
    expect(mine.yearColours!['2026'].bg).toBe('#aaa');
    expect(mine.yearColours!['2025'].bg).toBe('#bbb');
  });

  it('moves the shadow settings as one group, by their own stamp', () => {
    const mine = doc({}, { updatedAt: 9000, shadowAll: false, shadowAt: 10 });
    const theirs = doc({}, {
      updatedAt: 20,
      shadowAll: true,
      shadowGlobal: { shadow: true, shadowY: 12 },
      shadowAt: 900,
    });
    mergeDocs(mine, theirs);
    expect(mine.shadowAll).toBe(true);
    expect(mine.shadowGlobal).toEqual({ shadow: true, shadowY: 12 });
  });

  it('fills in settings this side never had, without taking the rest', () => {
    const mine = doc({}, { updatedAt: 9000, paletteAt: 9000 });
    const theirs = doc({}, { updatedAt: 20, customColours: [{ bg: '#123' }], paletteAt: 20 });
    mergeDocs(mine, theirs);
    expect(mine.customColours).toEqual([{ bg: '#123' }]);
  });
});

describe('stamping', () => {
  it('stamps a month whose blocks changed, and leaves the others alone', () => {
    const d = doc({ '2026-01': month([block('a')]), '2026-02': month([block('b')]) });
    const s = new Stamper();
    s.reset(d);
    d.months['2026-01'].blocks.push(block('c'));
    s.stamp(d, 777);
    expect(d.months['2026-01'].updatedAt).toBe(777);
    expect(d.months['2026-02'].updatedAt).toBeUndefined();
  });

  it("stamps a month whose own shadow changed", () => {
    const d = doc({ '2026-01': month([block('a')]) });
    const s = new Stamper();
    s.reset(d);
    d.months['2026-01'].shadow = true;
    s.stamp(d, 888);
    expect(d.months['2026-01'].updatedAt).toBe(888);
  });

  it('stamps a colour the moment it is chosen', () => {
    const d = doc({});
    const s = new Stamper();
    s.reset(d);
    d.yearColours = { '2026': { bg: '#fff', ink: '#000' } };
    s.stamp(d, 555);
    expect(d.yearColours['2026'].at).toBe(555);
  });

  it('does not stamp anything when nothing changed', () => {
    const d = doc({ '2026-01': month([block('a')]) }, { yearColours: { '2026': { bg: '#fff', at: 1 } } });
    const s = new Stamper();
    s.reset(d);
    s.stamp(d, 999);
    expect(d.months['2026-01'].updatedAt).toBeUndefined();
    expect(d.yearColours!['2026'].at).toBe(1);
  });

  it('ignores a year with no colour in it, so an empty one cannot win a merge', () => {
    const d = doc({}, { yearColours: { '2026': {} } });
    const s = new Stamper();
    s.reset(d);
    s.stamp(d, 1234);
    expect(d.yearColours!['2026'].at).toBeUndefined();
  });
});
