/* The board.
 *
 * An infinite artboard made of small squares. A tile occupies a whole number of
 * them, which is what lets a dropped tile shove its neighbours aside cleanly
 * and lets a corner drag snap to something sensible.
 *
 * Everything here is arithmetic on plain objects — no elements, no measuring —
 * so the packing rules can be tested without a browser, and the component that
 * uses them only has to supply a width.
 */

import type { Block, Size, StoredSize } from './types';

/** An album cover is 4x4 of the little squares. */
export const WIDTH_UNITS: Record<Size, number> = { sm: 4, md: 8, lg: 12 };
export const TARGET_UNIT = 46; // preferred size of one little square, in px
export const MIN_UNITS = 2; // nothing smaller than half a cover
export const HEADROOM = 4; // spare rows kept below the lowest tile of a board you can drop onto

/** 'wide' and 'tall' are what much older saves hold. */
export function sizeOf(b: Pick<Block, 'size'>): Size {
  const stored = (b.size ?? 'sm') as StoredSize;
  if (stored === 'wide') return 'md';
  if (stored === 'tall') return 'sm';
  return stored;
}

export const ratioOf = (ratio: number | undefined): number =>
  Math.min(2.6, Math.max(0.3, ratio || 1));

export interface Metrics {
  gap: number;
  units: number;
  unit: number;
  pitch: number;
  px: (n: number) => number;
}

/**
 * How many little squares fit across, and how big each one is.
 *
 * On a narrow screen the natural count lands on something like 7, which fits
 * one 4-unit cover and leaves an awkward stub. Pinning it to 8 makes a phone
 * show two covers per row, with a poster exactly half the width.
 */
export function gridMetrics(width: number, gap = 12): Metrics | null {
  if (!width) return null;
  const units = width < 560 ? 8 : Math.max(2, Math.round((width + gap) / (TARGET_UNIT + gap)));
  const unit = (width - gap * (units - 1)) / units;
  return {
    gap,
    units,
    unit,
    pitch: unit + gap,
    px: (n: number) => n * unit + (n - 1) * gap,
  };
}

export interface Item {
  id: string;
  w: number;
  h: number;
  gx: number;
  gy: number;
}

/** A tile is sized from its own proportions unless a corner was dragged. */
export function unitsOf(b: Block, m: Metrics): { w: number; h: number } {
  const custom = b.uw ?? 0;
  const w = Math.min(m.units, Math.max(MIN_UNITS, custom || WIDTH_UNITS[sizeOf(b)] || 4));
  const h = b.uh
    ? Math.max(MIN_UNITS, b.uh)
    : Math.max(1, Math.round((m.px(w) * ratioOf(guessRatio(b)) + m.gap) / m.pitch));
  return { w, h };
}

export const hits = (a: Item, b: Item): boolean =>
  a.gx < b.gx + b.w && b.gx < a.gx + a.w && a.gy < b.gy + b.h && b.gy < a.gy + a.h;

/** First gap big enough, scanning left to right, top to bottom. */
export function firstFree(
  placed: Item[],
  w: number,
  h: number,
  units: number,
): { gx: number; gy: number } {
  for (let gy = 0; gy < 400; gy++) {
    for (let gx = 0; gx + w <= units; gx++) {
      const probe = { id: '', gx, gy, w, h };
      if (!placed.some((p) => hits(probe, p))) return { gx, gy };
    }
  }
  return { gx: 0, gy: 0 };
}

/** Shove whatever the moved tile landed on down, and whatever that lands on. */
export function pushOthers(items: Item[], moved: Item): void {
  const queue: Item[] = [moved];
  let guard = 0;
  while (queue.length && guard++ < 800) {
    const cur = queue.shift()!;
    for (const other of items) {
      if (other === cur || other === moved) continue;
      if (hits(cur, other)) {
        other.gy = cur.gy + cur.h;
        queue.push(other);
      }
    }
  }
}

/**
 * Used by the sort modes, which are a view rather than a placement: pack tight
 * and ignore the stored coordinates.
 */
