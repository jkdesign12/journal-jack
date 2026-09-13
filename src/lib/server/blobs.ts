import 'server-only';
import { backend } from './backend';
export type { BlobRead } from './backend/types';

/** Ids are ours, not anyone's input, so anything unusual is a bug or an attack. */
export const safeId = (id: string) => /^[A-Za-z0-9_-]{1,64}$/.test(id);

export async function putBlob(userId: string, id: string, mime: string | null, buf: Buffer) {
  if (!safeId(id)) throw new Error('Bad blob id');
  return (await backend()).putBlob(userId, id, mime, buf);
}

export async function recordBlob(
  userId: string,
  id: string,
  mime: string | null,
  size: number,
  url: string,
) {
  if (!safeId(id)) throw new Error('Bad blob id');
  return (await backend()).recordBlob(userId, id, mime, size, url);
}

export async function getBlob(userId: string, id: string) {
  if (!safeId(id)) return null;
  return (await backend()).getBlob(userId, id);
}

export const listBlobs = async (userId: string) => (await backend()).listBlobs(userId);

export const artLookup = async (key: string) => (await backend()).artLookup(key);
export const artStore = async (key: string, url: string) => (await backend()).artStore(key, url);
