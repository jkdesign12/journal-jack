'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useJournal, useJournalReady } from '@/lib/client/useJournal';
import { Account } from '@/lib/client/account';
import { describeSync, syncFiles, syncNow } from '@/lib/client/sync';
import { addFiles, addImageByLink, describeAdd } from '@/lib/client/uploads';
import { describeArtwork, fillArtwork } from '@/lib/client/artwork';
import { autoRefresh } from '@/lib/client/autoRefresh';
import { exportJournal, importJournal, sampleBlocks } from '@/lib/client/journalFile';
import { resetLayout } from '@/lib/client/placing';
import { gridMetrics, unitsOf } from '@/lib/journal/layout';
import { applyImport, mergeDuplicates, purgeFeedEntries, attachReviews } from '@/lib/journal/importing';
import { monthStyle } from '@/lib/journal/colours';
import { MONTHS, cursorParts, shiftMonth } from '@/lib/journal/dates';
import { effectiveSort, everyBlock, journalSpan, orderedBlocks, type SortMode } from '@/lib/journal/sort';
import { hiddenTagSet, tagVisible } from '@/lib/journal/tags';
import type { Block, ImportedItem, Song } from '@/lib/journal/types';

import { Header } from './Header';
import { Board } from './Board';
import { MonthSections } from './MonthSections';
import { Calendar } from './Calendar';
import { MonthPicker } from './MonthPicker';
import { AccountPanel } from './AccountPanel';
import { Inspector } from './Inspector';
import { TagFilter } from './TagFilter';
import { MediaPicker } from './MediaPicker';
import { ColourPicker } from './ColourPicker';
import { WidgetPicker } from './WidgetPicker';
import { WidgetBody, makeWidget } from './Widget';
import { Menu, type MenuAction } from './Menu';
import { SyncDrawer } from './SyncDrawer';
import { Player } from './Player';
import { Toasts, toast } from './Toasts';
import { Banner } from './Banner';
import { DropOverlay } from './DropOverlay';
import { Empty } from './Empty';

type Panel = 'months' | 'account' | 'tags' | 'media' | 'widgets' | 'colours' | 'menu' | 'sync' | null;

