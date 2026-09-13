import { describe, it, expect } from 'vitest';
import {
  autoFlow,
  firstFree,
  gridMetrics,
  hits,
  layout,
  pushOthers,
  ratioOf,
  settle,
  sizeOf,
  unitsOf,
  type Item,
} from './layout';
import type { Block } from './types';

const item = (id: string, gx: number, gy: number, w = 4, h = 4): Item => ({ id, gx, gy, w, h });

describe('measuring the board', () => {
  it('pins a phone to eight squares, so two covers fit a row', () => {
    const m = gridMetrics(375)!;
    expect(m.units).toBe(8);
  });

  it('scales the count with the width on a desktop', () => {
    expect(gridMetrics(1200)!.units).toBeGreaterThan(16);
  });

  it('has nothing to say about a board with no width yet', () => {
    expect(gridMetrics(0)).toBeNull();
  });

  it('makes the squares add up to the width, gaps included', () => {
    const m = gridMetrics(1000, 12)!;
    expect(m.px(m.units)).toBeCloseTo(1000, 6);
  });
});

describe('the size of one tile', () => {
  const m = gridMetrics(1000)!;

  it('gives an album four squares across', () => {
    expect(unitsOf({ id: 'a', kind: 'media', size: 'sm' }, m).w).toBe(4);
  });

  it('reads the sizes older saves used', () => {
    expect(sizeOf({ size: 'wide' })).toBe('md');
    expect(sizeOf({ size: 'tall' })).toBe('sm');
    expect(sizeOf({})).toBe('sm');
  });

  it('lets a corner drag beat the tile’s own proportions', () => {
    const b: Block = { id: 'a', kind: 'media', size: 'sm', uw: 7, uh: 3 };
    expect(unitsOf(b, m)).toEqual({ w: 7, h: 3 });
  });

  it('makes a poster taller than an album', () => {
    const album = unitsOf({ id: 'a', kind: 'media', ratio: 1 }, m);
    const poster = unitsOf({ id: 'p', kind: 'media', ratio: 1.5 }, m);
    expect(poster.h).toBeGreaterThan(album.h);
  });

  it('refuses a ratio that would make a tile absurd', () => {
    expect(ratioOf(99)).toBe(2.6);
    expect(ratioOf(0.01)).toBe(0.3);
    expect(ratioOf(undefined)).toBe(1);
  });

  it('never lets a tile grow wider than the board', () => {
    const narrow = gridMetrics(375)!;
    expect(unitsOf({ id: 'a', kind: 'media', size: 'lg' }, narrow).w).toBe(narrow.units);
  });
});

describe('packing', () => {
  it('knows when two tiles overlap', () => {
    expect(hits(item('a', 0, 0), item('b', 2, 2))).toBe(true);
    expect(hits(item('a', 0, 0), item('b', 4, 0))).toBe(false);
    expect(hits(item('a', 0, 0), item('b', 0, 4))).toBe(false);
  });

  it('finds the first gap that fits, reading left to right', () => {
    const placed = [item('a', 0, 0), item('b', 4, 0)];
    expect(firstFree(placed, 4, 4, 12)).toEqual({ gx: 8, gy: 0 });
  });

  it('drops to the next row when the first is full', () => {
    const placed = [item('a', 0, 0), item('b', 4, 0)];
    expect(firstFree(placed, 4, 4, 8)).toEqual({ gx: 0, gy: 4 });
  });

  it('packs tight when the board is sorted rather than placed', () => {
    const items = [item('a', -1, -1), item('b', -1, -1), item('c', -1, -1)];
    autoFlow(items, 8);
    expect(items.map((i) => [i.gx, i.gy])).toEqual([
      [0, 0],
      [4, 0],
      [0, 4],
    ]);
  });

  it('shoves a tile down out of the way of one dropped on it', () => {
    const moved = item('moved', 0, 0);
    const sitting = item('sitting', 2, 2);
    pushOthers([moved, sitting], moved);
    expect(sitting.gy).toBe(4);
  });

  it('shoves what the shoved tile then lands on', () => {
    const moved = item('moved', 0, 0);
    const first = item('first', 0, 2);
    const second = item('second', 0, 5);
    pushOthers([moved, first, second], moved);
    expect(first.gy).toBe(4);
    expect(second.gy).toBe(8);
  });

  it('lets the tile you just touched keep its place', () => {
    const touched = item('touched', 0, 4);
    const other = item('other', 0, 2);
    settle([other, touched], 'touched');
    expect(touched.gy).toBe(4);
    expect(other.gy).toBe(8);
  });
});

describe('laying out a whole board', () => {
  const m = gridMetrics(1000)!;
  const block = (id: string, over: Partial<Block> = {}): Block => ({
    id,
    kind: 'media',
    size: 'sm',
    ratio: 1,
    ...over,
  });

  it('keeps the places you dragged tiles to', () => {
    const blocks = [block('a', { gx: 8, gy: 0 }), block('b', { gx: 0, gy: 0 })];
    const { items } = layout(blocks, m, { manual: true });
    expect(items.find((i) => i.id === 'a')!.gx).toBe(8);
    expect(items.find((i) => i.id === 'b')!.gx).toBe(0);
  });

  it('finds a spot for a tile that has never been placed', () => {
    const blocks = [block('a', { gx: 0, gy: 0 }), block('fresh')];
    const { items } = layout(blocks, m, { manual: true });
    const fresh = items.find((i) => i.id === 'fresh')!;
    expect(fresh.gx).toBeGreaterThanOrEqual(0);
    expect(hits(fresh, items.find((i) => i.id === 'a')!)).toBe(false);
  });

  it('ignores stored places when the board is sorted', () => {
    const blocks = [block('a', { gx: 20, gy: 40 }), block('b', { gx: 0, gy: 0 })];
    const { items } = layout(blocks, m, { manual: false });
    expect(items[0]).toMatchObject({ gx: 0, gy: 0 });
  });

  it('never writes a display-only nudge back to the block', () => {
    // sizing an album up shoves its neighbours while it is big; sizing it back
    // down has to put every one of them exactly where it was
    const a = block('a', { gx: 0, gy: 0, uw: 8, uh: 8 });
    const b = block('b', { gx: 0, gy: 2 });
    layout([a, b], m, { manual: true });
    expect(b.gy).toBe(2);
    expect(b.gx).toBe(0);
  });

  it('leaves room below the lowest tile to drop things into', () => {
    const { rows } = layout([block('a', { gx: 0, gy: 0 })], m, { manual: true });
    expect(rows).toBeGreaterThan(4);
  });
});

/* The spare rows under a board are somewhere to drop a tile. A sorted board
   takes no drops, so those rows are just a hole in the page — which is what
   put a screenful of nothing under every heading in the month view. */
describe('the room left under a board', () => {
  const m = gridMetrics(1000)!;
  const block = (id: string, over: Partial<Block> = {}): Block => ({ id, kind: 'media', ...over });
  const one = [block('a', { uw: 4, uh: 4 })];

  it('is there on a board you can drop onto', () => {
    const { items, rows } = layout(one, m, { manual: true });
    expect(rows).toBeGreaterThan(items[0].gy + items[0].h);
  });

  it('is not there on a sorted one, which ends at its last tile', () => {
    const { items, rows } = layout(one, m, { manual: false });
    expect(rows).toBe(items[0].gy + items[0].h);
  });
});
