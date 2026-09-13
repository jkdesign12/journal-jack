/* Turning what a service handed back into blocks on a board.
 *
 * All of this is arithmetic on the document, with no browser in sight, so the
 * rules that were expensive to get right — what counts as the same watch, what
 * an export is allowed to replace — can be tested rather than demonstrated.
 */

import { tombstone } from './merge';
import { defaultTag, tagsOf } from './tags';
import { uid } from './uid';
import type { Block, ImportedItem, JournalDoc, Month } from './types';

/** "The Wrong Girls" and "the wrong girls " are the same film. */
export const normTitle = (t: string | undefined): string =>
  (t ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const yearOf = (b: Block) => (String(b.subtitle ?? '').match(/\b(19|20)\d{2}\b/) ?? [''])[0];

/** Which film this is, ignoring when you watched it. */
export const filmKey = (b: Block) => `${b.source ?? ''}|${normTitle(b.title)}|${yearOf(b)}`;

/**
 * Which *watch* this is. The day has to be part of it: watching the same film
 * again in March is a diary entry of its own, not a copy of the one in
 * February, and leaving the date out quietly deleted every rewatch.
 */
export const dupKey = (b: Block) => `${filmKey(b)}|${b.date ?? ''}`;

export interface ImportSummary {
  added: number;
  enriched: number;
  months: string[];
}

/** Drop imported rows into whichever month they belong to, creating as needed. */
export function applyImport(
  doc: JournalDoc,
  items: ImportedItem[],
  opts: { origin?: 'export' | 'feed'; cursor: string },
): ImportSummary {
  let added = 0;
  let enriched = 0;
  const touched = new Set<string>();

  for (const it of items) {
    const key = it.date ? it.date.slice(0, 7) : opts.cursor;
    const m = (doc.months[key] ??= { blocks: [], song: null });

    const sig = (b: { source?: string; title?: string; date?: string | null }) =>
      `${b.source ?? ''}|${b.title ?? ''}|${b.date ?? ''}`;
    const existing = m.blocks.find((b) => sig(b) === sig(it));

    if (existing) {
      // already here, but a re-pull may carry what the first one lacked — a
      // review written later, a rating, artwork
      let changed = false;
      // re-dropping the zip promotes a block imported before origins existed,
      // so the purge below can tell export entries from feed ones
      if (opts.origin) existing.origin = opts.origin;

      if (!tagsOf(existing).length) {
        const t = defaultTag(it);
        if (t) {
          existing.tags = [t];
          delete existing.tag;
          changed = true;
        }
      }
      if (it.review && !existing.note) {
        existing.note = it.review;
        changed = true;
      }
      if (it.image && !existing.src) {
        existing.src = it.image;
        changed = true;
      }
      if (it.rating != null && existing.rating == null) {
        existing.rating = it.rating;
        changed = true;
      }
      if (changed) {
        enriched++;
        touched.add(key);
      }
      continue;
    }

    const tag = defaultTag(it);
    m.blocks.push({
      id: uid(),
      kind: 'media',
      size: 'sm',
      src: it.image || '',
      title: it.title,
      subtitle: it.subtitle || '',
      url: it.url || '',
      date: it.date || null,
      day: it.date ? +it.date.slice(8, 10) : null,
      rating: it.rating ?? null,
      source: it.source,
      origin: opts.origin ?? 'feed', // 'export' wins when the same film arrives twice
      note: it.review || '', // your own words, kept with the thing
      tags: tag ? [tag] : [],
    });
    added++;
    touched.add(key);
  }

  return { added, enriched, months: [...touched].sort() };
}

/**
 * The export is the authority: it is your whole diary, with your reviews. The
 * RSS feed only carries the last ~50 watches, but it does carry posters. So
 * when both describe the same watch, keep the export's entry and take the
 * feed's artwork.
 */
export function mergeDuplicates(doc: JournalDoc): number {
  const seen = new Map<string, { block: Block; month: Month }>();
  const doomed = new Set<Block>();

  // which copy survives: the export, then whichever carries more of your work
  const score = (x: Block) =>
    (x.origin === 'export' ? 4 : 0) + (x.note ? 2 : 0) + (x.rating != null ? 1 : 0);

  for (const m of Object.values(doc.months)) {
    for (const b of m.blocks) {
      if (b.kind !== 'media' || !b.title) continue;
      const k = dupKey(b);
      const prev = seen.get(k);
      if (!prev) {
        seen.set(k, { block: b, month: m });
        continue;
      }

      /* Two rows out of the same export on the same day are two real logs —
         Letterboxd lets you watch something twice in an evening — so they are
         left alone. A pair from different places is one watch described twice. */
      if (b.origin === 'export' && prev.block.origin === 'export') continue;

      const keep = score(b) > score(prev.block) ? b : prev.block;
      const drop = keep === b ? prev.block : b;

      if (!keep.src && drop.src) keep.src = drop.src; // the feed's poster
      if (!keep.note && drop.note) keep.note = drop.note;
      if (keep.rating == null && drop.rating != null) keep.rating = drop.rating;
      if (!keep.url && drop.url) keep.url = drop.url;

      doomed.add(drop);
      seen.set(k, { block: keep, month: keep === b ? m : prev.month });
    }
  }

  // remove only after the scan — splicing mid-iteration skips entries
  let removed = 0;
  for (const m of Object.values(doc.months)) {
    const before = m.blocks.length;
    m.blocks = m.blocks.filter((b) => {
      if (!doomed.has(b)) return true;
      tombstone(m, b.id);
      return false;
    });
    removed += before - m.blocks.length;
  }
  return removed;
}

/**
 * After an export lands, the RSS copies are redundant: the export covers the
 * same period with real dates and your reviews. So they go — but each one first
 * hands its poster to its export twin, since artwork is the one thing the
 * export lacks. Entries newer than the export's last day are kept: those
 * happened after you generated it, and nothing else has them.
 */
export function purgeFeedEntries(doc: JournalDoc, source = 'letterboxd') {
  const twins = new Map<string, Block>(); // the same watch, on the same day
  const sameFilm = new Map<string, Block[]>(); // every log of that film
  let cutoff = '';

  for (const m of Object.values(doc.months)) {
    for (const b of m.blocks) {
      if (b.source !== source || b.origin !== 'export') continue;
      twins.set(dupKey(b), b);
      const list = sameFilm.get(filmKey(b));
      if (list) list.push(b);
      else sameFilm.set(filmKey(b), [b]);
      if ((b.date ?? '') > cutoff) cutoff = b.date ?? '';
    }
  }
  if (!twins.size) return { removed: 0, donated: 0, keptNewer: 0 };

  let removed = 0;
  let donated = 0;
  let keptNewer = 0;

  for (const m of Object.values(doc.months)) {
    m.blocks = m.blocks.filter((b) => {
      if (b.source !== source || b.origin === 'export') return true;

      /* The feed's one gift is the poster, and every log of that film wants it —
         a rewatch in March should not sit blank because the poster arrived
         attached to February. So artwork goes to all of them, while your
         writing and your rating stay with the watch they belong to. */
      const twin = twins.get(dupKey(b));
      if (b.src) {
        for (const other of sameFilm.get(filmKey(b)) ?? []) {
          if (!other.src) {
            other.src = b.src;
            donated++;
          }
        }
      }

      if (twin) {
        if (!twin.note && b.note) twin.note = b.note;
        if (twin.rating == null && b.rating != null) twin.rating = b.rating;
        if (!twin.url && b.url) twin.url = b.url;
        removed++;
        tombstone(m, b.id);
        return false;
      }

      // no twin: only safe to drop if the export already covers that date
      if (b.date && b.date <= cutoff) {
        removed++;
        tombstone(m, b.id);
        return false;
      }
      keptNewer++;
      return true;
    });
  }

  return { removed, donated, keptNewer };
}

/**
 * A reviews.csv describes films that are probably already in the journal, so
 * its job is to fill in notes, not to add a second copy of every film.
 */
export function attachReviews(doc: JournalDoc, items: ImportedItem[]) {
  const mine = Object.values(doc.months)
    .flatMap((m) => m.blocks)
    .filter((b) => b.source === 'letterboxd');

  const byDate = new Map<string, Block>();
  const byYear = new Map<string, Block>();
  const byTitle = new Map<string, Block>();

  for (const b of mine) {
    byDate.set(`${normTitle(b.title)}|${b.date ?? ''}`, b);
    byYear.set(`${normTitle(b.title)}|${b.subtitle ?? ''}`, b);
    if (!byTitle.has(normTitle(b.title))) byTitle.set(normTitle(b.title), b);
  }

  let attached = 0;
  let alreadyWritten = 0;
  const unmatched: ImportedItem[] = [];

  for (const it of items) {
    if (!it.review) continue;
    const hit =
      byDate.get(`${normTitle(it.title)}|${it.date}`) ??
      byYear.get(`${normTitle(it.title)}|${it.subtitle}`) ??
      byTitle.get(normTitle(it.title));

    if (!hit) {
      unmatched.push(it);
      continue;
    }
    if (hit.note) {
      alreadyWritten++; // never clobber your own edit
      continue;
    }
    hit.note = it.review;
    if (hit.rating == null && it.rating != null) hit.rating = it.rating;
    attached++;
  }

  return { attached, alreadyWritten, unmatched };
}
