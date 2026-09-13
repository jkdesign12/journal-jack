'use client';

import { useSyncExternalStore, useEffect, useState } from 'react';
import { store } from './store';

/**
 * Subscribes a component to the journal.
 *
 * The store hands React a version number rather than the document: the document
 * is edited in place in a hundred small ways — a note typed, a tile dragged —
 * and asking React to compare it on every keystroke would be slower than simply
 * saying that something changed.
 */
export function useJournal(): { store: typeof import('./store').store; version: number } {
  const version = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    () => 0, // the server has no journal to render
  );
  // the version is what a component should depend on: the document itself is
  // the same object from one edit to the next
  return { store, version };
}

/** Opens the journal once, when the app first mounts. */
export function useJournalReady(): boolean {
  const [ready, setReady] = useState(store.ready);

  useEffect(() => {
    if (store.ready) return;
    let cancelled = false;
    void store.init().then(() => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return ready;
}
