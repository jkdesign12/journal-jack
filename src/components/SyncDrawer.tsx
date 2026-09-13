'use client';

import { useEffect, useRef, useState } from 'react';
import type { JournalDoc, ImportedItem } from '@/lib/journal/types';
import { fromLetterboxdExport } from '@/lib/client/letterboxd';

interface ServiceInfo {
  id: string;
  name: string;
  access: string;
  tag: string;
  history: string;
  note: string;
  csv?: boolean;
  fields: Array<{
    key: string;
    label: string;
    placeholder?: string;
    optional?: boolean;
    secret?: boolean;
    type?: string;
    options?: string[];
  }>;
}

/**
 * Where the journal is told about the places your life is already recorded.
 *
 * Each service says plainly what it can actually reach — Letterboxd's feed is
 * the last fifty watches and nothing more — because finding that out after
 * importing six months of nothing is worse than being told first.
 */
export function SyncDrawer({
  doc,
  onChange,
  onPull,
  onExport,
  onClose,
  busy,
}: {
  doc: JournalDoc;
  onChange: () => void;
  onPull: (id: string, name: string) => void;
  onExport: (items: ImportedItem[], from: string) => void;
  onClose: () => void;
  busy: boolean;
}) {
  const [services, setServices] = useState<ServiceInfo[]>([]);
  const [error, setError] = useState('');
  const picker = useRef<HTMLInputElement>(null);
  const [dropping, setDropping] = useState(false);

  useEffect(() => {
    void fetch('/api/services')
      .then((r) => r.json())
      .then((d: { services?: ServiceInfo[] }) => setServices(d.services ?? []))
      .catch(() => setError('Could not reach the server'));
  }, []);

  const sync = (doc.sync ??= { services: {}, range: { from: '', to: '' } });
  const cfgFor = (id: string) => (sync.services[id] ??= {});

  const takeExport = async (file: File | undefined) => {
    if (!file) return;
    try {
      const { items, from } = await fromLetterboxdExport(file);
      onExport(items, from);
    } catch (e) {
      setError('Export import failed: ' + (e as Error).message);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/45" onClick={onClose} aria-hidden />
      <aside
        role="dialog"
        aria-label="Sync services"
        className="fixed inset-y-0 right-0 z-[60] flex w-[340px] max-w-full flex-col overflow-auto border-l border-line bg-panel shadow-[var(--shadow)]"
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="font-serif text-[19px]">Sync services</h2>
          <button
            className="flex h-8 w-8 items-center justify-center rounded-[9px] text-ink-2 hover:bg-bg-2 hover:text-ink"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="flex flex-col gap-5 p-4">
          <label className="flex items-center gap-2 text-[12.5px]">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[var(--accent)]"
              checked={sync.autoRefresh !== false}
              onChange={(e) => {
                sync.autoRefresh = e.target.checked;
                onChange();
              }}
            />
            Refresh what is configured when the app opens
          </label>

          <div className="flex gap-2">
            <label className="flex flex-1 flex-col gap-1.5">
              <span className="text-[10.5px] uppercase tracking-[0.12em] text-ink-3">From</span>
              <input
                className="field"
                type="month"
                value={sync.range.from}
                onChange={(e) => {
                  sync.range.from = e.target.value;
                  onChange();
                }}
              />
            </label>
            <label className="flex flex-1 flex-col gap-1.5">
              <span className="text-[10.5px] uppercase tracking-[0.12em] text-ink-3">To</span>
              <input
                className="field"
                type="month"
                value={sync.range.to}
                onChange={(e) => {
                  sync.range.to = e.target.value;
                  onChange();
                }}
              />
            </label>
          </div>

          {error ? <p className="text-[12px] text-[#e2725b]">{error}</p> : null}

          {services.map((svc) => {
            const cfg = cfgFor(svc.id);
            return (
              <section key={svc.id} className="flex flex-col gap-2 border-t border-line pt-4">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="text-[14px] font-medium">{svc.name}</h3>
                  <span className="text-[10.5px] uppercase tracking-[0.1em] text-ink-3">{svc.tag}</span>
                </div>

                <p className="text-[11.5px] leading-relaxed text-ink-3">{svc.note}</p>

                {svc.fields.map((f) =>
                  f.type === 'select' ? (
                    <label key={f.key} className="flex flex-col gap-1.5">
                      <span className="text-[10.5px] uppercase tracking-[0.12em] text-ink-3">{f.label}</span>
                      <select
                        className="field"
                        value={cfg[f.key] ?? ''}
                        onChange={(e) => {
                          cfg[f.key] = e.target.value;
                          onChange();
                        }}
                      >
                        {(f.options ?? []).map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <label key={f.key} className="flex flex-col gap-1.5">
                      <span className="text-[10.5px] uppercase tracking-[0.12em] text-ink-3">{f.label}</span>
                      <input
                        className="field"
                        type={f.secret ? 'password' : 'text'}
                        placeholder={f.placeholder}
                        value={cfg[f.key] ?? ''}
                        onChange={(e) => {
                          cfg[f.key] = e.target.value;
                          onChange();
                        }}
                      />
                    </label>
                  ),
                )}

                <button className="btn" disabled={busy} onClick={() => onPull(svc.id, svc.name)}>
                  Pull from {svc.name}
                </button>

                {svc.csv ? (
                  <>
                    <div
                      className={
                        'rounded-xl border border-dashed p-3 text-center text-[11.5px] ' +
                        (dropping ? 'border-accent text-accent' : 'border-line text-ink-3')
                      }
                      onDragOver={(e) => {
                        e.preventDefault();
                        setDropping(true);
                      }}
                      onDragLeave={() => setDropping(false)}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setDropping(false);
                        void takeExport(e.dataTransfer.files?.[0]);
                      }}
                      onClick={() => picker.current?.click()}
                    >
                      <b className="block text-ink-2">Drop diary.csv or the export .zip</b>
                      Your whole history, read here — it never leaves this device.
                    </div>
                    <input
                      ref={picker}
                      type="file"
                      accept=".csv,.zip"
                      hidden
                      onChange={(e) => {
                        void takeExport(e.target.files?.[0]);
                        e.target.value = '';
                      }}
                    />
                  </>
                ) : null}
              </section>
            );
          })}
        </div>
      </aside>
    </>
  );
}
