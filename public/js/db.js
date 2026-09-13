/* db.js — persistence.
   Primary: IndexedDB (state JSON + image/audio blobs).
   Fallback: localStorage for state, in-memory Map for blobs (blobs are lost on
   reload). The fallback exists because browsers block IndexedDB on file:// —
   run the site over http:// (see server.js) for real persistence. */

const DB = (() => {
  /* Deliberately still 'journal-io': this is the IndexedDB name your existing
     journal is stored under. Renaming it would leave every film, photo and song
     behind in an orphaned database. The app's name and the key are separate
     things, and only the name changed. */
  const NAME = 'journal-io';
  const VERSION = 1;
  let db = null;
  let degraded = false;
  const memBlobs = new Map();

  function open() {
    return new Promise((resolve) => {
      let req;
      try {
        req = indexedDB.open(NAME, VERSION);
      } catch (e) {
        degraded = true;
        return resolve(null);
      }
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
        if (!d.objectStoreNames.contains('blobs')) d.createObjectStore('blobs');
      };
      req.onsuccess = () => { db = req.result; resolve(db); };
      req.onerror = () => { degraded = true; resolve(null); };
      req.onblocked = () => { degraded = true; resolve(null); };
      setTimeout(() => { if (!db) { degraded = true; resolve(null); } }, 2500);
    });
  }

  function tx(store, mode) {
    return db.transaction(store, mode).objectStore(store);
  }

  function wrap(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  return {
    async init() {
      await open();
      return { degraded };
    },
    get degraded() { return degraded; },

    async loadState() {
      if (db) {
        try { return (await wrap(tx('kv', 'readonly').get('state'))) || null; }
        catch (e) { /* fall through */ }
      }
      try {
        const raw = localStorage.getItem('journal-io:state');
        return raw ? JSON.parse(raw) : null;
      } catch (e) { return null; }
    },

    async saveState(state) {
      if (db) {
        try { await wrap(tx('kv', 'readwrite').put(state, 'state')); return true; }
        catch (e) { /* fall through */ }
      }
      try { localStorage.setItem('journal-io:state', JSON.stringify(state)); return true; }
      catch (e) { return false; }
    },

    async putBlob(id, blob) {
      if (db) {
        try { await wrap(tx('blobs', 'readwrite').put(blob, id)); return id; }
        catch (e) { /* fall through */ }
      }
      memBlobs.set(id, blob);
      return id;
    },

    async getBlob(id) {
      if (db) {
        try {
          const b = await wrap(tx('blobs', 'readonly').get(id));
          if (b) return b;
        } catch (e) { /* fall through */ }
      }
      return memBlobs.get(id) || null;
    },

    async delBlob(id) {
      memBlobs.delete(id);
      if (db) { try { await wrap(tx('blobs', 'readwrite').delete(id)); } catch (e) {} }
    },

    async allBlobIds() {
      if (db) {
        try { return await wrap(tx('blobs', 'readonly').getAllKeys()); } catch (e) {}
      }
      return [...memBlobs.keys()];
    }
  };
})();
