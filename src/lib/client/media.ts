'use client';

import type { Block } from '@/lib/journal/types';
import { DB } from './db';
import { Account } from './account';

/* One object URL per file, kept for as long as the tab lives. Making a fresh
   one on every render would leak a handle to the file each time. */
const urlCache = new Map<string, string>();

/** Where a tile's picture comes from: a link, this device, or the account. */
export async function srcFor(b: Block): Promise<string | null> {
  if (b.src) return b.src;
  if (!b.blobId) return null;

  const cached = urlCache.get(b.blobId);
  if (cached) return cached;

  let blob = await DB.getBlob(b.blobId);
  if (!blob && Account.user) {
    // uploaded from another device: fetch it once, then keep it here
    blob = await Account.remoteBlob(b.blobId);
    if (blob) await DB.putBlob(b.blobId, blob);
  }
  if (!blob) return null;

  const url = URL.createObjectURL(blob);
  urlCache.set(b.blobId, url);
  return url;
}

/** The on-screen copy of a file is stale — it was replaced or deleted. */
export function forgetBlobUrl(blobId: string): void {
  const url = urlCache.get(blobId);
  if (!url) return;
  URL.revokeObjectURL(url);
  urlCache.delete(blobId);
}
