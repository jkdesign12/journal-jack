'use client';

/* Bringing this device and the account together.
 *
 * The journal document and the files it points at travel separately: the
 * document is small and pushed on every save, while photos and songs go one by
 * one. An upload that quietly failed used to stay failed forever — the other
 * device then shows a card with a name and no picture, because the bytes exist
 * on exactly one machine. So the two are reconciled rather than assumed.
 */

import { Account, explainUploadError } from './account';
import { DB } from './db';
import { forgetBlobUrl } from './media';
import { shrinkFailures, shrinkImage, UPLOAD_LIMIT } from './images';
import { store } from './store';
import { everyBlock } from '@/lib/journal/sort';
import type { Block } from '@/lib/journal/types';

export interface SyncReport {
  pulled: number;
  sent: number;
  resized: number;
  savedBytes: number;
  sentWhole: number;
  stilled: string[];
  stranded: number;
  failures: string[];
}

const empty = (): SyncReport => ({
  pulled: 0,
  sent: 0,
  resized: 0,
  savedBytes: 0,
  sentWhole: 0,
  stilled: [],
  stranded: 0,
  failures: [],
});

const blocksHere = (): Block[] => everyBlock(store.doc);

/**
 * Anything held here that the account has not got is uploaded; anything the
 * journal points at that neither side has is reported, since only the device
 * holding the original can fix that.
 */
export async function syncFiles(report = empty()): Promise<SyncReport> {
  if (!Account.user) return report;

  const localIds = await DB.allBlobIds();
  const remoteIds = new Set(await Account.remoteBlobIds());
  const missing = localIds.filter((id) => !remoteIds.has(id));

  for (const id of missing) {
    let blob = await DB.getBlob(id);
    if (!blob) continue;

    const owner = blocksHere().find((b) => b.blobId === id);
    const label = owner?.title ?? 'a file';

    /* Too big for the host is re-encoded here rather than reported as a
       failure. This catches files added before shrinking existed. The smaller
       copy replaces the local one so both sides hold the same bytes and it
       never has to be done twice. */
    if (blob.size > UPLOAD_LIMIT) {
      const file = new File([blob], owner?.title ?? 'file', { type: blob.type });
      const smaller = await shrinkImage(file);

      if (smaller !== file && smaller.size < blob.size) {
        await DB.putBlob(id, smaller);
        report.savedBytes += blob.size - smaller.size;
        report.resized++;

        /* A Live Photo just became a still. The block still calls itself a
           video, and a video element pointing at a picture renders nothing, so
           it has to be told what it is holding now. */
        if (owner && owner.mime !== smaller.type) {
          if (/^video\//.test(owner.mime ?? '')) report.stilled.push(label);
          owner.mime = smaller.type;
          delete owner.ratio; // the still may be shaped differently
        }

        blob = smaller;
        forgetBlobUrl(id); // the on-screen copy is now stale
      }
    }

    /* Still too big is not the end of the road: a file over the limit goes
       straight to storage instead of through this site, which is the whole
       reason that route exists. Refusing here would strand exactly the files
       that need it most. */
    const oversize = blob.size > UPLOAD_LIMIT;

    try {
      if (await Account.uploadBlob(id, blob, { loud: true })) {
        report.sent++;
        if (oversize) report.sentWhole++;
      }
    } catch (e) {
      const mb = (blob.size / 1048576).toFixed(1);
      const why = shrinkFailures.get(blob);
      report.failures.push(
        oversize
          ? `${label} (${mb} MB${why ? `, ${why}` : ''}): ${(e as Error).message}`
          : `${label}: ${(e as Error).message}`,
      );
    }
  }

  // files the journal points at that are nowhere this device can reach
  const here = new Set(localIds);
  const wanted = new Set(blocksHere().filter((b) => b.blobId).map((b) => b.blobId!));
  for (const m of Object.values(store.doc.months)) if (m.song) wanted.add(m.song.blobId);
  report.stranded = [...wanted].filter((id) => !here.has(id) && !remoteIds.has(id)).length;

  return report;
}

/**
 * Pull the account's copy, merge it in — nothing is ever replaced — push the
 * union back, then reconcile the files. Safe to press at any time and safe to
 * press twice: merging is additive, so the worst case is that nothing changes.
 */
export async function syncNow(): Promise<SyncReport> {
  const report = empty();
  if (!Account.user) return report;

  const before = blocksHere().length;

  const remote = await Account.pullDoc();
  if (remote.doc) await store.mergeRemote(remote.doc);

  await Account.pushDoc(store.doc);
  report.pulled = Math.max(0, blocksHere().length - before);

  await syncFiles(report);
  store.save();
  return report;
}

/** What to tell someone after a sync, in the order they care about it. */
export function describeSync(report: SyncReport): { text: string; bad?: boolean }[] {
  const lines: { text: string; bad?: boolean }[] = [];
  const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;

  if (report.pulled) lines.push({ text: `Pulled in ${plural(report.pulled, 'item')} from your account` });

  if (report.stilled.length) {
    lines.push({
      text:
        `${plural(report.stilled.length, 'Live Photo')} saved as a still so ` +
        `${report.stilled.length === 1 ? 'it' : 'they'} can sync: ${report.stilled.slice(0, 3).join(', ')}`,
    });
  }

  if (report.sent) {
    lines.push({
      text:
        `Uploaded ${plural(report.sent, 'file')} to your account` +
        (report.resized
          ? ` · ${report.resized} resized first, saving ${(report.savedBytes / 1048576).toFixed(1)} MB`
          : '') +
        (report.sentWhole ? ` · ${report.sentWhole} sent full size straight to storage` : ''),
    });
  }

  if (report.failures.length) {
    lines.push({
      text: `${plural(report.failures.length, 'file')} could not upload. ${explainUploadError(report.failures[0])}`,
      bad: true,
    });
  } else if (report.stranded) {
    lines.push({
      text:
        `${plural(report.stranded, 'item')} here still have no file on the account — open the app on ` +
        'the device you added them from and press sync there',
      bad: true,
    });
  }

  if (!lines.length) lines.push({ text: 'Journal already matches your account' });
  return lines;
}
