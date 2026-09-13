import type { JournalDoc } from '@/lib/journal/types';

/**
 * What a place to keep a journal has to be able to do.
 *
 * Two of these exist: Postgres with a blob store, for a host with no disk that
 * survives a deploy; and SQLite with files under ./data, for running it on your
 * own machine. The routes never know which one they are talking to.
 */
export interface UserRow {
  id: string;
  email: string;
  hash: string;
  salt: string;
}

export interface StoredJournal {
  doc: JournalDoc | null;
  version: number;
  updated: number;
}

export type BlobRead =
  | { mime: string; url: string }
  | { mime: string; stream: ReadableStream }
  | { mime: string; buf: Buffer }
  | null;

export interface Backend {
  readonly kind: 'postgres' | 'sqlite';

  userByEmail(email: string): Promise<UserRow | null>;
  createUser(row: UserRow & { created: number }): Promise<void>;
  userCount(): Promise<number>;

  createSession(token: string, userId: string, created: number): Promise<void>;
  sessionOwner(token: string): Promise<{ id: string; email: string; created: number } | null>;
  deleteSession(token: string): Promise<void>;

  getJournal(userId: string): Promise<StoredJournal>;
  putJournal(userId: string, doc: JournalDoc, baseVersion?: number | null): Promise<{
    conflict: boolean;
    version?: number;
    updated?: number;
    doc?: JournalDoc | null;
  }>;

  putBlob(userId: string, id: string, mime: string | null, buf: Buffer): Promise<void>;
  recordBlob(userId: string, id: string, mime: string | null, size: number, url: string): Promise<void>;
  getBlob(userId: string, id: string): Promise<BlobRead>;
  listBlobs(userId: string): Promise<string[]>;

  artLookup(key: string): Promise<string | undefined>;
  artStore(key: string, url: string): Promise<void>;
}