export function autoFlow(items: Item[], units: number): void {
  const bottoms = new Array(units).fill(0);
  for (const it of items) {
    let at = 0;
    let top = Infinity;
    for (let i = 0; i + it.w <= units; i++) {
      const candidate = Math.max(...bottoms.slice(i, i + it.w));
      if (candidate < top - 0.001) {
        top = candidate;
        at = i;
      }
    }
    it.gx = at;
    it.gy = top;
    for (let i = at; i < at + it.w; i++) bottoms[i] = top + it.h;
  }
}

/**
 * Nudge apart anything overlapping — a tile grown to Large, or a board narrowed
 * by a window resize.
 *
 * Deliberately display-only: the caller must not write these coordinates back
 * to the blocks. The place you dragged a tile to is its anchor, and only
 * another drag changes it. So sizing an album up shoves its neighbours aside
 * while it is big, and sizing it back down puts every one of them back exactly
 * where it was.
 */
export function settle(items: Item[], lastTouched?: string | null): void {
  /* Reading order decides who yields, except that the tile just moved or scaled
     always wins — you put it there, so everything else works around it. */
  const order = [...items].sort((a, b) => {
    const at = a.id === lastTouched ? 0 : 1;
    const bt = b.id === lastTouched ? 0 : 1;
    return at - bt || a.gy - b.gy || a.gx - b.gx;
  });

  for (let i = 0; i < order.length; i++) {
    for (let j = 0; j < i; j++) {
      if (hits(order[i], order[j])) {
        order[i].gy = order[j].gy + order[j].h;
        j = -1; // recheck against everything
      }
    }
  }
}

/**
 * Where every tile goes for one render.
 *
 * `manual` keeps each block's own anchor and only settles overlaps for display;
 * any other order packs tight. Returns the items plus the height the board
 * needs, so the caller never measures anything itself.
 */
export function layout(
  blocks: Block[],
  m: Metrics,
  opts: { manual: boolean; lastTouched?: string | null },
): { items: Item[]; rows: number } {
  const items: Item[] = blocks.map((b) => {
    const { w, h } = unitsOf(b, m);
    return { id: b.id, w, h, gx: b.gx ?? -1, gy: b.gy ?? -1 };
  });

  if (!opts.manual) {
    autoFlow(items, m.units);
  } else {
    const placed: Item[] = [];
    for (const it of items) {
      if (Number.isInteger(it.gx) && it.gx >= 0 && Number.isInteger(it.gy) && it.gy >= 0) {
        it.gx = Math.max(0, Math.min(it.gx, m.units - it.w));
        placed.push(it);
      }
    }
    for (const it of items) {
      if (placed.includes(it)) continue;
      const spot = firstFree(placed, it.w, it.h, m.units); // a newly imported tile
      it.gx = spot.gx;
      it.gy = spot.gy;
      placed.push(it);
    }
    settle(items, opts.lastTouched);
  }

  /* The spare rows are somewhere to drop a tile below the last one, so they only
     earn their height on a board you can drop onto. A sorted board ends at its
     last tile — anything past that is a hole in the page, and in the month view
     it was a hole under every single heading. */
  let lowest = 0;
  for (const it of items) lowest = Math.max(lowest, it.gy + it.h);
  return { items, rows: lowest + (opts.manual ? HEADROOM : 0) };
}

/* Height ÷ width for a block before its image has loaded. A film poster is
   2:3, an album cover is square, and each widget has a shape it wants — so a
   board can be laid out correctly on the first paint rather than jumping about
   as pictures arrive. A measured ratio always wins over a guess. */
const RATIOS: Record<string, number> = {
  letterboxd: 3 / 2,
  heading: 0.42,
  quote: 0.75,
  note: 1,
  link: 0.62,
  checklist: 1.35,
  palette: 0.8,
  stats: 1,
};

export function guessRatio(b: Pick<Block, 'kind' | 'source' | 'ratio'>): number {
  if (b.ratio) return b.ratio;
  if (b.kind === 'media') return RATIOS[b.source ?? ''] ?? 1; // album art is square
  if (b.kind === 'photo') return 1;
  return RATIOS[b.kind] ?? 1;
}
