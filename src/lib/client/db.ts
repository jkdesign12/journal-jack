/* Where the journal lives on this device.
 *
 * IndexedDB holds the document and every photo and song, which is what makes
 * the app work offline and makes a picture appear the instant you drop it. The
 * account is a copy, not the original.
 *
 * When IndexedDB is unavailable — a browser blocks it on file://, and private
 * windows can refuse it — the document falls back to localStorage and files to
 * memory, so the app still runs for the length of a visit and says so.
 */

import type { JournalDoc } from '@/lib/journal/types';

/* Deliberately still 'journal-io': this is the name existing journals are
   stored under. Renaming it would leave every film, photo and song behind in an
   orphaned database. The app's name and this key are separate things. */
const NAME = 'journal-io';
const VERSION = 1;
const STATE_KEY = 'journal-io:state';

type Store = 'kv' | 'blobs';

let db: IDBDatabase | null = null;
let degraded = false;
const memBlobs = new Map<string, Blob>();

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(NAME, VERSION);
    } catch {
      degraded = true;
      return resolve(null);
    }
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
      if (!d.objectStoreNames.contains('blobs')) d.createObjectStore('blobs');
    };
    req.onsuccess = () => {
      db = req.result;
      resolve(db);
    };
    req.onerror = () => {
      degraded = true;
      resolve(null);
    };
    req.onblocked = () => {
      degraded = true;
      resolve(null);
    };
    // a tab that never answers should not hold up the whole app
    setTimeout(() => {
      if (!db) {
        degraded = true;
        resolve(null);
      }
    }, 2500);
  });
}

const tx = (store: Store, mode: IDBTransactionMode) =>
  db!.transaction(store, mode).objectStore(store);

function wrap<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export const DB = {
  async init(): Promise<{ degraded: boolean }> {
    await open();
    return { degraded };
  },

  get degraded() {
    return degraded;
  },

  async loadState(): Promise<JournalDoc | null> {
    if (db) {
      try {
        const doc = await wrap<JournalDoc | undefined>(tx('kv', 'readonly').get('state'));
        if (doc) return doc;
      } catch {
        /* fall through to the simpler store */
      }
    }
    try {
      const raw = localStorage.getItem(STATE_KEY);
      return raw ? (JSON.parse(raw) as JournalDoc) : null;
    } catch {
      return null;
    }
  },

  async saveState(state: JournalDoc): Promise<boolean> {
    if (db) {
      try {
        await wrap(tx('kv', 'readwrite').put(state, 'state'));
        return true;
      } catch {
        /* fall through */
      }
    }
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify(state));
      return true;
    } catch {
      return false;
    }
  },

  async clearState(): Promise<void> {
    if (db) {
      try {
        await wrap(tx('kv', 'readwrite').delete('state'));
      } catch {
        /* nothing to clear */
      }
    }
    try {
      localStorage.removeItem(STATE_KEY);
    } catch {
      /* nothing to clear */
    }
  },

  async putBlob(id: string, blob: Blob): Promise<string> {
    if (db) {
      try {
        await wrap(tx('blobs', 'readwrite').put(blob, id));
        return id;
      } catch {
        /* fall through */
      }
    }
    memBlobs.set(id, blob);
    return id;
  },

  async getBlob(id: string): Promise<Blob | null> {
    if (db) {
      try {
        const found = await wrap<Blob | undefined>(tx('blobs', 'readonly').get(id));
        if (found) return found;
      } catch {
        /* fall through */
      }
    }
    return memBlobs.get(id) ?? null;
  },

  async delBlob(id: string): Promise<void> {
    if (db) {
      try {
        await wrap(tx('blobs', 'readwrite').delete(id));
      } catch {
        /* fall through */
      }
    }
    memBlobs.delete(id);
  },

  async allBlobIds(): Promise<string[]> {
    if (db) {
      try {
        const keys = await wrap<IDBValidKey[]>(tx('blobs', 'readonly').getAllKeys());
        return keys.map(String);
      } catch {
        /* fall through */
      }
    }
    return [...memBlobs.keys()];
  },
};
