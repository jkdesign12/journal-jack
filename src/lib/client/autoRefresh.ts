'use client';

import { store } from './store';
import { applyImport, mergeDuplicates } from '@/lib/journal/importing';
import type { ImportedItem } from '@/lib/journal/types';

interface ServiceInfo {
  id: string;
  name: string;
  fields: Array<{ key: string; optional?: boolean }>;
}

/** At most twice an hour: opening the app should not hammer anyone's server. */
const GAP = 30 * 60 * 1000;

/**
 * Top the current month up from whatever services are already configured, when
 * the app opens. A service being down must never interrupt opening the journal,
 * so every failure here is swallowed on purpose.
 */
export async function autoRefresh(force = false): Promise<{ added: number; names: string[] }> {
  const out = { added: 0, names: [] as string[] };
  const sync = store.doc.sync;
  if (!sync) return out;
  if (!sync.autoRefresh && !force) return out;

  const last = (sync as { lastAuto?: number }).lastAuto ?? 0;
  if (!force && Date.now() - last < GAP) return out;

  let list: ServiceInfo[];
  try {
    const res = await fetch('/api/services');
    list = ((await res.json()) as { services?: ServiceInfo[] }).services ?? [];
  } catch {
    return out; // no server: nothing to do
  }

  // only the ones that have everything they need to answer
  const ready = list.filter((svc) =>
    svc.fields.every((f) => f.optional || (sync.services[svc.id] ?? {})[f.key]),
  );
  if (!ready.length) return out;

  const cursor = store.view.cursor;

  for (const svc of ready) {
    try {
      const res = await fetch('/api/services', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: svc.id,
          cfg: sync.services[svc.id] ?? {},
          range: { from: cursor, to: cursor },
        }),
      });
      const data = (await res.json()) as { items?: ImportedItem[] };
      const landed = applyImport(store.doc, data.items ?? [], { cursor });
      mergeDuplicates(store.doc);
      if (landed.added) {
        out.added += landed.added;
        out.names.push(svc.name);
      }
    } catch {
      /* a service being down should not interrupt opening the app */
    }
  }

  (sync as { lastAuto?: number }).lastAuto = Date.now();
  store.save();
  return out;
}
