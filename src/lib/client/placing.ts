'use client';

import { MIN_UNITS, firstFree, hits, pushOthers, type Item, type Metrics } from '@/lib/journal/layout';
import type { Block } from '@/lib/journal/types';

/* Moving and resizing a tile by hand.
 *
 * Both work in whole grid units and in deltas from where the pointer started,
 * never in absolute cells: a tile's anchor and the cell it is drawn in can
 * differ — something bigger may be temporarily pushing it down — and mixing
 * the two spaces is what makes an edge drift when you drag the opposite corner.
 */

export type Corner = 'nw' | 'ne' | 'sw' | 'se';

/** A finger dragging across a tile means "scroll", so this is for a mouse. */
export const coarsePointer = () =>
  typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

export interface PlaceResult {
  gx: number;
  gy: number;
}

/** Where a tile dropped at this pixel offset lands, in grid units. */
export function dropAt(x: number, y: number, m: Metrics, width: number): PlaceResult {
  const gx = Math.max(0, Math.min(Math.round(x / m.pitch), m.units - width));
  const gy = Math.max(0, Math.round(y / m.pitch));
  return { gx, gy };
}

/**
 * Commit a move: the tile takes the spot, and whatever it landed on is shoved
 * down — and whatever that lands on, and so on.
 */
export function commitMove(items: Item[], moved: Item, to: PlaceResult, blocks: Map<string, Block>) {
  moved.gx = to.gx;
  moved.gy = to.gy;
  pushOthers(items, moved);

  for (const it of items) {
    const b = blocks.get(it.id);
    if (!b) continue;
    b.gx = it.gx;
    b.gy = it.gy;
  }
}

export interface ResizeStart {
  w: number;
  h: number;
  anchorX: number;
  anchorY: number;
  units: number;
}

/**
 * The size and origin a corner drag arrives at.
 *
 * Dragging a north or west corner moves the tile's origin as well as its size,
 * which is what makes the opposite corner stay put.
 */
export function resizeTo(
  start: ResizeStart,
  corner: Corner,
  dxUnits: number,
  dyUnits: number,
): { w: number; h: number; gx: number; gy: number } {
  let w = start.w;
  let h = start.h;
  let dx = 0;
  let dy = 0;

  if (corner.includes('e')) w = Math.max(MIN_UNITS, Math.min(start.units - start.anchorX, start.w + dxUnits));
  if (corner.includes('s')) h = Math.max(MIN_UNITS, start.h + dyUnits);

  if (corner.includes('w')) {
    dx = Math.min(start.w - MIN_UNITS, Math.max(-start.anchorX, dxUnits)); // keep the east edge still
    w = start.w - dx;
  }
  if (corner.includes('n')) {
    dy = Math.min(start.h - MIN_UNITS, Math.max(-start.anchorY, dyUnits)); // keep the south edge still
    h = start.h - dy;
  }

  return { w, h, gx: start.anchorX + dx, gy: start.anchorY + dy };
}

/**
 * Forget every hand-placed coordinate in a month and pack it again.
 * Sizes are left alone — that is a separate decision from where a tile sits,
 * and losing them to a layout reset would be a nasty surprise.
 */
export function resetLayout(blocks: Block[], m: Metrics, sized: (b: Block) => { w: number; h: number }) {
  const placed: Item[] = [];
  let moved = 0;

  for (const b of blocks) {
    if (Number.isInteger(b.gx) || Number.isInteger(b.gy)) moved++;
    delete b.gx;
    delete b.gy;
  }

  for (const b of blocks) {
    const { w, h } = sized(b);
    const spot = firstFree(placed, w, h, m.units);
    b.gx = spot.gx;
    b.gy = spot.gy;
    placed.push({ id: b.id, w, h, gx: spot.gx, gy: spot.gy });
  }
  return moved;
}

export { hits };
