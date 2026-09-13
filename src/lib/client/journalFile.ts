'use client';

import { DB } from './db';
import { store } from './store';
import { uid } from '@/lib/journal/uid';
import { everyBlock } from '@/lib/journal/sort';
import type { Block, JournalDoc } from '@/lib/journal/types';

/* Taking the whole journal out, and putting one back.
 *
 * The export carries the files as well as the document — a journal of photos
 * without the photos is not a backup. */

const toDataUrl = (blob: Blob): Promise<string> =>
  new Promise((res) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.readAsDataURL(blob);
  });

export interface Bundle extends JournalDoc {
  blobs?: Record<string, { type: string; data: string }>;
}

export async function packJournal(): Promise<Bundle> {
  const bundle: Bundle = { ...store.doc, blobs: {} };

  const wanted = new Set<string>();
  for (const b of everyBlock(store.doc)) if (b.blobId) wanted.add(b.blobId);
  for (const m of Object.values(store.doc.months)) if (m.song) wanted.add(m.song.blobId);

  for (const id of wanted) {
    const blob = await DB.getBlob(id);
    if (blob) bundle.blobs![id] = { type: blob.type, data: await toDataUrl(blob) };
  }
  return bundle;
}

export async function exportJournal(): Promise<void> {
  const bundle = await packJournal();
  const url = URL.createObjectURL(new Blob([JSON.stringify(bundle)], { type: 'application/json' }));

  const a = document.createElement('a');
  a.href = url;
  a.download = `journal-jack-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Reads a bundle back, files first so nothing points at a picture that is not there yet. */
export async function importJournal(file: File): Promise<void> {
  const bundle = JSON.parse(await file.text()) as Bundle;
  if (!bundle.months) throw new Error('Not a journal.jack export');

  for (const [id, rec] of Object.entries(bundle.blobs ?? {})) {
    const blob = await (await fetch(rec.data)).blob();
    await DB.putBlob(id, blob);
  }

  delete bundle.blobs;
  await store.adopt(bundle);
}

/* ---- a month you can look at without importing anything ---- */

function svgTile(label: string, a: string, b: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${a}"/><stop offset="100%" stop-color="${b}"/>
    </linearGradient></defs>
    <rect width="600" height="600" fill="url(#g)"/>
    <text x="300" y="315" font-family="Georgia,serif" font-size="42" fill="rgba(255,255,255,.9)"
      text-anchor="middle">${label}</text></svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

/** Clearly labelled demo data, so an empty journal has something to show. */
export function sampleBlocks(): Block[] {
  const demo: Array<[string, string, string, number, 'sm' | 'md' | 'lg']> = [
    ['sample photo', '#3a3f58', '#8f6f9e', 8, 'md'],
    ['sample film', '#5b2f37', '#c4736f', 12, 'sm'],
    ['sample album', '#264034', '#88a97f', 3, 'sm'],
    ['sample photo', '#4a3a2a', '#e0a45e', 19, 'sm'],
    ['sample show', '#22303f', '#7f97c4', 24, 'sm'],
    ['sample photo', '#3d2c3a', '#ab8fc4', 27, 'md'],
  ];

  const blocks: Block[] = demo.map(([t, a, b, day, size], i) => ({
    id: uid(),
    kind: 'media',
    size,
    src: svgTile(t, a, b),
    title: t,
    subtitle: 'demo data — not from a real service',
    source: 'sample',
    day,
    rating: i % 2 ? 4 : null,
    note: '',
    url: '',
    tags: [],
  }));

  blocks.push({
    id: uid(),
    kind: 'note',
    size: 'sm',
    text: 'Sample month. Everything here is placeholder data you can delete.',
  });
  blocks.push({ id: uid(), kind: 'stats', size: 'sm' });
  return blocks;
}
