'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useJournal, useJournalReady } from '@/lib/client/useJournal';
import { Account } from '@/lib/client/account';
import { describeSync, syncNow } from '@/lib/client/sync';
import { Header } from './Header';
import { Board } from './Board';
import { MonthPicker } from './MonthPicker';
import { AccountPanel } from './AccountPanel';
import { Inspector } from './Inspector';
import { Toasts, toast } from './Toasts';
import { monthStyle } from '@/lib/journal/colours';
import {
  effectiveSort,
  everyBlock,
  journalSpan,
  orderedBlocks,
  type SortMode,
} from '@/lib/journal/sort';
import { hiddenTagSet, tagVisible } from '@/lib/journal/tags';
import { shiftMonth } from '@/lib/journal/dates';

type Panel = 'months' | 'account' | null;

export function Journal() {
  const ready = useJournalReady();
  const { store, version } = useJournal();
  const [panel, setPanel] = useState<Panel>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { doc, view } = store;

  /* The palette is written on the root element rather than on this component,
     because the scrim, the popovers and the browser's own theme colour all sit
     outside it and still have to agree with the year you are looking at. */
  useEffect(() => {
    if (!ready) return;
    const root = document.documentElement;
    root.dataset.theme = view.theme;

    const style = monthStyle(doc, view.cursor, view.theme);
    const owned = ['--bg', '--bg-2', '--panel', '--line', '--ink', '--ink-2', '--ink-3', '--tile-shadow'];
    for (const key of owned) {
      if (style[key]) root.style.setProperty(key, style[key]);
      else root.style.removeProperty(key);
    }
  }, [ready, doc, view.cursor, view.theme, version]);

  /* Signing in pulls the account's copy and folds it in, which is the whole
     point of having one: a journal made on another device shows up here. */
  const runSync = useCallback(async () => {
    setBusy(true);
    try {
      for (const line of describeSync(await syncNow())) toast(line.text, line.bad);
    } catch (e) {
      toast('Sync failed: ' + (e as Error).message, true);
    }
    setBusy(false);
  }, []);

  useEffect(() => {
    if (!ready) return;
    void Account.init().then((user) => {
      if (user) void runSync();
    });
  }, [ready, runSync]);

  const blocks = useMemo(() => {
    if (!ready) return [];
    const all = view.all ? everyBlock(doc) : (doc.months[view.cursor]?.blocks ?? []);
    const hidden = hiddenTagSet(view.hiddenTags);
    const visible = hidden.size ? all.filter((b) => tagVisible(b, hidden)) : all;
    return orderedBlocks(visible, effectiveSort(view.sort as SortMode, view.all));
    /* `version` looks unused to the linter, which assumes a document that is
       replaced when it changes. This one is edited in place — a note typed, a
       tile moved — so its identity never changes and the version number is the
       only thing that says anything happened. Drop it and the board freezes. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, doc, view.all, view.cursor, view.sort, view.hiddenTags, version]);

  if (!ready) {
    return (
      <main className="flex min-h-screen items-center justify-center text-ink-3">
        <span className="text-[13px]">Opening your journal…</span>
      </main>
    );
  }

  const open = openId ? store.find(openId) : undefined;
  const manual = effectiveSort(view.sort as SortMode, view.all) === 'manual';

  return (
    <>
      <Header
        view={view}
        span={journalSpan(doc)}
        signedIn={!!Account.user}
        busy={busy}
        onShift={(delta) => {
          // an arrow means "a month", so it steps out of the everything view
          if (view.all) store.setView({ all: false });
          else store.setView({ cursor: shiftMonth(view.cursor, delta) });
        }}
        onView={(mode) => {
          // a calendar is a month's worth of days, so asking for one leaves All
          if (mode === 'calendar' && view.all) store.setView({ view: mode, all: false });
          else store.setView({ view: mode });
        }}
        onSort={(sort) => store.setView({ sort })}
        onOpenMonths={() => setPanel(panel === 'months' ? null : 'months')}
        onOpenAccount={() => setPanel(panel === 'account' ? null : 'account')}
        onSync={runSync}
      />

      {panel === 'months' ? (
        <MonthPicker
          doc={doc}
          view={view}
          onPick={(cursor) => {
            store.setView({ cursor, all: false });
            setPanel(null);
          }}
          onAll={() => {
            store.setView({ all: true, view: 'grid' });
            setPanel(null);
          }}
          onClose={() => setPanel(null)}
        />
      ) : null}

      {panel === 'account' ? (
        <AccountPanel
          busy={busy}
          onClose={() => setPanel(null)}
          onSignedIn={() => {
            setPanel(null);
            void runSync();
          }}
          onSignedOut={() => {
            setPanel(null);
            toast('Signed out. Your journal is still here on this device.');
          }}
          onSync={() => void runSync()}
        />
      ) : null}

      {open ? (
        <Inspector
          block={open}
          onClose={() => setOpenId(null)}
          onChange={() => store.save()}
          onRemove={(id) => {
            store.remove(id);
            setOpenId(null);
          }}
          onMoved={(message) => toast(message)}
        />
      ) : null}

      <main className="px-5 pb-24 pt-4">
        <Board
          blocks={blocks}
          manual={manual}
          onOpen={setOpenId}
          empty={
            <div className="max-w-sm text-center">
              <b className="mb-1 block text-[15px]">
                {view.all ? 'Nothing in the journal yet' : 'Nothing here yet'}
              </b>
              <span className="text-[12.5px] text-ink-3">
                {Account.user
                  ? 'Nothing in this month. Try another, or All.'
                  : 'Sign in to pull the journal from your account, or drop photos here.'}
              </span>
            </div>
          }
        />
      </main>

      <Toasts />
    </>
  );
}
