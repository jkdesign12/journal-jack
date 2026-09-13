/* Reconciling two copies of a journal.
 *
 * Every device holds the whole journal, so "who saved last" is the wrong
 * question to ask about the document — it is the right question to ask about
 * each month, and about each colour choice, separately. Ask it too broadly and
 * a photo dragged on the desktop beats a background picked on the phone.
 *
 * Within a month, blocks are unioned by id, so an addition on either side
 * survives. Deletions therefore need tombstones: without one, a block you
 * removed here is simply one the other side still has, and the union hands it
 * straight back.
 */

import type { JournalDoc, Month, Palette } from './types';

/** Long enough for a device that has been off for a season to catch up. */
export const TOMBSTONE_LIFE = 120 * 864e5;

export function tombstone(m: Month | undefined, id: string, at = Date.now()): void {
  if (!m || !id) return;
  m.removed = m.removed ?? {};
  m.removed[id] = at;
}

/** The later mark of each deletion, with anything past its life dropped. */
export function mergedTombstones(
  a: Record<string, number> | undefined,
  b: Record<string, number> | undefined,
  now = Date.now(),
): Record<string, number> {
  const out: Record<string, number> = { ...(a ?? {}) };
  for (const [id, at] of Object.entries(b ?? {})) {
    if ((out[id] ?? 0) < at) out[id] = at;
  }
  const cutoff = now - TOMBSTONE_LIFE;
  for (const [id, at] of Object.entries(out)) if (at < cutoff) delete out[id];
  return out;
}

export function mergeMonths(mine: Month | undefined, theirs: Month | undefined): Month | undefined {
  if (!mine) return theirs;
  if (!theirs) return mine;

  const mineAt = mine.updatedAt ?? 0;
  const theirsAt = theirs.updatedAt ?? 0;

  // a deliberate erase beats anything older than the erase itself
  if ((mine.erasedAt ?? 0) > theirsAt) return mine;
  if ((theirs.erasedAt ?? 0) > mineAt) return theirs;

  const newer = theirsAt > mineAt ? theirs : mine;
  const older = newer === mine ? theirs : mine;

  const removed = mergedTombstones(mine.removed, theirs.removed);
  const gone = (id: string) => Object.prototype.hasOwnProperty.call(removed, id);

  const kept = (newer.blocks ?? []).filter((b) => !gone(b.id));
  const known = new Set(kept.map((b) => b.id));
  const missing = (older.blocks ?? []).filter((b) => !known.has(b.id) && !gone(b.id));

  return { ...newer, blocks: [...kept, ...missing], removed };
}

/* Colour settings carry their own timestamps. The document's own stamp moves
   whenever anything at all is saved, so comparing that would mean a colour
   picked on one device loses to an unrelated edit made later on another. */
function mergePalettes(
  mine: Record<string, Palette> | undefined,
  theirs: Record<string, Palette> | undefined,
  mineAt: number,
  theirsAt: number,
): Record<string, Palette> | undefined {
  if (!theirs) return mine;
  const out: Record<string, Palette> = { ...(mine ?? {}) };
  for (const [year, their] of Object.entries(theirs)) {
    const ours = out[year];
    if (!ours || (their.at ?? theirsAt) > (ours.at ?? mineAt)) out[year] = their;
  }
  return out;
}

