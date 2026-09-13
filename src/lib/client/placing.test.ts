import { describe, it, expect } from 'vitest';
import { commitMove, dropAt, resetLayout, resizeTo } from './placing';
import { gridMetrics, unitsOf, type Item } from '@/lib/journal/layout';
import type { Block } from '@/lib/journal/types';

/* Covers FEATURES 4.5, 4.6 and 4.9: placing, resizing, and starting again. */

const m = gridMetrics(1000)!;
const item = (id: string, gx: number, gy: number, w = 4, h = 4): Item => ({ id, gx, gy, w, h });

describe('dropping a tile', () => {
  it('snaps to the nearest square', () => {
    expect(dropAt(m.pitch * 2 + 4, m.pitch * 3 - 4, m, 4)).toEqual({ gx: 2, gy: 3 });
  });

  it('will not let a tile hang off the right edge', () => {
    expect(dropAt(m.pitch * 999, 0, m, 4).gx).toBe(m.units - 4);
  });

  it('will not let a tile go above the top', () => {
    expect(dropAt(0, -500, m, 4).gy).toBe(0);
  });

  it('shoves what it lands on downward, and writes the result back', () => {
    const moved = item('moved', 0, 0);
    const sitting = item('sitting', 0, 0);
    const blocks = new Map<string, Block>([
      ['moved', { id: 'moved', kind: 'photo' }],
      ['sitting', { id: 'sitting', kind: 'photo' }],
    ]);

    commitMove([moved, sitting], moved, { gx: 0, gy: 0 }, blocks);

    expect(blocks.get('moved')).toMatchObject({ gx: 0, gy: 0 });
    expect(blocks.get('sitting')!.gy).toBe(4);
  });
});

describe('dragging a corner', () => {
  const start = { w: 4, h: 4, anchorX: 4, anchorY: 4, units: m.units };

  it('grows from the south-east without moving the origin', () => {
    expect(resizeTo(start, 'se', 2, 3)).toEqual({ w: 6, h: 7, gx: 4, gy: 4 });
  });

  /* The point of the north and west corners: the opposite edge stays where it
     is, so the tile grows in the direction you are pulling. */
  it('keeps the east edge still when the west corner is pulled', () => {
    const out = resizeTo(start, 'nw', -2, 0);
    expect(out.gx).toBe(2);
    expect(out.w).toBe(6);
    expect(out.gx + out.w).toBe(start.anchorX + start.w);
  });

  it('keeps the south edge still when the north corner is pulled', () => {
    const out = resizeTo(start, 'nw', 0, -3);
    expect(out.gy).toBe(1);
    expect(out.h).toBe(7);
    expect(out.gy + out.h).toBe(start.anchorY + start.h);
  });

  it('never shrinks below half a cover', () => {
    expect(resizeTo(start, 'se', -99, -99)).toMatchObject({ w: 2, h: 2 });
    expect(resizeTo(start, 'nw', 99, 99).w).toBe(2);
  });

  it('never grows wider than the board', () => {
    expect(resizeTo({ ...start, anchorX: 0 }, 'se', 999, 0).w).toBe(m.units);
  });

  it('never pushes the origin off the left or top', () => {
    const out = resizeTo({ ...start, anchorX: 1, anchorY: 1 }, 'nw', -50, -50);
    expect(out.gx).toBe(0);
    expect(out.gy).toBe(0);
  });
});

describe('resetting a layout', () => {
  const sized = (b: Block) => unitsOf(b, m);
  const block = (id: string, over: Partial<Block> = {}): Block => ({
    id,
    kind: 'media',
    size: 'sm',
    ratio: 1,
    ...over,
  });

  it('counts what had been moved by hand', () => {
    const blocks = [block('a', { gx: 8, gy: 4 }), block('b', { gx: 0, gy: 0 }), block('c')];
    expect(resetLayout(blocks, m, sized)).toBe(2);
  });

  it('packs everything tight, with nothing overlapping', () => {
    const blocks = [block('a', { gx: 12, gy: 9 }), block('b', { gx: 4, gy: 6 })];
    resetLayout(blocks, m, sized);
    expect(blocks[0]).toMatchObject({ gx: 0, gy: 0 });
    expect(blocks[1]!.gy).toBe(0);
    expect(blocks[1]!.gx).toBeGreaterThan(0);
  });

  /* Sizes you chose by hand are a separate decision from where a tile sits, and
     losing them to a layout reset would be a nasty surprise. */
  it('leaves the sizes you chose alone', () => {
    const blocks = [block('a', { gx: 8, gy: 4, uw: 7, uh: 3, size: 'lg' })];
    resetLayout(blocks, m, sized);
    expect(blocks[0].uw).toBe(7);
    expect(blocks[0].uh).toBe(3);
    expect(blocks[0].size).toBe('lg');
  });
});