export function Journal() {
  const ready = useJournalReady();
  const { store, version } = useJournal();
  const [panel, setPanel] = useState<Panel>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [dropping, setDropping] = useState(false);
  const jsonPicker = useRef<HTMLInputElement>(null);
  const dayPicker = useRef<HTMLInputElement>(null);

  const { doc, view } = store;
  const change = useCallback(() => store.save(), [store]);

  /* The palette goes on the root element rather than on this component, because
     the scrim, the popovers and the browser's own theme colour all sit outside
     it and still have to agree with the year you are looking at. */
  useEffect(() => {
    if (!ready) return;
    const root = document.documentElement;
    root.dataset.theme = view.theme;

    const style = monthStyle(doc, view.cursor, view.theme);
    for (const key of ['--bg', '--bg-2', '--panel', '--line', '--ink', '--ink-2', '--ink-3', '--tile-shadow']) {
      if (style[key]) root.style.setProperty(key, style[key]);
      else root.style.removeProperty(key);
    }
  }, [ready, doc, view.cursor, view.theme, version]);

  const runSync = useCallback(async () => {
    setBusy(true);
    try {
      for (const line of describeSync(await syncNow())) toast(line.text, line.bad);
    } catch (e) {
      toast('Sync failed: ' + (e as Error).message, true);
    }
    setBusy(false);
  }, []);

  const runArtwork = useCallback(async (loud = false) => {
    const run = await fillArtwork();
    if (loud || run.filled || run.repaired) {
      for (const line of describeArtwork(run)) toast(line.text, line.bad);
    }
  }, []);

  /* Signing in pulls the account's copy; anything imported before posters
     existed gets picked up too, without waiting for a menu click. */
  useEffect(() => {
    if (!ready) return;
    void Account.init().then(async (user) => {
      if (user) await runSync();

      // then top up this month from whatever services are configured
      setTimeout(() => {
        void autoRefresh().then((res) => {
          if (res.added) toast(`Refreshed: ${res.added} new from ${res.names.join(', ')}`);
        });
      }, 800);

      /* Anything imported before posters existed — or left behind when a lookup
         was throttled — gets picked up here, without waiting for a menu click. */
      setTimeout(() => void runArtwork(), 2500);
    });
  }, [ready, runSync, runArtwork]);

  const take = useCallback(
    async (files: FileList | File[], day: number | null = null) => {
      const result = await addFiles(files, day);
      if (result.added) toast(describeAdd(result));
      void runArtwork();
    },
    [runArtwork],
  );

  /* Dropping anywhere on the page adds to the month you are looking at — or
     imports a whole diary, if that is what landed. */
  useEffect(() => {
    if (!ready) return;

    let depth = 0;

    const enter = (e: DragEvent) => {
      if (![...(e.dataTransfer?.types ?? [])].includes('Files')) return;
      depth++;
      setDropping(true);
    };

    const leave = () => {
      if (--depth <= 0) {
        depth = 0;
        setDropping(false);
      }
    };

    const over = (e: DragEvent) => {
      if ([...(e.dataTransfer?.types ?? [])].includes('Files')) e.preventDefault();
    };

    const drop = async (e: DragEvent) => {
      depth = 0;
      setDropping(false);
      const files = [...(e.dataTransfer?.files ?? [])];
      if (!files.length) return;
      e.preventDefault();

      const song = files.find((f) => /^audio\//.test(f.type));
      if (song) {
        await setSong(song);
        return;
      }

      const exportFile = files.find((f) => /\.(csv|zip)$/i.test(f.name));
      if (exportFile) {
        const { fromLetterboxdExport } = await import('@/lib/client/letterboxd');
        try {
          const { items, from } = await fromLetterboxdExport(exportFile);
          takeExport(items, from);
        } catch (err) {
          toast('Export import failed: ' + (err as Error).message, true);
        }
        return;
      }

      await take(files);
    };

    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, take]);

  /* The keys the original answered to. Typing in a field is never a shortcut. */
  useEffect(() => {
    if (!ready) return;

    const onKey = (e: KeyboardEvent) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? '');
      if (e.key === 'Escape') {
        setPanel(null);
        setOpenId(null);
        return;
      }
      if (typing || e.metaKey || e.ctrlKey) return;

      if (e.key === 'ArrowLeft') shift(-1);
      if (e.key === 'ArrowRight') shift(1);
      if (e.key === 'g') store.setView({ view: 'grid' });
      if (e.key === ' ') {
        const audio = document.querySelector('audio');
        if (audio?.src) {
          e.preventDefault();
          if (audio.paused) void audio.play().catch(() => {});
          else audio.pause();
        }
      }
      if (e.key === 'c') store.setView({ view: 'calendar', all: false });
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, view.cursor, view.all]);

  const blocks = useMemo(() => {
    if (!ready) return [];
    const all = view.all ? everyBlock(doc) : (doc.months[view.cursor]?.blocks ?? []);
    const hidden = hiddenTagSet(view.hiddenTags);
    const visible = hidden.size ? all.filter((b) => tagVisible(b, hidden)) : all;
    return orderedBlocks(visible, effectiveSort(view.sort as SortMode, view.all));
    /* `version` looks unused to the linter, which assumes a document that is
       replaced when it changes. This one is edited in place, so the version is
       the only thing that says anything happened. Drop it and the board freezes. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, doc, view.all, view.cursor, view.sort, view.hiddenTags, version]);

  if (!ready) {
    return (
      <main className="flex min-h-screen items-center justify-center text-ink-3">
        <span className="text-[13px]">Opening your journal…</span>
      </main>
    );
  }

  const shift = (delta: number) => {
    // an arrow means "a month", so it steps out of the everything view first
    if (view.all) store.setView({ all: false });
    else store.setView({ cursor: shiftMonth(view.cursor, delta) });
  };

  const month = doc.months[view.cursor];
  const open = openId ? store.find(openId) : undefined;
  const order = effectiveSort(view.sort as SortMode, view.all);
  const manual = order === 'manual';
  const byMonth = order === 'month';

  async function setSong(file: File) {
    const { DB } = await import('@/lib/client/db');
    const { uid } = await import('@/lib/journal/uid');
    const blobId = uid();
    await DB.putBlob(blobId, file);
    store.month().song = { blobId, name: file.name.replace(/\.[^.]+$/, '') };
    store.save();
    if (Account.user) void syncFiles();
    toast('Song set for this month');
  }

  function takeExport(items: ImportedItem[], from: string) {
    const res = attachReviews(doc, items);
    const fresh = items.filter((i) => !i.review || res.unmatched.includes(i));
    const landed = applyImport(doc, fresh, { origin: 'export', cursor: view.cursor });

    const purge = purgeFeedEntries(doc);
    mergeDuplicates(doc);
    store.save();

    toast(`${from}: ${landed.added} added across ${landed.months.length} months`);
    if (res.attached) toast(`Reviews: ${res.attached} added to notes`);
    if (purge.removed) {
      toast(
        `Export is now the record: ${purge.removed} RSS ${purge.removed === 1 ? 'entry' : 'entries'} removed` +
          (purge.donated ? `, ${purge.donated} posters kept` : ''),
      );
    }
    void runArtwork();
  }

  async function pullService(id: string, name: string) {
    setBusy(true);
    try {
      const res = await fetch('/api/services', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, cfg: doc.sync?.services[id] ?? {}, range: doc.sync?.range ?? {} }),
      });
      const data = (await res.json()) as { items?: ImportedItem[]; error?: string };
      if (data.error) throw new Error(data.error);

      const landed = applyImport(doc, data.items ?? [], { cursor: view.cursor });
      mergeDuplicates(doc);
      store.save();
      toast(
        landed.added
          ? `${name}: ${landed.added} added across ${landed.months.length} months`
          : `${name}: nothing new (${data.items?.length ?? 0} already in the journal)`,
      );
      void runArtwork();
    } catch (e) {
      toast(name + ': ' + (e as Error).message, true);
    }
    setBusy(false);
  }

  function onMenu(act: MenuAction) {
    setPanel(null);
    if (act === 'colours') setPanel('colours');
    if (act === 'theme') store.setView({ theme: view.theme === 'dark' ? 'light' : 'dark' });
    if (act === 'export') void exportJournal();
    if (act === 'import') jsonPicker.current?.click();
    if (act === 'sync') void runSync();
    if (act === 'posters') void runArtwork(true);
    if (act === 'files') {
      void (async () => {
        setBusy(true);
        for (const line of describeSync(await syncFiles())) toast(line.text, line.bad);
        setBusy(false);
      })();
    }
    if (act === 'dedupe') {
      const n = mergeDuplicates(doc);
      store.save();
      toast(n ? `Merged ${n} duplicate${n === 1 ? '' : 's'}` : 'No duplicates found');
    }
    if (act === 'sample') {
      store.add(sampleBlocks());
      toast('Sample blocks added — clearly labelled as demo data');
    }
    if (act === 'clear') {
      // in the everything view there is no "this month" to erase
      if (view.all) {
        toast('Open the month you want to erase first', true);
        return;
      }
      const { year, month: mo } = cursorParts(view.cursor);
      if (!confirm(`Erase everything in ${MONTHS[mo - 1]} ${year}?`)) return;
      doc.months[view.cursor] = { blocks: [], song: null, erasedAt: Date.now() };
      store.save();
      toast('Month erased');
    }
  }

  return (
    <>
      <Banner degraded={store.degraded} />

      <Header
        view={view}
        order={order}
        span={journalSpan(doc)}
        signedIn={!!Account.user}
        busy={busy}
        canReset={manual && !view.all}
        onShift={shift}
        onView={(mode) => {
          if (mode === 'calendar' && view.all) store.setView({ view: mode, all: false });
          else store.setView({ view: mode });
        }}
        onSort={(sort) => store.setView({ sort })}
        onOpenMonths={() => setPanel(panel === 'months' ? null : 'months')}
        onOpenAccount={() => setPanel(panel === 'account' ? null : 'account')}
        onOpenTags={() => setPanel(panel === 'tags' ? null : 'tags')}
        onOpenMedia={() => setPanel(panel === 'media' ? null : 'media')}
        onOpenWidgets={() => setPanel(panel === 'widgets' ? null : 'widgets')}
        onOpenSync={() => setPanel(panel === 'sync' ? null : 'sync')}
        onOpenMenu={() => setPanel(panel === 'menu' ? null : 'menu')}
        onSync={runSync}
        onResetLayout={() => {
          const m = gridMetrics(document.querySelector('.board')?.clientWidth ?? 1000);
          if (!m || !month) return;
          const moved = resetLayout(month.blocks, m, (b) => unitsOf(b, m));
          store.save();
          toast(
            moved
              ? `Layout reset — ${moved} tile${moved === 1 ? '' : 's'} repacked`
              : 'Nothing has been moved in this month yet',
          );
        }}
      />

      {!view.all ? (
        <Player
          song={month?.song}
          autoplay={view.autoplay}
          onAutoplay={(on) => store.setView({ autoplay: on })}
          onSet={(song: Song) => {
            store.month().song = song;
            store.save();
          }}
          onClear={() => {
            const m = store.month();
            if (m.song) void import('@/lib/client/db').then(({ DB }) => DB.delBlob(m.song!.blobId));
            m.song = null;
            store.save();
          }}
          onNote={toast}
        />
      ) : null}

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

      {panel === 'tags' ? (
        <TagFilter
          blocks={everyBlock(doc)}
          hidden={view.hiddenTags}
          onChange={(hiddenTags) => store.setView({ hiddenTags })}
          onClose={() => setPanel(null)}
        />
      ) : null}

      {panel === 'media' ? (
        <MediaPicker
          onClose={() => setPanel(null)}
          onFiles={(files) => void take(files)}
          onLink={(url) => {
            const res = addImageByLink(url);
            toast(res.message, !res.ok);
            return res.ok;
          }}
        />
      ) : null}

      {panel === 'widgets' ? (
        <WidgetPicker
          onPick={(kind) => {
            store.add([makeWidget(kind)]);
            setPanel(null);
          }}
          onClose={() => setPanel(null)}
        />
      ) : null}

      {panel === 'colours' ? (
        <ColourPicker
          doc={doc}
          cursor={view.cursor}
          theme={view.theme}
          onChange={change}
          onClose={() => setPanel(null)}
        />
      ) : null}

      {panel === 'menu' ? <Menu onPick={onMenu} onClose={() => setPanel(null)} /> : null}

      {panel === 'sync' ? (
        <SyncDrawer
          doc={doc}
          busy={busy}
          onChange={change}
          onPull={pullService}
          onExport={takeExport}
          onClose={() => setPanel(null)}
        />
      ) : null}

      {open ? (
        <Inspector
          block={open}
          onClose={() => setOpenId(null)}
          onChange={change}
          onRemove={(id) => {
            store.remove(id);
            setOpenId(null);
          }}
          onMoved={(message) => toast(message)}
        />
      ) : null}

      <main className="px-5 pb-24 pt-4 max-[640px]:px-3">
        {view.view === 'grid' ? (
          byMonth ? (
          <MonthSections
            blocks={blocks}
            onOpen={setOpenId}
            onRemove={(id) => store.remove(id)}
            onCycleSize={(id) => {
              const b = store.find(id);
              if (!b) return;
              const sizes = ['sm', 'md', 'lg'] as const;
              const at = sizes.indexOf((b.size as 'sm') ?? 'sm');
              b.size = sizes[(at + 1) % sizes.length];
              delete b.uw; // back to the shape the content asks for
              delete b.uh;
              store.save();
            }}
            onChange={change}
            onRefuse={(message) => toast(message, true)}
            selected={selected}
            onSelect={setSelected}
            onMeasured={(id, ratio) => {
              const b = store.find(id);
              if (!b || b.ratio === ratio) return;
              b.ratio = ratio;
              store.save();
            }}
            renderWidget={(b) => (
              <WidgetBody block={b} onChange={change} stats={statsFor(month?.blocks ?? [])} />
            )}
            empty={
              <Empty
                all={view.all}
                filtered={!!view.hiddenTags.length}
                onShowAll={() => store.setView({ hiddenTags: [] })}
              />
            }
          />
          ) : (
          <Board
            blocks={blocks}
            manual={manual}
            onOpen={setOpenId}
            onRemove={(id) => store.remove(id)}
            onCycleSize={(id) => {
              const b = store.find(id);
              if (!b) return;
              const sizes = ['sm', 'md', 'lg'] as const;
              const at = sizes.indexOf((b.size as 'sm') ?? 'sm');
              b.size = sizes[(at + 1) % sizes.length];
              delete b.uw; // back to the shape the content asks for
              delete b.uh;
              store.save();
            }}
            onChange={change}
            onRefuse={(message) => toast(message, true)}
            selected={selected}
            onSelect={setSelected}
            onMeasured={(id, ratio) => {
              const b = store.find(id);
              if (!b || b.ratio === ratio) return;
              b.ratio = ratio;
              store.save();
            }}
            renderWidget={(b) => (
              <WidgetBody block={b} onChange={change} stats={statsFor(month?.blocks ?? [])} />
            )}
            empty={
              <Empty
                all={view.all}
                filtered={!!view.hiddenTags.length}
                onShowAll={() => store.setView({ hiddenTags: [] })}
              />
            }
          />
          )
        ) : (
          <Calendar
            cursor={view.cursor}
            blocks={blocks}
            onOpen={setOpenId}
            onDropOn={(id, day) => {
              const b = store.find(id);
              if (!b) return;
              b.day = day;
              b.date = `${view.cursor}-${String(day).padStart(2, '0')}`;
              store.save();
            }}
            onFilesOn={(files, day) => void take(files, day)}
            onAddOn={(day) => {
              dayPicker.current!.dataset.day = String(day);
              dayPicker.current!.click();
            }}
          />
        )}
      </main>

      <input
        ref={dayPicker}
        type="file"
        accept="image/*,video/*"
        multiple
        hidden
        onChange={(e) => {
          const day = Number(e.target.dataset.day) || null;
          if (e.target.files?.length) void take(e.target.files, day);
          e.target.value = '';
        }}
      />

      <input
        ref={jsonPicker}
        type="file"
        accept=".json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          if (!confirm('Replace the current journal with this file?')) return;
          void importJournal(file)
            .then(() => toast('Journal imported'))
            .catch((err: Error) => toast('Import failed: ' + err.message, true));
          e.target.value = '';
        }}
      />

      <DropOverlay over={dropping} />
      <Toasts />
    </>
  );
}

function statsFor(blocks: Block[]) {
  return {
    items: blocks.length,
    films: blocks.filter((b) => b.source === 'letterboxd').length,
    records: blocks.filter((b) => b.source === 'musicboard' || b.source === 'lastfm').length,
    photos: blocks.filter((b) => b.kind === 'photo').length,
  };
}