/** Merges `theirs` into `mine`, in place, and returns it. */
export function mergeDocs(mine: JournalDoc, theirs: JournalDoc | null | undefined): JournalDoc {
  if (!theirs || !theirs.months) return mine;

  mine.months = mine.months ?? {};
  for (const key of new Set([...Object.keys(mine.months), ...Object.keys(theirs.months)])) {
    const merged = mergeMonths(mine.months[key], theirs.months[key]);
    if (merged) mine.months[key] = merged;
  }

  const mineAt = mine.updatedAt ?? 0;
  const theirsAt = theirs.updatedAt ?? 0;

  const years = mergePalettes(mine.yearColours, theirs.yearColours, mineAt, theirsAt);
  if (years) mine.yearColours = years;

  /* The rest move as groups, each with one stamp: take the later group whole,
     or fill in only what this side never had an opinion about. */
  const group = <K extends keyof JournalDoc>(keys: K[], stamp: 'shadowAt' | 'paletteAt') => {
    const theirTime = theirs[stamp] ?? theirsAt;
    if (theirTime > (mine[stamp] ?? mineAt)) {
      for (const k of keys) if (theirs[k] !== undefined) mine[k] = theirs[k];
      mine[stamp] = theirTime;
      return;
    }
    for (const k of keys) {
      if (mine[k] === undefined && theirs[k] !== undefined) mine[k] = theirs[k];
    }
  };

  group(['shadowAll', 'shadowGlobal'], 'shadowAt');
  group(['customColours', 'hiddenPresets'], 'paletteAt');

  return mine;
}

/* ---- stamping ----
   A month is stamped only when its contents actually change, so switching
   months or re-rendering never makes this device look newer than it is. */

export const printOf = (m: Month | undefined): string =>
  JSON.stringify(m?.blocks ?? []) +
  '|' +
  JSON.stringify(m?.song ?? null) +
  '|' +
  JSON.stringify([m?.shadow ?? null, m?.shadowColour ?? null, m?.shadowY ?? null, m?.shadowBlur ?? null]);

interface ColourGroup {
  key: string;
  value: unknown;
  chosen: boolean;
  mark: (at: number) => void;
}

export function colourGroups(doc: JournalDoc): ColourGroup[] {
  const years = Object.entries(doc.yearColours ?? {})
    .filter(([, pal]) => pal && (pal.bg || pal.ink || pal.at))
    .map(([year, pal]) => ({
      key: `year:${year}`,
      value: pal,
      chosen: !!(pal.bg || pal.ink),
      mark: (at: number) => {
        pal.at = at;
      },
    }));

  return [
    ...years,
    {
      key: 'shadow',
      value: { all: doc.shadowAll ?? null, global: doc.shadowGlobal ?? null },
      chosen: !!(doc.shadowAll || doc.shadowGlobal),
      mark: (at: number) => {
        doc.shadowAt = at;
      },
    },
    {
      key: 'palette',
      value: { custom: doc.customColours ?? null, hidden: doc.hiddenPresets ?? null },
      chosen: !!((doc.customColours ?? []).length || (doc.hiddenPresets ?? []).length),
      mark: (at: number) => {
        doc.paletteAt = at;
      },
    },
  ];
}

// the stamp itself must not count as a change, or every save would make one
const printSetting = (v: unknown): string =>
  JSON.stringify(v, (k, val) => (k === 'at' ? undefined : val)) ?? '';

/** Remembers what a document looked like, so the next save can spot real edits. */
export class Stamper {
  private monthPrints = new Map<string, string>();
  private settingPrints = new Map<string, string>();

  reset(doc: JournalDoc | null | undefined): void {
    this.monthPrints = new Map(
      Object.entries(doc?.months ?? {}).map(([k, m]) => [k, printOf(m)]),
    );
    this.settingPrints = new Map(
      colourGroups(doc ?? { months: {} }).map((g) => [g.key, printSetting(g.value)]),
    );
  }

  stamp(doc: JournalDoc, now = Date.now()): void {
    for (const [key, m] of Object.entries(doc.months ?? {})) {
      const print = printOf(m);
      if (this.monthPrints.get(key) === print) continue;
      if (this.monthPrints.has(key) || m.blocks.length || m.song) m.updatedAt = now;
      this.monthPrints.set(key, print);
    }

    for (const g of colourGroups(doc)) {
      const print = printSetting(g.value);
      if (this.settingPrints.get(g.key) === print) continue;
      if (this.settingPrints.has(g.key) || g.chosen) g.mark(now);
      this.settingPrints.set(g.key, print);
    }
  }
}
