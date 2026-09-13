/* Bringing an older journal up to date.
 *
 * Runs on every load, on whatever document turned up — from this browser, from
 * the account, or from a file someone imported. It only ever fills in or moves
 * things that the app itself used to store differently. A choice you made on
 * purpose, including the choice to leave something blank, survives it.
 */

import { defaultTag } from './tags';
import type { JournalDoc } from './types';

/** View settings that used to live in the document and are now per tab. */
export const VIEW_FIELDS = ['cursor', 'view', 'sort', 'theme', 'autoplay', 'all', 'hiddenTags'] as const;

export function ensureShape(doc: JournalDoc): JournalDoc {
  doc.months = doc.months ?? {};
  doc.sync = doc.sync ?? { services: {}, range: { from: '', to: '' } };
  doc.sync.services = doc.sync.services ?? {};
  doc.sync.range = doc.sync.range ?? { from: '', to: '' };
  if (doc.sync.autoRefresh === undefined) doc.sync.autoRefresh = true;

  /* Colours used to be per month. Lift any that exist up to their year so a
     journal made before that change keeps its look. Later months win, being the
     more recent choice. */
  for (const key of Object.keys(doc.months).sort()) {
    const m = doc.months[key];
    if (!m || (!m.bg && !m.ink)) continue;
    doc.yearColours = doc.yearColours ?? {};
    doc.yearColours[key.slice(0, 4)] = { bg: m.bg ?? null, ink: m.ink ?? null };
    delete m.bg;
    delete m.ink;
  }

  for (const m of Object.values(doc.months)) {
    for (const b of m.blocks ?? []) {
      if (b.kind !== 'media') continue;

      // one tag used to be all you could have: carry it into the list
      if (b.tag !== undefined && !Array.isArray(b.tags)) {
        b.tags = b.tag ? [b.tag] : [];
        delete b.tag;
      }
      if (Array.isArray(b.tags)) continue; // already decided, empty or not

      /* Everything imported before tags existed can say what it is from its
         source alone, so it is filled in rather than left to you. */
      const t = defaultTag(b);
      if (t) b.tags = [t];
    }
  }

  // view settings are per tab now; drop any left over so they stop travelling
  // to the server and back
  for (const k of VIEW_FIELDS) {
    delete (doc as unknown as Record<string, unknown>)[k];
  }

  return doc;
}
