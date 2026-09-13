import 'server-only';
import { backend } from './backend';
export type { StoredJournal } from './backend/types';

export const getJournal = async (userId: string) => (await backend()).getJournal(userId);

/**
 * An optimistic lock: a push built on a version that is no longer current is
 * refused and the newer document handed back, so the client can merge rather
 * than overwrite work done somewhere else.
 */
export const putJournal = async (
  userId: string,
  doc: Parameters<Awaited<ReturnType<typeof backend>>['putJournal']>[1],
  baseVersion?: number | null,
) => (await backend()).putJournal(userId, doc, baseVersion);
