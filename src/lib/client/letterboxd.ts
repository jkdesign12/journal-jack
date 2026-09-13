'use client';

import type { ImportedItem } from '@/lib/journal/types';

/* Reading a Letterboxd export in the browser.
 *
 * The RSS feed only carries the last fifty-odd watches; the official export
 * carries the whole diary. It downloads as a zip of CSVs, so both are read
 * here rather than uploaded anywhere.
 */

export function parseCSV(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c !== '\r') field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  if (!rows.length) return [];

  const head = rows.shift()!.map((h) => h.trim().toLowerCase());
  return rows
    .filter((r) => r.length > 1)
    .map((r) => {
      const o: Record<string, string> = {};
      head.forEach((h, i) => {
        o[h] = (r[i] || '').trim();
      });
      return o;
    });
}

/* The export ships diary.csv / watched.csv / ratings.csv / reviews.csv.
   diary:   Date, Name, Year, Letterboxd URI, Rating, Rewatch, Tags, Watched Date
   reviews: the same, plus Review — which is why it gets merged in below. */
export function fromLetterboxdCSV(text: string): ImportedItem[] {
  return parseCSV(text)
    .map((r): ImportedItem | null => {
      const date = r['watched date'] || r.date || '';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
      const name = r.name || r.title;
      if (!name) return null;

      const rating = r.rating ? parseFloat(r.rating) : null;
      return {
        source: 'letterboxd',
        title: name,
        subtitle: r.year || '',
        image: '', // the export carries no artwork
        url: r['letterboxd uri'] || '',
        date,
        rating: rating != null && !isNaN(rating) ? rating : null,
        review: (r.review || '').trim(),
        tags: (r.tags || '').trim(),
      };
    })
    .filter((x): x is ImportedItem => x !== null);
}

const norm = (t: string) =>
  String(t ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * The diary and the reviews are separate files describing the same watches, so
 * the review text is folded onto the matching diary entry rather than importing
 * the same film twice. They do not always agree on the day — a review edited
 * later carries a different date — so try the exact watch, then the same film
 * that year, then the film at all.
 */
export function mergeReviews(diary: ImportedItem[], reviewRows: ImportedItem[]): number {
  const byDate = new Map<string, ImportedItem>();
  const byYear = new Map<string, ImportedItem>();
  const byTitle = new Map<string, ImportedItem>();

  for (const i of diary) {
    byDate.set(`${norm(i.title)}|${i.date}`, i);
    byYear.set(`${norm(i.title)}|${i.subtitle}`, i);
    if (!byTitle.has(norm(i.title))) byTitle.set(norm(i.title), i);
  }

  let attached = 0;
  for (const r of reviewRows) {
    if (!r.review) continue;
    const hit =
      byDate.get(`${norm(r.title)}|${r.date}`) ??
      byYear.get(`${norm(r.title)}|${r.subtitle}`) ??
      byTitle.get(norm(r.title));

    if (hit) {
      if (!hit.review) {
        hit.review = r.review;
        attached++;
      }
      if (hit.rating == null) hit.rating = r.rating;
    } else {
      diary.push(r); // reviewed something that never hit the diary
      byTitle.set(norm(r.title), r);
      attached++;
    }
  }
  return attached;
}

/**
 * The export downloads as one zip. This reads the central directory and
 * inflates entries with the browser's own DecompressionStream — stored and
 * deflated entries only, which is all the export uses. No library needed for
 * something read once.
 */
async function readZip(file: File): Promise<Record<string, string>> {
  const buf = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(buf.buffer);
  const dec = new TextDecoder();

  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not a zip file');

  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const out: Record<string, string> = {};

  for (let n = 0; n < count; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) break;
    const method = view.getUint16(p + 10, true);
    const compSize = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOff = view.getUint32(p + 42, true);
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;

    if (!/\.csv$/i.test(name)) continue;
    const lNameLen = view.getUint16(localOff + 26, true);
    const lExtraLen = view.getUint16(localOff + 28, true);
    const start = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + compSize);

    if (method === 0) out[name] = dec.decode(raw);
    else if (method === 8) {
      const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      out[name] = await new Response(stream).text();
    }
  }
  return out;
}

/** Accepts either the raw .zip export or a single .csv pulled out of it. */
export async function fromLetterboxdExport(
  file: File,
): Promise<{ items: ImportedItem[]; from: string }> {
  if (/\.zip$/i.test(file.name)) {
    const files = await readZip(file);
    const names = Object.keys(files);
    const pick =
      names.find((f) => /diary\.csv$/i.test(f)) ??
      names.find((f) => /watched\.csv$/i.test(f)) ??
      names.find((f) => /ratings\.csv$/i.test(f));
    if (!pick) throw new Error('No diary.csv inside that zip');

    const items = fromLetterboxdCSV(files[pick]);
    const reviewFile = names.find((f) => /reviews\.csv$/i.test(f));
    if (reviewFile) mergeReviews(items, fromLetterboxdCSV(files[reviewFile]));

    const reviewed = items.filter((i) => i.review).length;
    return { items, from: pick + (reviewFile ? ` + reviews.csv (${reviewed} reviews)` : '') };
  }
  return { items: fromLetterboxdCSV(await file.text()), from: file.name };
}
