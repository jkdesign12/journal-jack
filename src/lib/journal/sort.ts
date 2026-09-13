/* The orders a board can be read in.
 *
 * 'manual' is the stored order of the array — dragging decides it. Every other
 * mode is a view over the same blocks, so switching back loses nothing.
 */

import type { Block, JournalDoc } from './types';
import { tagsOf } from './tags';
import { MONTHS } from './dates';

export const SORT_MODES = ['manual', 'date', '-date', '-rating', 'title', 'source', 'month'] as const;
export type SortMode = (typeof SORT_MODES)[number];

export const SORT_LABELS: Record<SortMode, string> = {
  manual: 'Custom order',
  date: 'Oldest first',
  '-date': 'Newest first',
  '-rating': 'Highest rated',
  title: 'Title A–Z',
  source: 'By tag',
  month: 'By month',
};

type Key = (b: Block) => string | number;

export const SORTS: Record<Exclude<SortMode, 'manual' | 'month'>, Key> = {
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
export const effectiveSort = (mode: SortMode, allMonths: boolean): SortMode => {
  if (allMonths && mode === 'manual') return '-date';
  /* Grouping by month is about reading the whole journal. Inside one month it
     would be a single heading repeating the one already at the top. */
  if (!allMonths && mode === 'month') return '-date';
  return mode;
};

export function orderedBlocks(blocks: Block[], mode: SortMode): Block[] {
  if (mode === 'manual') return blocks;
  // grouping draws its own sections; the flat list is simply chronological
  if (mode === 'month') return orderedBlocks(blocks, 'date');
  const key = SORTS[mode];
  const dir = mode.startsWith('-') ? -1 : 1;
  return [...blocks].sort((a, b) => {
    const x = key(a);
    const y = key(b);
    return x < y ? -dir : x > y ? dir : 0;
  });
}

/** Which month each block is filed under — its id against 'YYYY-MM'. */
export function homeMonths(doc: JournalDoc): Map<string, string> {
  const home = new Map<string, string>();
  for (const [key, m] of Object.entries(doc.months)) {
    for (const b of m.blocks ?? []) home.set(b.id, key);
  }
  return home;
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

export interface MonthGroup {
  /** 'YYYY-MM', or '' for the things with no date */
  key: string;
  label: string;
  blocks: Block[];
}

/**
 * The whole journal as a run of months, each under its own heading.
 *
 * Reads forwards — oldest month first, and oldest first inside each one — so
 * scrolling down is scrolling through time.
 *
 * A photo dropped into a month usually carries no date of its own, but it is
 * not homeless: you filed it under that month, so it reads as the 1st of that
 * month and sits with the rest of it rather than in a heap at the end. Only
 * something with no month at all — which the everything view never produces —
 * falls through to "No date", where it can be found and given one.
 */
export function groupByMonth(blocks: Block[], home?: Map<string, string>): MonthGroup[] {
  const filed = (b: Block): string => {
    if (b.date) return b.date;
    const month = home?.get(b.id);
    return month ? month + '-01' : '';
  };

  const byMonth = new Map<string, Block[]>();

  for (const b of blocks) {
    const key = filed(b).slice(0, 7);
    const list = byMonth.get(key);
    if (list) list.push(b);
    else byMonth.set(key, [b]);
  }

  const dated = [...byMonth.keys()].filter(Boolean).sort();
  const groups: MonthGroup[] = dated.map((key) => {
    const [year, month] = key.split('-').map(Number);
    return {
      key,
      label: `${MONTHS[month - 1]} ${year}`,
      blocks: [...byMonth.get(key)!].sort((a, b) => filed(a).localeCompare(filed(b))),
    };
  });

  const loose = byMonth.get('');
  if (loose?.length) groups.push({ key: '', label: 'No date', blocks: loose });

  return groups;
}
