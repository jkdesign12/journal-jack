import 'server-only';
import type { JournalDoc } from '@/lib/journal/types';
import { ready, sql } from './db';

export interface StoredJournal {
  doc: JournalDoc | null;
  version: number;
  updated: number;
}

export async function getJournal(userId: string): Promise<StoredJournal> {
  await ready();
  const [row] = (await sql()`SELECT doc, version, updated FROM journals
                             WHERE user_id = ${userId}`) as Array<{
    doc: JournalDoc;
    version: number;
    updated: string | number;
  }>;
  if (!row) return { doc: null, version: 0, updated: 0 };
  return { doc: row.doc, version: row.version, updated: Number(row.updated) };
}

export interface PutResult {
  conflict: boolean;
  version?: number;
  updated?: number;
  doc?: JournalDoc | null;
}

/**
 * An optimistic lock: a push built on a version that is no longer current is
 * refused and the newer document handed back, so the client can merge rather
 * than overwrite someone else's work.
 */
export async function putJournal(
  userId: string,
  doc: JournalDoc,
  baseVersion?: number | null,
): Promise<PutResult> {
  await ready();
  const db = sql();
  const [cur] = (await db`SELECT version FROM journals WHERE user_id = ${userId}`) as Array<{
    version: number;
  }>;
  const version = cur ? cur.version : 0;

  if (baseVersion != null && cur && baseVersion !== version) {
    return { conflict: true, ...(await getJournal(userId)) };
  }

  const next = version + 1;
  const stamp = Date.now();
  await db`INSERT INTO journals (user_id, doc, version, updated)
           VALUES (${userId}, ${JSON.stringify(doc)}::jsonb, ${next}, ${stamp})
           ON CONFLICT (user_id) DO UPDATE
             SET doc = EXCLUDED.doc, version = EXCLUDED.version, updated = EXCLUDED.updated`;
  return { conflict: false, version: next, updated: stamp };
}
