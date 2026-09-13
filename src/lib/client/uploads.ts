'use client';

import { DB } from './db';
import { Account } from './account';
import { shrinkImage, UPLOAD_LIMIT } from './images';
import { store } from './store';
import { uid } from '@/lib/journal/uid';
import type { Block } from '@/lib/journal/types';

export interface AddResult {
  added: number;
  shrunk: number;
  savedBytes: number;
  stubborn: number;
}

/**
 * Photos and video from this device.
 *
 * Anything too big for the host is re-encoded before it is stored, so the copy
 * on this device and the copy on the account are the same bytes and the
 * shrinking never has to happen twice. A Live Photo becomes a still, because a
 * still that syncs everywhere beats a clip that syncs nowhere.
 */
export async function addFiles(files: FileList | File[], day: number | null = null): Promise<AddResult> {
  const wanted = [...files].filter((f) => /^(image|video)\//.test(f.type));
  const result: AddResult = { added: 0, shrunk: 0, savedBytes: 0, stubborn: 0 };
  if (!wanted.length) return result;

  const blocks: Block[] = [];
  const month = store.view.all ? store.view.cursor : store.view.cursor;
  const date = day ? `${month}-${String(day).padStart(2, '0')}` : null;

  for (const original of wanted) {
    const file = await shrinkImage(original);
    if (file !== original) {
      result.shrunk++;
      result.savedBytes += original.size - file.size;
    } else if (file.size > UPLOAD_LIMIT) {
      result.stubborn++;
    }

    const blobId = uid();
    await DB.putBlob(blobId, file);

    blocks.push({
      id: uid(),
      kind: 'photo',
      blobId,
      mime: file.type,
      title: file.name.replace(/\.[^.]+$/, ''),
      subtitle: '',
      note: '',
      day,
      date,
      size: 'sm',
      rating: null,
    });
  }

  store.add(blocks, month);
  result.added = blocks.length;

  // confirm they actually reached the account, rather than assuming
  if (Account.user) void import('./sync').then((m) => m.syncFiles());
  return result;
}

/**
 * A picture by link. Nothing is downloaded or stored: the block points at the
 * address, so it costs no space and needs no uploading to appear on your other
 * devices. The flip side is that if that page takes the image down, the tile
 * goes with it — a file from this computer is yours for good.
 */
export function addImageByLink(raw: string): { ok: boolean; message: string } {
  const text = String(raw ?? '').trim();
  if (!text) return { ok: false, message: 'Nothing to add' };

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, message: 'That is not a web address' };
  }
  if (!/^https?:$/.test(url.protocol)) {
    return { ok: false, message: 'Only http and https links can be shown' };
  }

  const last = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() ?? '');
  const host = url.hostname.replace(/^www\./, '');
  const isVideo = /\.(mp4|webm|mov|m4v)$/i.test(last);

  store.add([
    {
      id: uid(),
      kind: 'photo',
      src: url.href,
      mime: isVideo ? 'video/mp4' : 'image/*',
      title: last.replace(/\.[^.]+$/, '') || host,
      subtitle: host,
      note: '',
      day: null,
      date: null,
      size: 'sm',
      rating: null,
    },
  ]);

  return { ok: true, message: `Added from ${host}` };
}

/** What to say after files were added, including when something stayed big. */
export function describeAdd(result: AddResult): string {
  const files = `${result.added} ${result.added === 1 ? 'file' : 'files'}`;
  return (
    `Added ${files}` +
    (result.shrunk
      ? ` · ${result.shrunk} resized to fit, saving ${(result.savedBytes / 1048576).toFixed(1)} MB`
      : '') +
    (result.stubborn ? ` · ${result.stubborn} stayed full size and will go straight to storage` : '')
  );
}
