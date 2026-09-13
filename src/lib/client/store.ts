/* The journal, while the app is running.
 *
 * One store holds the document and this tab's view of it, and tells React when
 * either changes. Saving is debounced, merged against whatever is already on
 * disk, announced to the other tabs, and then pushed to the account.
 *
 * The order matters: this device's copy is written first and the account
 * second, so losing the network costs nothing.
 */

import { DB } from './db';
import { Account } from './account';
import { defaultView, loadView, saveView, type ViewState } from './view';
import { Stamper, mergeDocs } from '@/lib/journal/merge';
import { ensureShape } from '@/lib/journal/shape';
import { emptyDoc, type JournalDoc, type Month, blankMonth } from '@/lib/journal/types';

type Listener = () => void;

const SAVE_DELAY = 250;
const BUS = 'journal:doc';

export class JournalStore {
  doc: JournalDoc = emptyDoc();
  view: ViewState = defaultView();
  ready = false;
  degraded = false;

  private listeners = new Set<Listener>();
  private stamper = new Stamper();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private bus: BroadcastChannel | null = null;
  private snapshot = 0;

  /* React reads a version number rather than the document itself: the document
     is edited in place in a hundred small ways, and asking React to diff it on
     every keystroke would be slower than simply saying "something changed". */
  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = (): number => this.snapshot;

  private emit(): void {
    this.snapshot++;
    for (const fn of this.listeners) fn();
  }

  async init(): Promise<void> {
    const { degraded } = await DB.init();
    this.degraded = degraded;

    const loaded = await DB.loadState();
    this.doc = loaded ?? emptyDoc();
    this.view = loadView();
    ensureShape(this.doc);
    this.stamper.reset(this.doc);

    if (typeof BroadcastChannel !== 'undefined') {
      this.bus = new BroadcastChannel(BUS);
      this.bus.addEventListener('message', (e: MessageEvent<JournalDoc>) => {
        const incoming = e.data;
        if (!incoming || typeof incoming !== 'object' || !incoming.months) return;
        /* Comparing one stamp for the whole document was wrong: a tab that had
           merely changed months looked "newer" and threw away another tab's new
           photo. Merge month by month instead, so an addition anywhere lives. */
        mergeDocs(this.doc, incoming);
        this.stamper.reset(this.doc);
        this.emit(); // never touches the view: this tab keeps its own month
      });
    }

    this.ready = true;
    this.emit();
  }

  /** The month on the cursor, created if this is the first thing in it. */
  month(key = this.view.cursor): Month {
    this.doc.months[key] ??= blankMonth();
    return this.doc.months[key];
  }

  setView(patch: Partial<ViewState>): void {
    this.view = { ...this.view, ...patch };
    saveView(this.view);
    this.emit();
  }

  /** Something in the journal changed. Redraw now, write shortly. */
  save(): void {
    this.doc.updatedAt = Date.now();
    this.emit();

    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.flush();
    }, SAVE_DELAY);
  }

  /** Write it out now, rather than at the end of the debounce. */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    this.stamper.stamp(this.doc);

    // whatever else has been written here since this tab last looked
    const stored = await DB.loadState().catch(() => null);
    if (stored) mergeDocs(this.doc, stored);

    const ok = await DB.saveState(this.doc);
    this.stamper.reset(this.doc);

    try {
      this.bus?.postMessage(this.doc);
    } catch {
      /* a document with something unclonable in it is still saved locally */
    }

    if (Account.user) void this.push();
    if (!ok) throw new Error('Could not save — storage is unavailable');
  }

  /** Send this device's copy to the account, merging if it has moved on. */
  private async push(): Promise<void> {
    try {
      const res = await Account.pushDoc(this.doc);
      if (res.conflict && res.doc) {
        mergeDocs(this.doc, res.doc);
        this.stamper.reset(this.doc);
        await DB.saveState(this.doc);
        this.emit();
        await Account.pushDoc(this.doc); // push the union back
      }
    } catch {
      /* offline: this device's copy is still the authoritative one */
    }
  }

  /** Take the account's copy and fold it in. Nothing is ever replaced. */
  async mergeRemote(remote: JournalDoc | null | undefined): Promise<void> {
    if (!remote) return;
    mergeDocs(this.doc, remote);
    ensureShape(this.doc);
    this.stamper.reset(this.doc);
    await DB.saveState(this.doc);
    this.emit();
  }

  /** Swap in a whole document — an import, or a signed-out reset. */
  async adopt(doc: JournalDoc): Promise<void> {
    this.doc = ensureShape(doc);
    this.stamper.reset(this.doc);
    await DB.saveState(this.doc);
    this.emit();
  }
}

export const store = new JournalStore();
