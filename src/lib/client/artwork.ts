'use client';

import { store } from './store';
import { everyBlock } from '@/lib/journal/sort';
import type { Block } from '@/lib/journal/types';

/* Putting posters and covers on things that arrived without them. */

const MUSIC_SOURCES = new Set(['musicboard', 'lastfm']);

/**
 * Albums are identified by artist, films by year. The request and the key the
 * server answers with are built in the same place, so they cannot drift apart.
 */
export function artworkQuery(b: Block) {
  if (MUSIC_SOURCES.has(b.source ?? '')) {
    // "John Coltrane · 42 plays" -> "John Coltrane"
    const artist = String(b.subtitle ?? '').split('·')[0].trim();
    return {
      item: { kind: 'album' as const, title: b.title ?? '', artist },
      key: `album:${(b.title ?? '').toLowerCase()}|${artist.toLowerCase()}`,
    };
  }

  /* Only a real year counts. A subtitle can be "MOVIE" (AniList) or "Sep 2" (a
     feed with no year), and passing that as the year means every match is
     rejected and nothing ever resolves. */
  const raw = String(b.subtitle ?? '').trim();
  const year = /^(19|20)\d{2}$/.test(raw) ? raw : '';
  return {
    item: { title: b.title ?? '', year },
    key: `${(b.title ?? '').toLowerCase()}|${year}`,
  };
}

/**
 * A music block wearing an image from a film CDN got it from the film cascade —
 * the "Evangelion single with a comedy poster" case — so drop it and look the
 * album up properly.
 */
export function repairWrongCovers(blocks: Block[]): number {
  let repaired = 0;
  for (const b of blocks) {
    if (MUSIC_SOURCES.has(b.source ?? '') && /media-amazon\.com|upload\.wikimedia\.org/.test(b.src ?? '')) {
      b.src = '';
      repaired++;
    }
  }
  return repaired;
}

export interface ArtworkRun {
  repaired: number;
  filled: number;
  missing: number;
  left: number;
  throttled: boolean;
  error?: string;
}

let running = false;

export async function fillArtwork(): Promise<ArtworkRun> {
  const result: ArtworkRun = { repaired: 0, filled: 0, missing: 0, left: 0, throttled: false };
  if (running) return result; // one sweep at a time
  running = true;

  try {
    const all = everyBlock(store.doc);
    result.repaired = repairWrongCovers(all);
    if (result.repaired) store.save();

    const missing = all.filter((b) => b.kind === 'media' && !b.src && b.title);
    result.missing = missing.length;
    if (!missing.length) return result;

    // fill what you are actually looking at first
    const here = new Set(store.doc.months[store.view.cursor]?.blocks ?? []);
    const ordered = [...missing].sort((a, b) => Number(here.has(b)) - Number(here.has(a)));

    const batch = ordered.slice(0, 30);
    const queries = batch.map(artworkQuery);

    const res = await fetch('/api/artwork', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: queries.map((q) => q.item) }),
    });

    const data = (await res.json()) as {
      found?: Record<string, string>;
      pending?: number;
      throttled?: boolean;
      error?: string;
    };
    if (data.error) {
      result.error = data.error;
      return result;
    }

    for (let i = 0; i < batch.length; i++) {
      const url = data.found?.[queries[i].key];
      if (url) {
        batch[i].src = url;
        delete batch[i].ratio;
        result.filled++;
      }
    }

    result.throttled = !!data.throttled;
    result.left = Math.max(0, ordered.length - batch.length) + (data.pending ?? 0);
    if (result.filled) store.save();
    return result;
  } catch (e) {
    result.error = (e as Error).message;
    return result;
  } finally {
    running = false;
  }
}

/** What to say after a sweep. */
export function describeArtwork(run: ArtworkRun): { text: string; bad?: boolean }[] {
  const lines: { text: string; bad?: boolean }[] = [];
  if (run.repaired) {
    lines.push({
      text: `Dropped ${run.repaired} wrong cover${run.repaired === 1 ? '' : 's'} — looking them up again`,
    });
  }
  if (run.error) {
    lines.push({ text: 'Posters: ' + run.error, bad: true });
    return lines;
  }
  if (!run.missing) {
    lines.push({ text: 'Every item already has artwork' });
    return lines;
  }
  if (run.filled) {
    lines.push({
      text:
        `Found ${run.filled} poster${run.filled === 1 ? '' : 's'}` +
        (run.left ? ` · ${run.left} to go` : ''),
    });
  } else {
    lines.push({ text: 'No posters matched those titles', bad: true });
  }
  if (run.throttled) {
    lines.push({ text: 'Throttled on the rest — run "Find missing posters" again', bad: true });
  }
  return lines;
}
