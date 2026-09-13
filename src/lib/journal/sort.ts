/* The orders a board can be read in.
 *
 * 'manual' is the stored order of the array — dragging decides it. Every other
 * mode is a view over the same blocks, so switching back loses nothing.
 */

import type { Block, JournalDoc } from './types';
import { tagsOf } from './tags';

export const SORT_MODES = ['manual', 'date', '-date', '-rating', 'title', 'source'] as const;
export type SortMode = (typeof SORT_MODES)[number];

export const SORT_LABELS: Record<SortMode, string> = {
  manual: 'Custom order',
  date: 'Oldest first',
  '-date': 'Newest first',
  '-rating': 'Highest rated',
  title: 'Title A–Z',
  source: 'By tag',
};

type Key = (b: Block) => string | number;

export const SORTS: Record<Exclude<SortMode, 'manual'>, Key> = {
  date: (b) => b.date || '9999-99',
  '-date': (b) => b.date || '0000-00',
  '-rating': (b) => (b.rating == null ? -1 : b.rating),
  title: (b) => (b.title ?? '').toLowerCase(),
  /* Group by what a thing is. Where a tile has several tags they order within
     their first one, so "Movie" sits next to "Movie · Rewatch". Anything
     untagged falls back to where it came from and sinks below the tagged ones,
     so an unsorted tail never splits a group in half. */
  source: (b) => {
    const tags = tagsOf(b);
    if (tags.length) return tags.join(' · ').toLowerCase();
    return '￿' + (b.source || b.kind || '');
  },
};

/**
 * Placing tiles by hand is a per-month arrangement — a tile's position means
 * nothing outside the month it belongs to — so the everything view is always
 * sorted, and "custom order" falls back to newest first while it is on.
 */
export const effectiveSort = (mode: SortMode, allMonths: boolean): SortMode =>
  allMonths && mode === 'manual' ? '-date' : mode;

export function orderedBlocks(blocks: Block[], mode: SortMode): Block[] {
  if (mode === 'manual') return blocks;
  const key = SORTS[mode];
  const dir = mode.startsWith('-') ? -1 : 1;
  return [...blocks].sort((a, b) => {
    const x = key(a);
    const y = key(b);
    return x < y ? -dir : x > y ? dir : 0;
  });
}

/** Every block in the journal, oldest month first. */
export function everyBlock(doc: JournalDoc): Block[] {
  const out: Block[] = [];
  for (const key of Object.keys(doc.months).sort()) {
    for (const b of doc.months[key].blocks ?? []) out.push(b);
  }
  return out;
}

/**
 * How far back the journal goes, and how far forward. Counting only the things
 * that carry a date gets this wrong: a photo dropped into a month never has one
 * unless you set it, so a year made entirely of uploads would be invisible and
 * the journal would look younger than it is.
 */
export function journalSpan(doc: JournalDoc): { first?: string; last?: string } {
  const years: string[] = [];
  for (const [key, m] of Object.entries(doc.months)) {
    const blocks = m.blocks ?? [];
    if (!blocks.length && !m.song) continue;
    years.push(key.slice(0, 4));
    for (const b of blocks) if (b.date) years.push(String(b.date).slice(0, 4));
  }
  years.sort();
  return { first: years[0], last: years[years.length - 1] };
}
