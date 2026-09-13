/* app.js — journal.jack
   One month at a time. Two views over the same blocks: a moodboard grid and a
   calendar. Blocks are photos, imported media, or widgets. */

(() => {

/* ---------------- tiny helpers ---------------- */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const pad = (n) => String(n).padStart(2, '0');
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const ACCENTS = ['#e0a45e','#c4736f','#88a97f','#7f97c4','#ab8fc4','#cfc6b6'];
/* Size is width only — how many columns a block takes. Height comes from the
   content's own proportions (see layoutGrid). 'wide'/'tall' are what earlier
   versions stored. */
const SIZES = ['sm', 'md', 'lg'];
const SIZE_LABEL = { sm: 'Small', md: 'Medium', lg: 'Large' };
const sizeOf = (b) => ({ wide: 'md', tall: 'sm' }[b.size] || (SIZES.includes(b.size) ? b.size : 'sm'));

/* height ÷ width for a block before its image has loaded */
const RATIOS = {
  letterboxd: 3 / 2,          // film posters
  heading: 0.42, quote: 0.75, note: 1, link: 0.62,
  checklist: 1.35, palette: 0.8, stats: 1
};
function guessRatio(b) {
  if (b.kind === 'media') return RATIOS[b.source] || 1;   // album art is square
  if (b.kind === 'photo') return 1;
  return RATIOS[b.kind] || 1;
}

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k === 'value') n.value = v;           // property: textareas ignore the attribute
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? 'true' : v);
  }
  for (const k of kids.flat()) if (k != null) n.append(k.nodeType ? k : document.createTextNode(k));
  return n;
}

function toast(msg, bad) {
  const t = el('div', { class: 'toast' + (bad ? ' bad' : '') }, msg);
  $('#toasts').append(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; }, 2600);
  setTimeout(() => t.remove(), 3000);
}

const fmtTime = (s) => (isFinite(s) ? Math.floor(s / 60) + ':' + pad(Math.floor(s % 60)) : '0:00');
const stars = (r) => r == null ? '' : '★'.repeat(Math.floor(r)) + (r % 1 >= .5 ? '½' : '');

/* ---------------- state ---------------- */

const today = new Date();
let state = null;
let selectedId = null;
const urlCache = new Map();

const blankMonth = () => ({ title: '', note: '', accent: ACCENTS[0], song: null, blocks: [] });

function defaultState() {
  return {
    v: 1,
    months: {},
    sync: { services: {}, range: { from: '', to: '' } }
  };
}

/* ---------------- per-tab view state ----------------
   Which month you are looking at, the view, the sort, the theme and autoplay are
   about this window, not about the journal. They used to live inside the synced
   document, which meant two open tabs fought: one tab pushed, the other hit a
   version conflict, adopted the whole document and got yanked to the first tab's
   month.

   So they live here instead. sessionStorage is per-tab by definition, so tabs
   cannot tread on each other; localStorage keeps a copy purely so a brand new
   tab opens where you last were. Neither is ever sent to the server. */
const UI_KEY = 'journal:view';
const VIEW_FIELDS = ['cursor', 'view', 'sort', 'theme', 'autoplay', 'all', 'hiddenTags'];

const ui = {
  cursor: `${today.getFullYear()}-${pad(today.getMonth() + 1)}`,
  view: 'grid',
  sort: 'manual',
  theme: 'dark',
  autoplay: false,
  all: false,         // every month at once, rather than the one on the cursor
  hiddenTags: []      // tags switched off in the filter; empty means everything shows
};

function loadUI(doc) {
  let saved = null;
  try { saved = JSON.parse(sessionStorage.getItem(UI_KEY) || 'null'); } catch {}
  if (!saved) { try { saved = JSON.parse(localStorage.getItem(UI_KEY) || 'null'); } catch {} }

  // first run after the split: seed from whatever the old document carried
  if (!saved && doc) saved = Object.fromEntries(VIEW_FIELDS.map((k) => [k, doc[k]]));

  for (const k of VIEW_FIELDS) if (saved && saved[k] !== undefined && saved[k] !== null) ui[k] = saved[k];
  if (!ui.cursor) ui.cursor = `${today.getFullYear()}-${pad(today.getMonth() + 1)}`;
}

function saveUI() {
  const body = JSON.stringify(Object.fromEntries(VIEW_FIELDS.map((k) => [k, ui[k]])));
  try { sessionStorage.setItem(UI_KEY, body); } catch {}
  try { localStorage.setItem(UI_KEY, body); } catch {}   // only a default for new tabs
}

function month(key = ui.cursor) {
  if (!state.months[key]) state.months[key] = blankMonth();
  return state.months[key];
}

const cursorParts = () => {
  const [y, m] = ui.cursor.split('-').map(Number);
  return { year: y, month: m };
};

let saveTimer = null;
function save() {
  saveUI();                 // this tab's month/view/sort, never sent anywhere
  state.updatedAt = Date.now();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    stampChangedMonths(state);
    stampChangedColours(state);
    const merged = await mergeWithStored(state);
    const ok = await DB.saveState(merged);
    if (!ok) toast('Could not save — storage is unavailable', true);
    try { tabBus?.postMessage(merged); } catch {}
    Account.schedulePush(() => state, onSyncConflict);   // no-op when signed out
  }, 250);
}

/* The server refused a push because another device gave it something newer. */
function onSyncConflict(res) {
  mergeDocs(state, res.doc);
  resetPrints(state);
  DB.saveState(state);
  render();
  save();                       // push the union back so the server holds both sides
  toast('Merged in changes from another device');
}

function adoptDoc(doc, opts = {}) {
  for (const url of urlCache.values()) URL.revokeObjectURL(url);
  urlCache.clear();
  currentSongKey = null;
  state = doc;
  ensureShape();
  resetPrints(state);
  if (opts.persist !== false) DB.saveState(state);
  render();          // note: never touches ui, so this tab keeps its own month
}

/* ---------------- merging two copies of the journal ----------------
   Every tab holds the whole journal, so "who wrote last" is the wrong question
   to ask about the whole document — the right question is per month. Each month
   carries its own stamp, and copies are reconciled a month at a time.

   Within one month, blocks are unioned by id. That way a photo added in another
   tab shows up here instead of being overwritten. The cost is that deleting a
   block in one tab can be undone by a stale tab that still has it; losing a
   photo you added is worse than seeing one you deleted come back. */
const printOf = (m) => JSON.stringify(m?.blocks || []) + '|' + JSON.stringify(m?.song || null) +
  // the month's own shadow counts as content: change it and this month is newer
  '|' + JSON.stringify([m?.shadow ?? null, m?.shadowColour ?? null, m?.shadowY ?? null, m?.shadowBlur ?? null]);
let monthPrints = new Map();

/* Colours are not months, and they used to travel on the document's own stamp —
   which any edit at all bumps. So a background picked on your phone lost to a
   photo you happened to drag on the desktop a minute later, and the choice was
   pushed back over the top, gone. Each year's palette and each group of palette
   settings now carries the moment it was last changed, and merging compares
   those instead. Two devices colouring different years both keep their work. */
const colourGroups = (doc) => [
  ...Object.entries(doc.yearColours || {})
    .filter(([, pal]) => pal && (pal.bg || pal.ink || pal.at))
    .map(([y, pal]) => ({
      key: `year:${y}`, value: pal, chosen: !!(pal.bg || pal.ink),
      mark: (at) => { pal.at = at; }
    })),
  {
    key: 'shadow', value: { all: doc.shadowAll ?? null, global: doc.shadowGlobal ?? null },
    chosen: !!(doc.shadowAll || doc.shadowGlobal),
    mark: (at) => { doc.shadowAt = at; }
  },
  {
    key: 'palette', value: { custom: doc.customColours ?? null, hidden: doc.hiddenPresets ?? null },
    chosen: !!((doc.customColours || []).length || (doc.hiddenPresets || []).length),
    mark: (at) => { doc.paletteAt = at; }
  }
];

// the stamp itself must not count as a change, or every save would make one
const printSetting = (v) => JSON.stringify(v, (k, val) => (k === 'at' ? undefined : val));
let settingPrints = new Map();

function resetPrints(doc) {
  monthPrints = new Map(Object.entries(doc?.months || {}).map(([k, m]) => [k, printOf(m)]));
  settingPrints = new Map(colourGroups(doc || {}).map((g) => [g.key, printSetting(g.value)]));
}

/* Stamp only the months whose contents actually changed in this tab. */
function stampChangedMonths(doc) {
  for (const [key, m] of Object.entries(doc.months || {})) {
    const print = printOf(m);
    if (monthPrints.get(key) === print) continue;
    if (monthPrints.has(key) || m.blocks.length || m.song) m.updatedAt = Date.now();
    monthPrints.set(key, print);
  }
}

/* The same, for the colour settings. */
function stampChangedColours(doc) {
  for (const g of colourGroups(doc)) {
    const print = printSetting(g.value);
    if (settingPrints.get(g.key) === print) continue;
    if (settingPrints.has(g.key) || g.chosen) g.mark(Date.now());
    settingPrints.set(g.key, print);
  }
}

/* Deleting has to leave a mark. Merging unions the blocks from both sides, so a
   block you removed here is, from the other side's point of view, simply one it
   has and you are missing — and it gets handed straight back. A tombstone says
   "this was deleted on purpose" so the union knows to leave it out.

   Kept per month and per block id. Ids are random per upload, so a later block
   can never collide with a tombstone from an earlier one. */
const TOMBSTONE_LIFE = 120 * 864e5;        // long enough for any device to catch up

function tombstone(m, id) {
  if (!m || !id) return;
  m.removed = m.removed || {};
  m.removed[id] = Date.now();
}

function mergedTombstones(a, b) {
  const out = { ...(a || {}) };
  for (const [id, at] of Object.entries(b || {})) {
    if ((out[id] || 0) < at) out[id] = at;
  }
  const cutoff = Date.now() - TOMBSTONE_LIFE;
  for (const [id, at] of Object.entries(out)) if (at < cutoff) delete out[id];
  return out;
}

function mergeMonths(mine, theirs) {
  if (!mine) return theirs;
  if (!theirs) return mine;

  const mineAt = mine.updatedAt || 0;
  const theirsAt = theirs.updatedAt || 0;

  // a deliberate erase beats anything older than the erase itself
  if ((mine.erasedAt || 0) > theirsAt) return mine;
  if ((theirs.erasedAt || 0) > mineAt) return theirs;

  const newer = theirsAt > mineAt ? theirs : mine;
  const older = newer === mine ? theirs : mine;

  const removed = mergedTombstones(mine.removed, theirs.removed);
  const gone = (b) => Object.prototype.hasOwnProperty.call(removed, b.id);

  const kept = (newer.blocks || []).filter((b) => !gone(b));
  const known = new Set(kept.map((b) => b.id));
  const missing = (older.blocks || []).filter((b) => !known.has(b.id) && !gone(b));

  return { ...newer, blocks: [...kept, ...missing], removed };
}

function mergeDocs(mine, theirs) {
  if (!theirs || !theirs.months) return mine;
  mine.months = mine.months || {};
  for (const key of new Set([...Object.keys(mine.months), ...Object.keys(theirs.months)])) {
    mine.months[key] = mergeMonths(mine.months[key], theirs.months[key]);
  }

  /* Settings that live on the journal rather than on a month are not covered by
     the per-month merge. Each carries its own stamp (see colourGroups), so what
     gets compared is when that particular choice was made — not which device
     happened to save last. A document with no stamps is an older one; its own
     updatedAt stands in. */
  const mineAt = mine.updatedAt || 0;
  const theirsAt = theirs.updatedAt || 0;

  // a year at a time: you can set 2026 here while another device sets 2025
  if (theirs.yearColours) {
    const years = { ...(mine.yearColours || {}) };
    for (const [y, their] of Object.entries(theirs.yearColours)) {
      const ours = years[y];
      if (!ours || (their.at || theirsAt) > (ours.at || mineAt)) years[y] = their;
    }
    mine.yearColours = years;
  }

  const group = (keys, stamp) => {
    const theirTime = theirs[stamp] || theirsAt;
    if (theirTime > (mine[stamp] || mineAt)) {
      // their choice is the later one: take it whole, stamp included
      for (const k of keys) if (theirs[k] !== undefined) mine[k] = theirs[k];
      mine[stamp] = theirTime;
      return;
    }
    // otherwise only fill in what this side never had an opinion about
    for (const k of keys) if (mine[k] === undefined && theirs[k] !== undefined) mine[k] = theirs[k];
  };
  group(['shadowAll', 'shadowGlobal'], 'shadowAt');
  group(['customColours', 'hiddenPresets'], 'paletteAt');

  return mine;
}

async function mergeWithStored(mine) {
  let stored = null;
  try { stored = await DB.loadState(); } catch { return mine; }
  return mergeDocs(mine, stored);
}

/* ---------------- other tabs ----------------
   Every tab holds the whole journal in memory and writes it whole, so without
   this the last tab to save silently erased the other tab's work. Each save is
   announced; a tab that hears a newer document adopts it and re-renders, while
   keeping its own month, view and sort. */
const tabBus = 'BroadcastChannel' in window ? new BroadcastChannel('journal:doc') : null;

tabBus?.addEventListener('message', (e) => {
  const doc = e.data;
  if (!doc || typeof doc !== 'object' || !doc.months) return;
  /* Comparing one stamp for the whole document was wrong: a tab that had merely
     changed months looked "newer" and threw away another tab's new photo. Merge
     month by month instead, so an addition anywhere always survives. */
  mergeDocs(state, doc);
  resetPrints(state);
  render();                     // never touches ui: this tab keeps its own month
});

function ensureShape() {
  state.months = state.months || {};
  state.sync = state.sync || {};
  state.sync.services = state.sync.services || {};
  state.sync.range = state.sync.range || { from: '', to: '' };
  if (state.sync.autoRefresh === undefined) state.sync.autoRefresh = true;

  /* Colours used to live on each month. Lift any that exist up to their year so
     a journal made before this change keeps its look. Later months win, being
     the more recent choice. */
  for (const key of Object.keys(state.months).sort()) {
    const m = state.months[key];
    if (!m || (!m.bg && !m.ink)) continue;
    state.yearColours = state.yearColours || {};
    state.yearColours[key.slice(0, 4)] = { bg: m.bg || null, ink: m.ink || null };
    delete m.bg;
    delete m.ink;
  }
  /* Everything imported before tags existed can say what it is from its source
     alone, so it is filled in here rather than left to you. Only blocks that
     have never carried a tag are touched — clearing one on purpose sticks. */
  for (const m of Object.values(state.months)) {
    for (const b of m.blocks || []) {
      if (b.kind !== 'media') continue;
      // one tag used to be all you could have: carry it into the list
      if (b.tag !== undefined && !Array.isArray(b.tags)) {
        b.tags = b.tag ? [b.tag] : [];
        delete b.tag;
      }
      if (Array.isArray(b.tags)) continue;      // already decided, empty or not
      const t = defaultTag(b);
      if (t) b.tags = [t];
    }
  }

  // view fields are per-tab now; drop any left over from an older save so they
  // stop travelling to the server and back
  for (const k of VIEW_FIELDS) delete state[k];
}

/* ---------------- media urls ---------------- */

async function srcFor(b) {
  if (b.src) return b.src;
  if (!b.blobId) return null;
  if (urlCache.has(b.blobId)) return urlCache.get(b.blobId);

  let blob = await DB.getBlob(b.blobId);
  if (!blob && Account.user) {
    // a file uploaded from another device: fetch once, then keep it locally
    blob = await Account.remoteBlob(b.blobId);
    if (blob) await DB.putBlob(b.blobId, blob);
  }
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  urlCache.set(b.blobId, url);
  return url;
}

function paintMedia(node, b) {
  srcFor(b).then((url) => {
    if (!url) { node.replaceWith(placeholder(b)); return; }
    node.src = url;
  });
}

const hueOf = (s) => [...(s || 'x')].reduce((a, c) => a + c.charCodeAt(0) * 7, 0) % 360;

/* Some sources give no artwork — a Letterboxd CSV export carries titles and
   dates but no posters — so those get a typeset card instead of a broken tile. */
function posterCard(b) {
  return el('div', { class: 'poster', style: `--h:${hueOf(b.title)}` },
    el('div', { class: 'poster-t' }, b.title || 'untitled'),
    b.subtitle ? el('div', { class: 'poster-s' }, b.subtitle) : null,
    b.rating != null ? el('div', { class: 'poster-r' }, stars(b.rating)) : null);
}

/* A block whose file cannot be found. Saying which of the two possible reasons
   it is saves guessing: the file is on another device and was never uploaded,
   or you are signed out and it lives in a different browser. */
function placeholder(b) {
  const reason = !Account.user
    ? 'sign in to load it'
    : 'not uploaded from the device that has it';
  return el('div', { class: 'w', style: 'align-items:center;justify-content:center;text-align:center;gap:5px' },
    el('div', { style: 'font-size:22px;opacity:.5' }, b.kind === 'media' ? '◎' : '▢'),
    el('div', { style: 'font-size:11.5px;color:var(--ink-2)' }, b.title || 'missing file'),
    b.blobId ? el('div', { style: 'font-size:10.5px;color:var(--ink-3);line-height:1.35' }, reason) : null);
}

/* ---------------- blocks ---------------- */

function addBlocks(list, opts = {}) {
  const m = month();
  const at = opts.at === undefined ? m.blocks.length : opts.at;
  m.blocks.splice(at, 0, ...list);
  save();
  render();
}

function removeBlock(id) {
  const [, m] = monthEntry(id);
  const i = m.blocks.findIndex((b) => b.id === id);
  if (i < 0) return;
  const [b] = m.blocks.splice(i, 1);
  tombstone(m, id);                       // or the next merge hands it back
  if (b.blobId) {
    DB.delBlob(b.blobId);
    const u = urlCache.get(b.blobId);
    if (u) { URL.revokeObjectURL(u); urlCache.delete(b.blobId); }
  }
  if (selectedId === id) { selectedId = null; closeInspector(); }
  save();
  render();
}

/* Which month actually holds a block. In the everything view a tile on screen
   can belong to any month, and editing it has to reach that one rather than
   whichever month the cursor happens to be parked on. */
function monthEntry(id) {
  for (const [key, m] of Object.entries(state.months)) {
    if ((m.blocks || []).some((b) => b.id === id)) return [key, m];
  }
  return [ui.cursor, month()];
}

function findBlock(id) {
  return month().blocks.find((b) => b.id === id) ||
    (allMode() ? everyBlock().find((b) => b.id === id) : undefined);
}

/* Dating a block is also filing it. A photo uploaded in September but taken in
   June belongs in June, so setting a date outside the month on screen moves the
   block there rather than leaving it where it happened to be added. */
function setBlockDate(b, value) {
  const [homeKey, holder] = monthEntry(b.id);

  if (!value) {
    b.date = null;
    b.day = null;
    save();
    renderView();
    return;
  }

  const targetKey = value.slice(0, 7);
  b.date = value;
  b.day = Number(value.slice(8, 10));

  if (targetKey === homeKey) {            // same month: just a different day
    save();
    renderView();
    return;
  }

  const i = holder.blocks.indexOf(b);
  if (i > -1) holder.blocks.splice(i, 1);
  tombstone(holder, b.id);                // it is gone from here, not merely absent
  delete b.gx;                            // let it find a place in its new month
  delete b.gy;
  month(targetKey).blocks.push(b);

  selectedId = null;
  closeInspector();
  save();
  render();

  const [y, mm] = targetKey.split('-').map(Number);
  toast(`Moved to ${MONTHS[mm - 1]} ${y}`);
}

function cycleSize(b) {
  b.size = SIZES[(SIZES.indexOf(sizeOf(b)) + 1) % SIZES.length];
  delete b.uw;                 // back to the shape the content asks for
  delete b.uh;
  save();
  render();
}

/* ---------------- grid geometry ----------------
   Rows are 4px, so a block's height is set by how many it spans. Each block
   carries data-ratio (height ÷ width); images overwrite it with their real
   proportions once loaded, which is what keeps a 2:3 poster 2:3. */
const ROW_UNIT = 4;

/* Columns are narrow (86px), so a tile's width is a span count. A poster gets
   three of them and a square cover two, which lands a film at roughly the height
   of two stacked albums in the same column — they can never match exactly, since
   a 2:3 poster and two 1:1 squares are different shapes. */
/* 4 columns to a poster against 3 to a square is the ratio that makes a 2:3
   poster the height of two stacked 1:1 covers: 1.5 x 4 == 2 x 3. */
/* ---- masonry placement ----
   Tiles keep their true proportions — a 2:3 poster is drawn 2:3, nothing is
   cropped to fit a slot. CSS grid cannot do that without leaving holes, because
   a row is as tall as its tallest item. So each tile is positioned directly:
   walk the blocks in order and drop each one into the shortest column (or the
   shortest run of columns, for a wide tile). Columns stay flush by construction,
   and the only ragged edge is the bottom, which is what a moodboard should look
   like anyway. */
/* The board is an artboard, not a queue. Every tile owns a coordinate on a grid
   of small squares (gx, gy in units) and stays where you put it. An album cover
   is 2x2 units, so half an album is the smallest step, and every other tile is
   sized from its real proportions in those same units: a 2:3 poster is 2x3, a
   16:9 photo 2x1.
   Dropping a tile on top of others pushes them down out of the way, cascading,
   rather than reflowing the whole board. */
const WIDTH_UNITS = { sm: 4, md: 8, lg: 12 };   // an album cover is 4x4 units
const TARGET_UNIT = 46;      // preferred size of one little square
const MIN_UNITS = 2;         // nothing smaller than half a cover
const HEADROOM = 4;          // spare rows kept below the lowest tile

function ratioOf(node) {
  return Math.min(2.6, Math.max(0.3, +node.dataset.ratio || 1));
}

function gridMetrics(grid) {
  const gap = parseFloat(getComputedStyle(grid).columnGap) || 12;
  const width = grid.clientWidth;
  if (!width) return null;
  /* On a narrow screen the natural unit count lands on something like 7, which
     fits one 4-unit cover and leaves an awkward stub. Pin it to 8 so a phone
     shows two covers per row and a poster is exactly half the width. */
  const units = width < 560
    ? 8
    : Math.max(2, Math.round((width + gap) / (TARGET_UNIT + gap)));
  const unit = (width - gap * (units - 1)) / units;
  return { gap, units, unit, pitch: unit + gap, px: (n) => n * unit + (n - 1) * gap };
}

/* A tile is sized from its own proportions unless you have dragged a corner, in
   which case the shape you chose wins. */
function unitsOf(node, m) {
  const custom = +node.dataset.uw || 0;
  const w = Math.min(m.units, Math.max(MIN_UNITS, custom || WIDTH_UNITS[node.dataset.size || 'sm'] || 4));
  const h = +node.dataset.uh
    ? Math.max(MIN_UNITS, +node.dataset.uh)
    : Math.max(1, Math.round((m.px(w) * ratioOf(node) + m.gap) / m.pitch));
  return { w, h };
}

const hits = (a, b) =>
  a.gx < b.gx + b.w && b.gx < a.gx + a.w && a.gy < b.gy + b.h && b.gy < a.gy + a.h;

/* Shove whatever the moved tile landed on straight down, and whatever that
   lands on, and so on. */
function pushOthers(items, moved) {
  const queue = [moved];
  let guard = 0;
  while (queue.length && guard++ < 800) {
    const cur = queue.shift();
    for (const other of items) {
      if (other === cur || other === moved) continue;
      if (hits(cur, other)) {
        other.gy = cur.gy + cur.h;
        if (other.b) other.b.gy = other.gy;
        queue.push(other);
      }
    }
  }
}

/* First gap big enough, scanning left to right, top to bottom. */
function firstFree(placed, w, h, units) {
  for (let gy = 0; gy < 400; gy++) {
    for (let gx = 0; gx + w <= units; gx++) {
      const probe = { gx, gy, w, h };
      if (!placed.some((p) => hits(probe, p))) return { gx, gy };
    }
  }
  return { gx: 0, gy: 0 };
}

/* Used by the sort modes, which are a view rather than a placement: pack tight
   and ignore the stored coordinates. */
function autoFlow(items, units) {
  const bottoms = new Array(units).fill(0);
  for (const it of items) {
    let at = 0, top = Infinity;
    for (let i = 0; i + it.w <= units; i++) {
      const candidate = Math.max(...bottoms.slice(i, i + it.w));
      if (candidate < top - 0.001) { top = candidate; at = i; }
    }
    it.gx = at;
    it.gy = top;
    for (let i = at; i < at + it.w; i++) bottoms[i] = top + it.h;
  }
}

/* Nudge apart anything that ends up overlapping — a tile grown to Large, or a
   board narrowed by a resize.

   This is deliberately DISPLAY ONLY: it moves the item used for this render and
   never writes back to the block. The coordinate you dragged a tile to is its
   anchor, and only another drag changes it. So sizing an album up shoves its
   neighbours aside while it is big, and sizing it back down puts every one of
   them back exactly where it was. */
let lastTouched = null;      // the tile you just placed or resized

function settle(items) {
  /* Reading order decides who yields, except that the tile you just moved or
     scaled always wins — you put it there, so everything else works around it. */
  const order = [...items].sort((a, b) => {
    const at = a.b?.id === lastTouched ? 0 : 1;
    const bt = b.b?.id === lastTouched ? 0 : 1;
    return at - bt || a.gy - b.gy || a.gx - b.gx;
  });
  for (let i = 0; i < order.length; i++) {
    for (let j = 0; j < i; j++) {
      if (hits(order[i], order[j])) {
        order[i].gy = order[j].gy + order[j].h;
        j = -1;                                   // recheck against everything
      }
    }
  }
}

function layoutGrid() {
  const grid = $('#gridView');
  if (!grid || grid.hidden) return;

  const nodes = [...grid.children].filter((n) => n.classList.contains('block'));
  if (!nodes.length) { grid.style.height = ''; return; }

  const m = gridMetrics(grid);
  if (!m) return;

  const byId = new Map(shownBlocks().map((b) => [b.id, b]));
  const items = nodes.map((node) => {
    const b = byId.get(node.dataset.id);
    const { w, h } = unitsOf(node, m);
    return { node, b, w, h, gx: b?.gx, gy: b?.gy };
  });

  if (effectiveSort() !== 'manual') {
    autoFlow(items, m.units);
  } else {
    const placed = [];
    for (const it of items) {
      if (Number.isInteger(it.gx) && Number.isInteger(it.gy)) {
        it.gx = Math.max(0, Math.min(it.gx, m.units - it.w));
        placed.push(it);
      }
    }
    for (const it of items) {
      if (placed.includes(it)) continue;
      const spot = firstFree(placed, it.w, it.h, m.units);   // a newly imported tile
      it.gx = spot.gx;
      it.gy = spot.gy;
      if (it.b) { it.b.gx = it.gx; it.b.gy = it.gy; }
      placed.push(it);
    }
    settle(items);
  }

  let lowest = 0;
  for (const it of items) {
    it.node.style.width = m.px(it.w) + 'px';
    it.node.style.height = m.px(it.h) + 'px';
    it.node.style.left = it.gx * m.pitch + 'px';
    it.node.style.top = it.gy * m.pitch + 'px';
    lowest = Math.max(lowest, it.gy + it.h);
  }

  // room below to drop things into: the board keeps going
  grid.style.height = (lowest + HEADROOM) * m.pitch - m.gap + 'px';
  grid.style.setProperty('--colw', m.unit + 'px');
  grid.style.setProperty('--pitch', m.pitch + 'px');
  grid.style.setProperty('--gapw', m.gap + 'px');
}

/* On a touch screen a drag across a tile means "scroll", so placing and
   resizing stay on the mouse. */
const coarsePointer = () => window.matchMedia('(pointer: coarse)').matches;

/* ---- resizing a tile by its corners ----
   Snaps to the same units the board is drawn on. Dragging a north or west
   corner moves the tile's origin as well as its size, which is what makes the
   opposite corner stay put. */
function startResizing(e, node, b, corner) {
  if (e.button !== 0 || coarsePointer()) return;
  e.preventDefault();
  e.stopPropagation();                       // not a placement drag
  if (allMode()) {
    toast('Sizes belong to a tile inside its month — open a month to resize');
    return;
  }
  if ((ui.sort || 'manual') !== 'manual') {
    toast('Switch the order dropdown to "Custom order" to resize tiles');
    return;
  }
  const grid = $('#gridView');
  const m = gridMetrics(grid);
  if (!m) return;

  const { w: w0, h: h0 } = unitsOf(node, m);

  /* Work in deltas from where the pointer started, never in absolute cells.
     A tile's anchor and the cell it is drawn in can differ — something bigger
     may be temporarily pushing it down — and mixing the two spaces is what makes
     an edge drift when you drag the opposite corner. */
  const startX = e.clientX, startY = e.clientY;
  const dispX0 = Math.round(node.offsetLeft / m.pitch);
  const dispY0 = Math.round(node.offsetTop / m.pitch);

  /* Resize pins the tile where you can see it. A tile can be drawn below its
     anchor while something bigger is temporarily pushing it down, and committing
     the old anchor would make it jump the moment you let go. */
  const anchorX = dispX0, anchorY = dispY0;

  let w = w0, h = h0, dx = 0, dy = 0;
  node.classList.add('resizing');
  document.body.classList.add('placing');

  const move = (ev) => {
    const ux = Math.round((ev.clientX - startX) / m.pitch);
    const uy = Math.round((ev.clientY - startY) / m.pitch);

    dx = 0; dy = 0;
    if (corner.includes('e')) w = Math.max(MIN_UNITS, Math.min(m.units - dispX0, w0 + ux));
    if (corner.includes('s')) h = Math.max(MIN_UNITS, h0 + uy);
    if (corner.includes('w')) {
      dx = Math.min(w0 - MIN_UNITS, Math.max(-anchorX, ux));   // keep the east edge still
      w = w0 - dx;
    }
    if (corner.includes('n')) {
      dy = Math.min(h0 - MIN_UNITS, Math.max(-anchorY, uy));   // keep the south edge still
      h = h0 - dy;
    }

    node.style.left = (dispX0 + dx) * m.pitch + 'px';
    node.style.top = (dispY0 + dy) * m.pitch + 'px';
    node.style.width = m.px(w) + 'px';
    node.style.height = m.px(h) + 'px';
  };

  const done = () => {
    window.removeEventListener('pointermove', move);
    node.classList.remove('resizing');
    document.body.classList.remove('placing');

    lastTouched = b.id;
    b.uw = w;
    b.uh = h;
    b.gx = Math.max(0, anchorX + dx);      // dx/dy are zero unless a north or
    b.gy = Math.max(0, anchorY + dy);      // west grip moved the origin

    save();
    render();
  };

  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', done, { once: true });
}

/* ---- dragging a tile around the artboard ---- */
function startPlacing(e, node, b) {
  if (e.button !== 0 || coarsePointer()) return;
  if (e.target.closest('input,textarea,select,button,a')) return;
  if (allMode()) {
    toast('Tiles are arranged inside their own month — open a month to move them');
    return;
  }
  if ((ui.sort || 'manual') !== 'manual') {
    toast('Switch the order dropdown to "Custom order" to move tiles');
    return;
  }
  const grid = $('#gridView');
  const m = gridMetrics(grid);
  if (!m) return;

  e.preventDefault();
  const { w, h } = unitsOf(node, m);
  const start = node.getBoundingClientRect();
  const offX = e.clientX - start.left;
  const offY = e.clientY - start.top;

  node.classList.add('dragging');
  node.style.zIndex = '5';
  document.body.classList.add('placing');

  const ghost = el('div', { class: 'drop-ghost' });
  ghost.style.width = m.px(w) + 'px';
  ghost.style.height = m.px(h) + 'px';
  grid.append(ghost);

  let gx = b.gx || 0, gy = b.gy || 0;

  const move = (ev) => {
    const box = grid.getBoundingClientRect();
    const x = ev.clientX - box.left - offX;
    const y = ev.clientY - box.top - offY;
    node.style.left = x + 'px';
    node.style.top = y + 'px';

    gx = Math.max(0, Math.min(Math.round(x / m.pitch), m.units - w));
    gy = Math.max(0, Math.round(y / m.pitch));
    ghost.style.left = gx * m.pitch + 'px';
    ghost.style.top = gy * m.pitch + 'px';
  };

  const done = () => {
    window.removeEventListener('pointermove', move);
    ghost.remove();
    node.classList.remove('dragging');
    node.style.zIndex = '';
    document.body.classList.remove('placing');

    lastTouched = b.id;
    b.gx = gx;
    b.gy = gy;

    // everything it landed on gets pushed down — the moved tile must be the
    // same object in the list, or it counts as a collision with itself
    const mine = { b, gx, gy, w, h };
    const others = month().blocks.filter((x) => x !== b).map((x) => {
      const n = grid.querySelector(`.block[data-id="${x.id}"]`);
      const size = n ? unitsOf(n, m) : { w: 2, h: 2 };
      return { b: x, gx: x.gx || 0, gy: x.gy || 0, ...size };
    });
    pushOthers([mine, ...others], mine);

    save();
    render();
  };

  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', done, { once: true });
}

let repackTimer = null;
function adoptRatio(node, w, h) {
  if (!w || !h) return;
  node.dataset.ratio = (h / w).toFixed(4);
  // images land in bursts; repack once when they settle
  clearTimeout(repackTimer);
  repackTimer = setTimeout(layoutGrid, 60);
}

let layoutTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(layoutTimer);
  layoutTimer = setTimeout(layoutGrid, 120);
});

/* ---------------- shrinking oversized pictures ----------------
   A serverless host refuses a request body over 4.5 MB, and phone photos sail
   past that. Rather than lean on the direct-to-storage path for every holiday
   snap, an image that big is re-encoded until it fits: quality first, then
   dimensions. A moodboard tile is a few hundred pixels wide, so the loss is
   invisible where it matters and the file becomes something every host accepts.

   Only images. Audio cannot be re-encoded in a browser, so a big song still
   takes the direct route. */
const UPLOAD_LIMIT = 4.2 * 1024 * 1024;       // leave headroom under the 4.5 MB cap

/* WebP makes the smallest files, but a canvas asked for a format it cannot write
   quietly hands back a PNG instead — and a PNG of a phone photo is bigger than
   the original, so every attempt to shrink it fails and the file is declared
   impossible. Older Safari does exactly this. So ask once what the browser can
   really write, and fall back to JPEG, which every browser has always written. */
let encoderChoice = null;
async function encoderType() {
  if (encoderChoice) return encoderChoice;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 8;
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/webp', 0.8));
  encoderChoice = blob && blob.type === 'image/webp' ? 'image/webp' : 'image/jpeg';
  return encoderChoice;
}

const extensionFor = (type) => (type === 'image/webp' ? '.webp' : '.jpg');

/* Why a particular file could not be made smaller, kept next to the file itself
   so the sync can say something true about it instead of guessing. */
const shrinkFailures = new WeakMap();

/* Decode anything the browser can actually display. createImageBitmap handles
   the common formats but refuses others — notably HEIC from an iPhone, which
   Safari can still render through an <img>. Trying both is the difference
   between shrinking a photo and giving up on it. */
async function decodeImage(file) {
  try { return await createImageBitmap(file); } catch { /* try the slow path */ }

  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'sync';
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('cannot decode'));
      img.src = url;
      setTimeout(() => reject(new Error('decode timed out')), 15000);
    });
    if (!img.naturalWidth) throw new Error('cannot decode');
    return { width: img.naturalWidth, height: img.naturalHeight, source: img, close() {} };
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
}

/* A Live Photo arrives from an iPhone as a short video, and video cannot be
   re-encoded in a browser — which is why one of these would sit there refusing
   to upload no matter how hard the image path tried. Pulling a frame out of it
   turns it into an ordinary picture that fits anywhere.

   The frame is taken a fraction of a second in: the very first frame of a Live
   Photo is often still exposing and comes out dark. */
/* Wait for whichever of these events comes first, and carry on regardless when
   none of them does. Phone browsers skip events other browsers always fire, so
   waiting for one particular event is how this used to hang until it timed out
   and gave up on the file. */
function firstEvent(target, names, ms) {
  return new Promise((resolve) => {
    const stop = (why) => { names.forEach((n) => target.removeEventListener(n, hit)); clearTimeout(timer); resolve(why); };
    const hit = (e) => stop(e.type);
    names.forEach((n) => target.addEventListener(n, hit, { once: true }));
    const timer = setTimeout(() => stop(null), ms);
  });
}

/* A frame drawn before the video really has one is a flat black (or empty)
   rectangle. Saving that would look like success and leave you with a black
   tile, so it is checked and the grab retried further into the clip. */
function frameIsBlank(ctx, w, h) {
  const step = Math.max(1, Math.floor(Math.min(w, h) / 24));
  let lit = 0, seen = 0;
  try {
    const d = ctx.getImageData(0, 0, w, h).data;
    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        const i = (y * w + x) * 4;
        seen++;
        if (d[i + 3] > 8 && (d[i] > 12 || d[i + 1] > 12 || d[i + 2] > 12)) lit++;
      }
    }
  } catch { return false; }              // unreadable pixels: assume it is fine
  return seen > 0 && lit / seen < 0.02;
}

async function stillFromVideo(file) {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  /* Safari on a phone ignores `preload` and loads nothing at all until the clip
     actually plays — so the old hidden element sat there with a src on it and
     never produced a frame, which is exactly why a Live Photo would not shrink
     on the device it came from. Muted inline playback needs no tap, so the clip
     is started, a frame taken, and it is stopped again. It also has to be in the
     page: iOS will not decode a video that was never attached. */
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.setAttribute('muted', '');
  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', '');
  Object.assign(video.style, {
    position: 'fixed', left: '-9999px', top: '0', width: '2px', height: '2px', opacity: '0', pointerEvents: 'none'
  });
  document.body.appendChild(video);

  try {
    video.src = url;
    try { video.load(); } catch { /* some builds do not need it */ }
    let refused = false;
    video.addEventListener('error', () => { refused = true; });
    try { await video.play(); } catch { /* autoplay refused: metadata may still arrive */ }

    if (!video.videoWidth) await firstEvent(video, ['loadeddata', 'canplay', 'timeupdate', 'error'], 25000);
    if (!video.videoWidth) await firstEvent(video, ['loadeddata', 'canplay', 'timeupdate', 'error'], 8000);
    if (!video.videoWidth) {
      throw new Error(refused
        ? 'this browser cannot read that video format'
        : 'the video never produced a picture');
    }

    const scale = Math.min(1, 2560 / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const type = await encoderType();
    const span = video.duration && isFinite(video.duration) ? video.duration : 1;

    /* A Live Photo's first frame is often still exposing and comes out dark, so
       the grab starts a fraction of a second in and moves later if what it got
       was blank. */
    for (const at of [Math.min(0.25, span / 3), Math.min(0.6, span / 2), 0, Math.min(1.2, span * 0.8)]) {
      if (Math.abs(video.currentTime - at) > 0.01) {
        try { video.pause(); } catch { /* already paused */ }
        video.currentTime = at;
        await firstEvent(video, ['seeked', 'timeupdate'], 4000);
      }
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      if (frameIsBlank(ctx, canvas.width, canvas.height)) continue;

      for (const quality of [0.85, 0.7, 0.55, 0.4]) {
        const blob = await new Promise((res) => canvas.toBlob(res, type, quality));
        if (blob && blob.size <= UPLOAD_LIMIT) {
          const base = (file.name || 'video').replace(/\.[^.]+$/, '');
          return new File([blob], base + extensionFor(type), { type });
        }
      }
      throw new Error('the still frame is still too large');
    }
    throw new Error('every frame read out of it was blank');
  } finally {
    try { video.pause(); } catch { /* nothing playing */ }
    video.removeAttribute('src');
    try { video.load(); } catch { /* fine */ }
    video.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
}

async function shrinkImage(file) {
  if (file.size <= UPLOAD_LIMIT) return file;
  /* An oversized video becomes a still. A Live Photo is a photo as far as you
     are concerned, and a still that syncs everywhere beats a clip that syncs
     nowhere. The caller says plainly when this happens. */
  if (/^video\//.test(file.type)) {
    try { return await stillFromVideo(file); }
    catch (e) { shrinkFailures.set(file, e.message); return file; }
  }
  if (/gif|svg/.test(file.type)) return file;  // animation and vectors do not survive this

  let picture;
  try { picture = await decodeImage(file); }
  catch { return file; }                       // genuinely undecodable

  const drawable = picture.source || picture;
  const type = await encoderType();
  let scale = Math.min(1, 2560 / Math.max(picture.width, picture.height));

  /* Work down until it fits: fewer pixels each pass, three quality steps within
     each. The last pass is small enough that anything still over the limit was
     never going to make it. */
  for (let attempt = 0; attempt < 6; attempt++) {
    const w = Math.max(1, Math.round(picture.width * scale));
    const h = Math.max(1, Math.round(picture.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(drawable, 0, 0, w, h);

    for (const quality of [0.85, 0.7, 0.55, 0.4]) {
      const blob = await new Promise((res) => canvas.toBlob(res, type, quality));
      if (blob && blob.size <= UPLOAD_LIMIT) {
        picture.close?.();
        // a blob pulled back out of storage has no filename, only a type
        const base = (file.name || 'image').replace(/\.[^.]+$/, '');
        return new File([blob], base + extensionFor(type), { type });
      }
    }
    canvas.width = canvas.height = 0;           // a phone runs out of canvas memory fast
    scale *= 0.7;                              // still too big: fewer pixels
  }

  picture.close?.();
  return file;                                 // give up honestly rather than mangle it
}

async function addFiles(files, day = null) {
  const imgs = [...files].filter((f) => /^(image|video)\//.test(f.type));
  if (!imgs.length) { toast('No images or video in that drop', true); return; }
  const blocks = [];
  let shrunk = 0, savedBytes = 0, stubborn = 0;
  for (const original of imgs) {
    const f = await shrinkImage(original);
    if (f !== original) { shrunk++; savedBytes += original.size - f.size; }
    else if (f.size > UPLOAD_LIMIT) stubborn++;
    const id = uid();
    await DB.putBlob(id, f);
    blocks.push({
      id: uid(), kind: 'photo', blobId: id, mime: f.type,
      title: f.name.replace(/\.[^.]+$/, ''), subtitle: '', note: '',
      day, size: 'sm', rating: null
    });
  }
  addBlocks(blocks);
  toast(`Added ${blocks.length} ${blocks.length === 1 ? 'file' : 'files'}` +
    (shrunk ? ` · ${shrunk} resized to fit, saving ${(savedBytes / 1048576).toFixed(1)} MB` : '') +
    (stubborn ? ` · ${stubborn} stayed full size and will go straight to storage` : ''));
  if (Account.user) syncFiles();   // confirms they actually reached the account
}

/* ---------------- widgets ---------------- */

const WIDGETS = [
  { kind: 'note',      label: 'Sticky note',   make: () => ({ text: '', size: 'sm' }) },
  { kind: 'heading',   label: 'Big text',      make: () => ({ text: 'a good month', size: 'wide' }) },
  { kind: 'quote',     label: 'Quote',         make: () => ({ text: '', size: 'md' }) },
  { kind: 'checklist', label: 'Checklist',     make: () => ({ title: 'To do', items: [{ t: '', done: false }], size: 'tall' }) },
  { kind: 'palette',   label: 'Colour palette',make: () => ({ title: 'Palette', colors: ['#e0a45e','#c4736f','#88a97f','#7f97c4'], size: 'sm' }) },
  { kind: 'stats',     label: 'Month stats',   make: () => ({ size: 'sm' }) },
  { kind: 'link',      label: 'Link card',     make: () => ({ title: '', url: '', size: 'sm' }) }
];

function addWidget(kind) {
  const spec = WIDGETS.find((w) => w.kind === kind);
  addBlocks([{ id: uid(), kind, ...spec.make() }]);
}

function widgetBody(b) {
  const bind = (node, key) => {
    node.addEventListener('input', () => { b[key] = node.value; save(); });
    return node;
  };

  switch (b.kind) {
    case 'note':
      return el('div', { class: 'w note' },
        el('h4', {}, 'note'),
        bind(el('textarea', { placeholder: 'write something…' , value: b.text || '' }), 'text'));

    case 'heading':
      return el('div', { class: 'w heading' },
        bind(el('textarea', { placeholder: 'a title…', value: b.text || '' }), 'text'));

    case 'quote':
      return el('div', { class: 'w quote' },
        bind(el('textarea', { placeholder: '“…”', value: b.text || '' }), 'text'));

    case 'checklist': {
      const wrap = el('div', { class: 'w' });
      const head = bind(el('input', {
        value: b.title || '', style: 'background:none;border:0;outline:none;font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-3)'
      }), 'title');
      const list = el('div', { class: 'list' });
      const draw = () => {
        list.replaceChildren(...b.items.map((it, i) => {
          const row = el('label', { class: it.done ? 'done' : '' });
          const cb = el('input', { type: 'checkbox' });
          cb.checked = !!it.done;
          cb.addEventListener('change', () => { it.done = cb.checked; save(); draw(); });
          const tx = el('input', { type: 'text', value: it.t, placeholder: 'item' });
          tx.addEventListener('input', () => { it.t = tx.value; save(); });
          tx.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); b.items.splice(i + 1, 0, { t: '', done: false }); save(); draw(); list.querySelectorAll('input[type=text]')[i + 1]?.focus(); }
            if (e.key === 'Backspace' && !tx.value && b.items.length > 1) { e.preventDefault(); b.items.splice(i, 1); save(); draw(); }
          });
          row.append(cb, tx);
          return row;
        }));
      };
      draw();
      wrap.append(head, list, el('button', {
        class: 'add', onclick: () => { b.items.push({ t: '', done: false }); save(); draw(); }
      }, '+ add'));
      return wrap;
    }

    case 'palette': {
      const wrap = el('div', { class: 'w' });
      const grid = el('div', { class: 'pal' });
      const draw = () => {
        grid.replaceChildren(...b.colors.map((c, i) => {
          const inp = el('input', { type: 'color', value: c, title: c });
          inp.addEventListener('input', () => { b.colors[i] = inp.value; save(); });
          inp.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            if (b.colors.length > 1) { b.colors.splice(i, 1); save(); draw(); }
          });
          return inp;
        }));
      };
      draw();
      wrap.append(
        el('h4', {}, b.title || 'palette'),
        grid,
        el('button', { class: 'add', onclick: () => { b.colors.push('#cccccc'); save(); draw(); } }, '+ swatch  ·  right-click removes'));
      return wrap;
    }

    case 'stats': {
      const m = month();
      const photos = m.blocks.filter((x) => x.kind === 'photo').length;
      const media = m.blocks.filter((x) => x.kind === 'media');
      const days = new Set(m.blocks.filter((x) => x.day).map((x) => x.day)).size;
      const bySource = {};
      for (const x of media) bySource[x.source || 'media'] = (bySource[x.source || 'media'] || 0) + 1;
      return el('div', { class: 'w' },
        el('h4', {}, 'this month'),
        el('div', { class: 'stats' },
          el('div', { class: 'n' }, String(photos + media.length)),
          el('div', { class: 'r' }, el('span', {}, 'photos'), el('span', {}, String(photos))),
          ...Object.entries(bySource).map(([k, v]) =>
            el('div', { class: 'r' }, el('span', {}, k), el('span', {}, String(v)))),
          el('div', { class: 'r' }, el('span', {}, 'days logged'), el('span', {}, String(days)))));
    }

    case 'link': {
      const wrap = el('div', { class: 'w link' });
      const t = bind(el('input', { value: b.title || '', placeholder: 'label', style: 'background:none;border:0;outline:none;font-weight:600' }), 'title');
      const u = bind(el('input', { value: b.url || '', placeholder: 'https://', style: 'background:none;border:0;outline:none;font-size:12px;color:var(--ink-3)' }), 'url');
      const go = el('a', { href: b.url || '#', target: '_blank', rel: 'noreferrer' }, b.url ? 'open ↗' : '');
      u.addEventListener('input', () => { go.href = b.url; go.textContent = b.url ? 'open ↗' : ''; });
      wrap.append(el('h4', {}, 'link'), t, u, go);
      return wrap;
    }
  }
  return el('div', { class: 'w' }, b.kind);
}

/* ---------------- grid view ---------------- */

function blockEl(b) {
  const node = el('div', { class: 'block' + (b.id === selectedId ? ' is-sel' : '') });
  node.dataset.id = b.id;
  node.dataset.size = sizeOf(b);
  node.dataset.kind = b.kind;
  node.dataset.ratio = b.ratio || guessRatio(b);
  if (b.uw) node.dataset.uw = b.uw;
  if (b.uh) node.dataset.uh = b.uh;

  if (b.kind === 'photo' || b.kind === 'media') {
    const isVideo = b.kind === 'photo' && /^video\//.test(b.mime || '');
    if (b.kind === 'media' && !b.src) {
      // no artwork: the card itself carries the title, so mark it and let the
      // hover caption take over rather than printing everything twice
      node.classList.add('is-card');
      node.append(posterCard(b));
    } else {
      const mediaNode = isVideo
        ? el('video', { muted: true, loop: true, playsinline: true, onmouseenter: (e) => e.target.play(), onmouseleave: (e) => e.target.pause() })
        /* Deliberately NOT loading="lazy": a tile's height comes from the image's
           own proportions, so the browser would be deferring the load until it
           knew the size while the size waited on the load. Only the current month
           is ever in the DOM, so eager is cheap.
           no-referrer keeps Wikimedia and other CDNs from refusing the hotlink. */
        : el('img', { alt: b.title || '', decoding: 'async', referrerpolicy: 'no-referrer' });

      // a poster URL that 404s should read as a card, not an empty tile
      mediaNode.addEventListener('error', () => {
        if (mediaNode.isConnected) mediaNode.replaceWith(posterCard(b));
      });

      // the file itself decides the tile's shape; remember it so later renders
      // are correctly sized before the image comes back
      const remember = (w, h) => {
        adoptRatio(node, w, h);
        const r = +(h / w).toFixed(4);
        if (w && h && b.ratio !== r) { b.ratio = r; save(); }
      };
      mediaNode.addEventListener('load', () => remember(mediaNode.naturalWidth, mediaNode.naturalHeight));
      mediaNode.addEventListener('loadedmetadata', () => remember(mediaNode.videoWidth, mediaNode.videoHeight));

      node.append(mediaNode);
      paintMedia(mediaNode, b);
    }
    // tags are the more useful label of the two, so they take the corner
    const label = tagsOf(b).join(' · ') || b.source;
    if (label) node.append(el('div', { class: 'badge' }, label));
    if (b.day) node.append(el('div', { class: 'daytag' }, String(b.day)));
    if (b.rating != null) node.append(el('div', { class: 'rating' }, stars(b.rating)));
    if (b.title) node.append(el('div', { class: 'cap' },
      el('b', {}, b.title),
      b.subtitle ? el('span', {}, b.subtitle) : null,
      // your review, if there is one — otherwise the tile is just the artwork
      b.note ? el('em', {}, b.note.replace(/\s+/g, ' ')) : null));
    node.addEventListener('dblclick', () => openInspector(b.id));
  } else {
    node.append(widgetBody(b));
    // dragging from inside a textarea shouldn't hijack the field
    // typing inside a widget must not start a drag
    node.querySelectorAll('input,textarea,a').forEach((f) => {
      f.addEventListener('pointerdown', (e) => e.stopPropagation());
    });
  }

  node.append(el('div', { class: 'tools' },
    el('button', { title: 'Resize', onclick: (e) => { e.stopPropagation(); cycleSize(b); } }, '⤢'),
    el('button', { title: 'Details', onclick: (e) => { e.stopPropagation(); openInspector(b.id); } }, 'i'),
    el('button', { title: 'Remove', onclick: (e) => { e.stopPropagation(); removeBlock(b.id); } }, '✕')));

  node.addEventListener('click', () => {
    selectedId = b.id;
    $$('.block').forEach((n) => n.classList.toggle('is-sel', n.dataset.id === b.id));
  });

  /* placement: pick the tile up and put it where you want it */
  node.addEventListener('pointerdown', (e) => startPlacing(e, node, b));

  // grab any corner to set the size by hand
  for (const corner of ['nw', 'ne', 'sw', 'se']) {
    node.append(el('div', {
      class: 'hnd hnd-' + corner,
      title: 'Drag to resize',
      onpointerdown: (e) => startResizing(e, node, b, corner)
    }));
  }

  return node;
}

const SORTS = {
  date:     (b) => b.date || '9999-99',
  '-date':  (b) => b.date || '0000-00',
  '-rating':(b) => (b.rating == null ? -1 : b.rating),
  title:    (b) => (b.title || '').toLowerCase(),
  /* Group by what a thing is. Tags are the answer to that — films together,
     records together — and where a tile has several they order within their
     first one, so "Movie" sits next to "Movie · Rewatch". Anything untagged
     falls back to where it came from and sinks below the tagged ones, so an
     unsorted tail never splits a group in half. */
  source:   (b) => {
    const tags = tagsOf(b);
    if (tags.length) return tags.join(' · ').toLowerCase();
    return '\uffff' + (b.source || b.kind || '');   // sorts after every real tag
  }
};

/* Custom order is the stored order of the array — drag decides it. Any other
   mode is a view over the same blocks, so switching back loses nothing. */
/* ---------------- everything at once ----------------
   One container holding every month, newest first. Placing tiles by hand is a
   per-month arrangement — a tile's position means nothing outside the month it
   belongs to — so this view is always sorted, and "custom order" falls back to
   newest first while it is on. */
const allMode = () => !!ui.all;

const effectiveSort = () => {
  const mode = ui.sort || 'manual';
  return allMode() && mode === 'manual' ? '-date' : mode;
};

function everyBlock() {
  const out = [];
  for (const key of Object.keys(state.months).sort()) {
    for (const b of state.months[key].blocks || []) out.push(b);
  }
  return out;
}

/* ---------------- filtering by tag ----------------
   Every tag starts switched on; the filter only ever remembers what you have
   switched off, so a tag invented tomorrow is visible without you going back to
   tick it. A tile with several tags needs all of them on: unticking a tag makes
   those things go away, which is what unticking is for. */
const hiddenTagSet = () => new Set((ui.hiddenTags || []).map((t) => String(t).toLowerCase()));
const UNTAGGED = '\u0000untagged';        // the row for things with no tag at all

function tagVisible(b, hidden = hiddenTagSet()) {
  if (!hidden.size) return true;
  const tags = tagsOf(b);
  if (!tags.length) return !hidden.has(UNTAGGED);
  return tags.every((t) => !hidden.has(t.toLowerCase()));
}

const filterOn = () => !!(ui.hiddenTags || []).length;

// which blocks the grid is showing: this month's, or the lot
const shownBlocks = () => {
  const hidden = hiddenTagSet();
  const blocks = allMode() ? everyBlock() : month().blocks;
  return hidden.size ? blocks.filter((b) => tagVisible(b, hidden)) : blocks;
};

/* How far back the journal goes, and how far forward. Counting only the things
   that carry a date got this wrong: a photo dropped into a month never has one
   unless you set it, so a year made entirely of uploads was invisible and the
   journal looked younger than it is. A month that holds anything counts for its
   own year, and a block dated outside its month counts for that year too. */
function journalSpan() {
  const years = [];
  for (const [key, m] of Object.entries(state.months)) {
    const blocks = m.blocks || [];
    if (!blocks.length && !m.song) continue;
    years.push(key.slice(0, 4));
    for (const b of blocks) if (b.date) years.push(String(b.date).slice(0, 4));
  }
  years.sort();
  return { first: years[0], last: years[years.length - 1] };
}

function orderedBlocks(m) {
  const mode = effectiveSort();
  const key = SORTS[mode];
  if (!key) return m.blocks;
  const dir = mode.startsWith('-') ? -1 : 1;
  return [...m.blocks].sort((a, b) => {
    const x = key(a), y = key(b);
    return x < y ? -dir : x > y ? dir : 0;
  });
}

function renderGrid() {
  const grid = $('#gridView');
  const blocks = shownBlocks();
  if (!blocks.length) {
    // an empty board because of the filter is not an empty journal, and saying
    // "nothing here yet" when there is plenty would just be wrong
    const held = (allMode() ? everyBlock() : month().blocks).length;
    if (filterOn() && held) {
      grid.replaceChildren(el('div', { class: 'empty' },
        el('b', {}, 'Everything here is filtered out'),
        el('button', {
          class: 'btn ghost',
          onclick: () => { ui.hiddenTags = []; save(); render(); }
        }, 'Show all tags')));
      return;
    }
    grid.replaceChildren(el('div', { class: 'empty' },
      el('b', {}, allMode() ? 'Nothing in the journal yet' : 'Nothing here yet'),
      'Drop photos anywhere, add a widget, or pull a month from Letterboxd, AniList or Last.fm with Sync.'));
    return;
  }
  grid.replaceChildren(el('div', { class: 'grid-guides' }), ...orderedBlocks({ blocks }).map(blockEl));
  layoutGrid();
}

/* ---------------- calendar view ---------------- */

function thumbEl(b, opts = {}) {
  const t = el('div', { class: 'thumb', draggable: true, title: b.title || '' });
  t.dataset.id = b.id;
  const img = el('img', { alt: '' });
  srcFor(b).then((url) => {
    if (url) { t.replaceChildren(img); img.src = url; }
    else t.replaceChildren(el('div', {
      class: 'ph', style: `background:hsl(${hueOf(b.title)} 32% 26%);color:#fff;font-family:var(--serif)`
    }, (b.title || '?').trim()[0].toUpperCase()));
  });
  t.append(img);
  t.addEventListener('click', () => openInspector(b.id));
  t.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/journal-block', b.id);
    e.dataTransfer.effectAllowed = 'move';
  });
  if (opts.dbl) t.addEventListener('dblclick', opts.dbl);
  return t;
}

function renderCalendar() {
  const { year, month: mo } = cursorParts();
  const m = month();
  // the tag filter applies here too, so both views agree on what is showing
  const visible = shownBlocks();
  const first = new Date(year, mo - 1, 1).getDay();
  const days = new Date(year, mo, 0).getDate();

  $('#calHead').replaceChildren(...DOW.map((d) => el('div', {}, d)));

  const cells = [];
  for (let i = 0; i < first; i++) cells.push(el('div', { class: 'day pad' }));

  for (let d = 1; d <= days; d++) {
    const isToday = today.getFullYear() === year && today.getMonth() + 1 === mo && today.getDate() === d;
    const cell = el('div', { class: 'day' + (isToday ? ' today' : '') });
    cell.dataset.day = d;
    cell.append(el('div', { class: 'n' }, pad(d)));

    const mine = visible.filter((b) => b.day === d && (b.kind === 'photo' || b.kind === 'media'));
    const thumbs = el('div', { class: 'thumbs' });
    mine.slice(0, 6).forEach((b) => thumbs.append(thumbEl(b)));
    cell.append(thumbs);
    if (mine.length > 6) cell.append(el('div', { class: 'more' }, `+${mine.length - 6} more`));

    const notes = visible.filter((b) => b.day === d && b.kind === 'note' && b.text);
    notes.forEach((n) => cell.append(el('div', { class: 'more', style: 'color:var(--ink-2)' }, n.text.slice(0, 60))));

    cell.addEventListener('dragover', (e) => {
      if ([...e.dataTransfer.types].includes('text/journal-block') || [...e.dataTransfer.types].includes('Files')) {
        e.preventDefault();
        cell.classList.add('drag-over');
      }
    });
    cell.addEventListener('dragleave', () => cell.classList.remove('drag-over'));
    cell.addEventListener('drop', (e) => {
      cell.classList.remove('drag-over');
      const id = e.dataTransfer.getData('text/journal-block');
      if (id) {
        e.preventDefault(); e.stopPropagation();
        const b = findBlock(id);
        if (b) { b.day = d; save(); render(); }
        return;
      }
      if (e.dataTransfer.files?.length) {
        e.preventDefault(); e.stopPropagation();
        document.body.classList.remove('dropping');
        addFiles(e.dataTransfer.files, d);
      }
    });
    cell.addEventListener('dblclick', () => {
      $('#filePicker').dataset.day = d;
      $('#filePicker').click();
    });

    cells.push(cell);
  }
  $('#calBody').replaceChildren(...cells);

  const loose = visible.filter((b) => !b.day && (b.kind === 'photo' || b.kind === 'media'));
  $('#trayItems').replaceChildren(...(loose.length
    ? loose.map((b) => thumbEl(b))
    : [el('div', { class: 'hint' }, 'Everything is dated. Double-click a day to add photos straight to it.')]));
}

/* ---------------- tags ----------------
   What kind of thing a tile is — a film, a record, a book, a game. Anything
   imported already knows the answer, so it arrives tagged; anything you add
   yourself you name once, and from then on the details box offers it back. */
const TAG_SUGGESTIONS = ['Movie', 'TV', 'Anime', 'Manga', 'Music', 'Book', 'Game', 'Podcast'];

const SOURCE_TAGS = { letterboxd: 'Movie', musicboard: 'Music', lastfm: 'Music' };

function defaultTag(b) {
  if (SOURCE_TAGS[b.source]) return SOURCE_TAGS[b.source];
  /* AniList carries its own kind in the subtitle — TV, MOVIE, MANGA, OVA — so a
     list that mixes anime and manga does not end up all one word. */
  if (b.source === 'anilist') {
    const format = String(b.subtitle || '').toUpperCase();
    if (/MANGA|NOVEL|ONE_SHOT/.test(format)) return 'Manga';
    if (format === 'MOVIE') return 'Movie';
    return 'Anime';
  }
  return '';
}

/* A tile can be more than one thing — a film you also count as a rewatch, a
   record that was also a gig. Tags are a list; `tag`, a single string, is what
   older journals hold and is read here so nothing has to be re-entered. */
function tagsOf(b) {
  if (Array.isArray(b.tags)) return b.tags.filter(Boolean);
  const one = String(b.tag || '').trim();
  return one ? [one] : [];
}

/* Tidy a list before it is stored: no blanks, no repeats, and one spelling of
   each — whatever case you typed, it folds onto the one already in use. */
function cleanTags(list, known = knownTags()) {
  const out = [];
  const seen = new Set();
  for (const raw of list) {
    const typed = String(raw || '').trim();
    if (!typed) continue;
    const match = known.find((t) => t.toLowerCase() === typed.toLowerCase());
    const tag = match || typed;
    if (seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    out.push(tag);
  }
  return out;
}

function setTags(b, list) {
  b.tags = cleanTags(list);
  delete b.tag;                    // the single-tag field is gone once rewritten
}

/* Every tag already in the journal, most used first, then the standard ones you
   have not used yet. This is the list the details box completes from. */
function knownTags() {
  const count = new Map();
  for (const b of allBlocks()) {
    for (const t of tagsOf(b)) count.set(t, (count.get(t) || 0) + 1);
  }
  const mine = [...count.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([t]) => t);
  const have = new Set(mine.map((t) => t.toLowerCase()));
  return [...mine, ...TAG_SUGGESTIONS.filter((t) => !have.has(t.toLowerCase()))];
}

/* The filter itself: every tag in the journal with a switch, plus a row for the
   things that have none. Counts come from the whole journal rather than the
   month on screen, so the list does not rearrange itself as you move about. */
function openTagFilter() {
  const pop = $('#tagPop');
  const counts = new Map();
  let untagged = 0;

  for (const b of everyBlock()) {
    const tags = tagsOf(b);
    if (!tags.length) { untagged++; continue; }
    for (const t of tags) counts.set(t, (counts.get(t) || 0) + 1);
  }

  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const hidden = hiddenTagSet();
  const isOn = (key) => !hidden.has(key.toLowerCase());

  const setHidden = (key, on) => {
    const rest = (ui.hiddenTags || []).filter((t) => String(t).toLowerCase() !== key.toLowerCase());
    ui.hiddenTags = on ? rest : [...rest, key];
    save();
    render();
    openTagFilter();               // keep it open: filtering is a run of clicks
  };

  const row = (key, label, count) => {
    const box = el('input', { type: 'checkbox' });
    box.checked = isOn(key);
    box.addEventListener('change', () => setHidden(key, box.checked));
    return el('label', { class: 'tagrow' },
      el('span', { class: 'tagrow-name' }, box, label),
      el('span', { class: 'tagrow-count' }, String(count)));
  };

  const everyKey = [...rows.map(([t]) => t), ...(untagged ? [UNTAGGED] : [])];
  const allOn = () => { ui.hiddenTags = []; save(); render(); openTagFilter(); };
  const noneOn = () => { ui.hiddenTags = [...everyKey]; save(); render(); openTagFilter(); };

  pop.replaceChildren(
    el('div', { class: 'pop-head' },
      el('span', {}, 'Show'),
      el('button', { class: 'icon', title: 'Close', onclick: closePops }, '✕')),
    rows.length || untagged
      ? el('div', { class: 'tagrows' },
          ...rows.map(([t, n]) => row(t, t, n)),
          untagged ? row(UNTAGGED, 'Untagged', untagged) : null)
      : el('div', { class: 'hint' }, 'Nothing is tagged yet. Open a tile’s details to give it one.'),
    (rows.length || untagged)
      ? el('div', { class: 'row', style: 'margin-top:8px' },
          el('button', { class: 'btn ghost', onclick: allOn }, 'All'),
          el('button', { class: 'btn ghost', onclick: noneOn }, 'None'))
      : null,
    el('div', { class: 'hint', style: 'margin-top:8px' },
      'A tile with more than one tag needs all of them on, so turning one off takes those things off the board.')
  );

  placePop(pop, $('#openTags'));
  $('#scrim').hidden = false;
}

/* ---------------- inspector ---------------- */

function closeInspector() {
  $('#inspector').hidden = true;
  if ($('#monthPop').hidden && $('#menuPop').hidden && $('#widgetPop').hidden &&
      $('#accountPop').hidden && $('#syncDrawer').hidden) $('#scrim').hidden = true;
}

function openInspector(id, opts = {}) {
  const b = findBlock(id);
  if (!b) return;
  selectedId = id;
  const insp = $('#inspector');

  const body = el('div', { class: 'insp-body' });
  const field = (label, node) => el('div', { class: 'f' }, el('label', {}, label), node);
  const bindF = (node, key, cast) => {
    node.addEventListener('input', () => {
      b[key] = cast ? cast(node.value) : node.value;
      save();
      if (key === 'day' || key === 'rating' || key === 'title') renderView();
    });
    return node;
  };

  insp.replaceChildren();

  if (b.kind === 'photo' || b.kind === 'media') {
    const img = el('img', { class: 'insp-media', alt: '' });
    paintMedia(img, b);
    insp.append(img);
  }

  body.append(
    el('div', { style: 'display:flex;justify-content:space-between;align-items:center' },
      el('div', { class: 'hint', style: 'text-transform:uppercase;letter-spacing:.12em' }, b.source || b.kind),
      el('button', { class: 'icon', onclick: closeInspector }, '✕')));

  if (b.kind === 'photo' || b.kind === 'media') {
    body.append(field('Title', bindF(el('input', { value: b.title || '' }), 'title')));
    body.append(field('Subtitle', bindF(el('input', { value: b.subtitle || '' }), 'subtitle')));

    /* As many tags as the thing deserves. Each one is a chip you can take off,
       and the box under them adds another — typed, or picked from everything
       you have used before. */
    const choices = knownTags();
    const current = tagsOf(b);

    const tagBox = el('input', {
      value: '', placeholder: current.length ? 'Add another…' : 'Movie, Book, Game…',
      list: 'tagChoices', spellcheck: 'false'
    });

    const commit = (list) => {
      setTags(b, list);
      save();
      renderView();
      openInspector(id, { focusTags: true });   // redraw, ready for the next one
    };

    const addTyped = () => {
      const typed = tagBox.value.trim();
      if (!typed) return;
      tagBox.value = '';
      // one box, several tags: "movie, rewatch" adds both
      commit([...current, ...typed.split(',')]);
    };

    tagBox.addEventListener('change', addTyped);       // covers picking from the list
    tagBox.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); addTyped(); }
      // backspace in an empty box takes the last chip off, as tag boxes do
      if (e.key === 'Backspace' && !tagBox.value && current.length) {
        e.preventDefault();
        commit(current.slice(0, -1));
      }
    });
    tagBox.addEventListener('blur', addTyped);

    const chipsFor = current.map((t) => el('span', { class: 'tagchip' }, t,
      el('button', {
        title: `Remove ${t}`,
        onclick: () => commit(current.filter((x) => x !== t))
      }, '✕')));

    body.append(field('Tags', el('div', { class: 'tagfield' },
      chipsFor.length ? el('div', { class: 'tagset' }, ...chipsFor) : null,
      tagBox,
      el('datalist', { id: 'tagChoices' }, ...choices.map((t) => el('option', { value: t }))))));
  }

  /* A real date field, not a list of this month's days: a photo uploaded today
     may well be from last summer, and saying so should file it under last
     summer rather than leave it stranded here. */
  const known = b.date || (b.day
    ? `${ui.cursor}-${pad(b.day)}`          // an older block that only knew its day
    : '');
  const dateInput = el('input', { type: 'date', value: known });
  dateInput.addEventListener('change', () => setBlockDate(b, dateInput.value));

  const clearDate = el('button', {
    class: 'btn ghost', onclick: () => { dateInput.value = ''; setBlockDate(b, ''); }
  }, 'No date');

  body.append(field('Date', el('div', { class: 'row' }, dateInput, clearDate)));

  if (b.kind === 'photo' || b.kind === 'media') {
    const rating = el('input', { type: 'number', min: '0', max: '5', step: '0.5', value: b.rating ?? '' });
    rating.addEventListener('input', () => { b.rating = rating.value === '' ? null : +rating.value; save(); renderView(); });
    body.append(field('Rating (0–5)', rating));
  }

  if (b.kind === 'media') {
    /* When a lookup picks the wrong film, or you just want a specific poster:
       paste any image URL — a themoviedb.org/t/p/... one, or anything else. */
    const poster = el('input', { value: b.src || '', placeholder: 'https://…/poster.jpg' });
    const setPoster = () => {
      b.src = poster.value.trim();
      delete b.ratio;                       // let the new image state its own shape
      save();
      renderView();
    };
    poster.addEventListener('change', setPoster);
    poster.addEventListener('keydown', (e) => { if (e.key === 'Enter') setPoster(); });
    body.append(field('Poster URL', poster));
  }

  body.append(field('Note', bindF(el('textarea', { placeholder: 'what happened…' }, b.note || ''), 'note')));

  const chips = el('div', { class: 'chipset' }, ...SIZES.map((s) =>
    el('button', {
      class: 'chip' + (sizeOf(b) === s ? ' is-on' : ''),
      onclick: () => { b.size = s; save(); render(); openInspector(id); }
    }, SIZE_LABEL[s])));
  body.append(field('Size', chips));

  if (b.url) body.append(el('a', { href: b.url, target: '_blank', rel: 'noreferrer', class: 'hint' }, 'Open on ' + (b.source || 'site') + ' ↗'));

  body.append(el('button', { class: 'btn danger', onclick: () => removeBlock(id) }, 'Delete block'));

  insp.append(body);
  insp.hidden = false;
  $('#scrim').hidden = false;
  if (opts.focusTags) insp.querySelector('.tagfield input')?.focus();
  renderView();
}

/* ---------------- song ---------------- */

const audio = $('#audio');
let currentSongKey = null;

/* A song is big, so prefer streaming it over pulling the whole file into memory.
   A local copy plays instantly and offline; anything else comes straight off the
   server as a normal media URL, which also gives the browser range requests, so
   the scrubber can seek without downloading everything first. */
async function songSource(blobId) {
  const local = await DB.getBlob(blobId);
  if (local) {
    if (urlCache.has(blobId)) return urlCache.get(blobId);
    const url = URL.createObjectURL(local);
    urlCache.set(blobId, url);
    return url;
  }
  return Account.user ? '/api/blob/' + encodeURIComponent(blobId) : null;
}

async function loadSong() {
  const m = month();
  const clear = $('#songClear');
  if (!m.song) {
    audio.pause();
    audio.removeAttribute('src');
    currentSongKey = null;
    $('#trackName').textContent = 'No song for this month';
    $('#playBtn').disabled = true;
    $('#scrubFill').style.width = '0';
    $('#trackTime').textContent = '0:00';
    clear.hidden = true;
    return;
  }
  clear.hidden = false;
  $('#playBtn').disabled = false;
  $('#trackName').textContent = m.song.name;
  if (currentSongKey === m.song.blobId) return;
  currentSongKey = m.song.blobId;
  const url = await songSource(m.song.blobId);
  if (!url) { $('#trackName').textContent = m.song.name + ' (file missing)'; $('#playBtn').disabled = true; return; }
  audio.src = url;
  if (ui.autoplay) {
    // browsers refuse autoplay until the page has been interacted with; the
    // toggle itself counts, so this works from the second month onward
    audio.play().catch(() => {});
  }
}

async function setSong(file) {
  const m = month();
  if (m.song) await DB.delBlob(m.song.blobId);
  const id = uid();
  await DB.putBlob(id, file);
  m.song = { blobId: id, name: file.name.replace(/\.[^.]+$/, '') };
  save();
  currentSongKey = null;
  loadSong();

  const label = MONTHS[cursorParts().month - 1];
  if (!Account.user) {
    toast(`Song set for ${label} — sign in to hear it on your other devices`);
    return;
  }

  /* Say plainly whether the file actually reached the server. A song that only
     lives in this browser will not play anywhere else, and staying quiet about
     that is how you find out weeks later. */
  toast(`Uploading ${(file.size / 1048576).toFixed(1)} MB…`);
  setBusy(true);
  try {
    await Account.uploadBlob(id, file, { loud: true });
    toast(`Song set for ${label} — stored, plays on your other devices`);
  } catch (e) {
    toast('Saved on this device, but the upload failed: ' + e.message, true);
  }
  setBusy(false);
}

audio.addEventListener('timeupdate', () => {
  const pct = audio.duration ? (audio.currentTime / audio.duration) * 100 : 0;
  $('#scrubFill').style.width = pct + '%';
  $('#trackTime').textContent = fmtTime(audio.currentTime) + ' / ' + fmtTime(audio.duration);
});
audio.addEventListener('play', () => { $('#playBtn').textContent = '❚❚'; });
audio.addEventListener('pause', () => { $('#playBtn').textContent = '▶'; });
audio.addEventListener('ended', () => { $('#playBtn').textContent = '▶'; });

$('#playBtn').addEventListener('click', () => { audio.paused ? audio.play() : audio.pause(); });
$('#scrub').addEventListener('click', (e) => {
  if (!audio.duration) return;
  const r = e.currentTarget.getBoundingClientRect();
  audio.currentTime = ((e.clientX - r.left) / r.width) * audio.duration;
});
$('#vol').addEventListener('input', (e) => { audio.volume = +e.target.value; });
audio.volume = 0.85;
function paintAutoplay() {
  const btn = $('#autoplayBtn');
  btn.classList.toggle('is-on', !!ui.autoplay);
  btn.setAttribute('aria-pressed', ui.autoplay ? 'true' : 'false');
  btn.title = ui.autoplay
    ? 'Autoplay is on — the song starts when you open a month'
    : 'Autoplay the song for this month';
}

$('#autoplayBtn').addEventListener('click', () => {
  ui.autoplay = !ui.autoplay;
  save();
  paintAutoplay();
  // this click is the gesture that lets the browser play at all
  if (ui.autoplay && month().song && audio.paused) audio.play().catch(() => {});
  if (!ui.autoplay) audio.pause();
  toast(ui.autoplay ? 'Autoplay on' : 'Autoplay off');
});

$('#songBtn').addEventListener('click', () => $('#songPicker').click());
$('#songClear').addEventListener('click', async () => {
  const m = month();
  if (!m.song) return;
  await DB.delBlob(m.song.blobId);
  m.song = null;
  save();
  loadSong();
});

/* ---------------- sync ---------------- */

/* Drop imported rows into whichever month they belong to, creating months as
   needed. Returns what actually landed, after de-duplication. */
/* "The Wrong Girls" and "the wrong girls " are the same film. */
const normTitle = (t) => (t || '')
  .toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, ' ').trim();

const yearOf = (b) => (String(b.subtitle || '').match(/\b(19|20)\d{2}\b/) || [''])[0];

/* Which film this is, ignoring when you watched it. */
const filmKey = (b) => `${b.source || ''}|${normTitle(b.title)}|${yearOf(b)}`;

/* Which *watch* this is. The day has to be part of it: watching the same film
   again in March is a diary entry of its own, not a copy of the one in
   February, and leaving the date out quietly deleted every rewatch. */
const dupKey = (b) => `${filmKey(b)}|${b.date || ''}`;

/* The export is the authority: it is your whole diary, with your reviews. The RSS
   feed only carries the last ~50 watches, but it does carry posters. So when both
   describe the same film, keep the export's entry and take the feed's artwork. */
function mergeDuplicates() {
  const seen = new Map();
  const doomed = new Set();
  // which copy survives: the export, then whichever carries more of your own work
  const score = (x) => (x.origin === 'export' ? 4 : 0) + (x.note ? 2 : 0) + (x.rating != null ? 1 : 0);

  for (const [key, m] of Object.entries(state.months)) {
    for (const b of m.blocks) {
      if (b.kind !== 'media' || !b.title) continue;
      const k = dupKey(b);
      const prev = seen.get(k);
      if (!prev) { seen.set(k, { block: b, monthKey: key }); continue; }

      /* Two rows out of the same export on the same day are two real logs —
         Letterboxd lets you watch something twice in an evening — so they are
         left alone. A pair from different places is one watch described twice. */
      if (b.origin === 'export' && prev.block.origin === 'export') continue;

      const keep = score(b) > score(prev.block) ? b : prev.block;
      const drop = keep === b ? prev.block : b;

      if (!keep.src && drop.src) keep.src = drop.src;         // the feed's poster
      if (!keep.note && drop.note) keep.note = drop.note;
      if (keep.rating == null && drop.rating != null) keep.rating = drop.rating;
      if (!keep.url && drop.url) keep.url = drop.url;

      doomed.add(drop);
      seen.set(k, { block: keep, monthKey: keep === b ? key : prev.monthKey });
    }
  }

  // remove only after the scan — splicing mid-iteration skips entries
  let removed = 0;
  for (const m of Object.values(state.months)) {
    const before = m.blocks.length;
    m.blocks = m.blocks.filter((b) => {
      if (!doomed.has(b)) return true;
      tombstone(m, b.id);
      return false;
    });
    removed += before - m.blocks.length;
  }

  if (removed) { save(); render(); }
  return removed;
}

/* After an export lands, the RSS copies are redundant: the export covers the same
   period with your real dates and reviews. So they go — but first each one hands
   its poster to its export twin, since the feed's artwork is the one thing the
   export lacks.
   Entries newer than the export's last day are kept: those are watches that
   happened after you generated the export, and nothing else has them. */
function purgeFeedEntries(source = 'letterboxd') {
  const twins = new Map();        // the same watch, on the same day
  const sameFilm = new Map();     // every log of that film, whenever it happened
  let cutoff = '';

  for (const m of Object.values(state.months)) {
    for (const b of m.blocks) {
      if (b.source !== source || b.origin !== 'export') continue;
      twins.set(dupKey(b), b);
      const list = sameFilm.get(filmKey(b));
      if (list) list.push(b); else sameFilm.set(filmKey(b), [b]);
      if ((b.date || '') > cutoff) cutoff = b.date || '';
    }
  }
  if (!twins.size) return { removed: 0, donated: 0, keptNewer: 0 };

  let removed = 0, donated = 0, keptNewer = 0;

  for (const m of Object.values(state.months)) {
    m.blocks = m.blocks.filter((b) => {
      if (b.source !== source || b.origin === 'export') return true;

      /* The feed's one gift is the poster, and every log of that film wants it —
         a rewatch in March should not sit there blank because the poster arrived
         attached to February. So artwork goes to all of them, while your writing
         and your rating stay with the watch they belong to. */
      const twin = twins.get(dupKey(b));
      if (b.src) {
        for (const other of sameFilm.get(filmKey(b)) || []) {
          if (!other.src) { other.src = b.src; donated++; }
        }
      }
      if (twin) {
        if (!twin.note && b.note) twin.note = b.note;
        if (twin.rating == null && b.rating != null) twin.rating = b.rating;
        if (!twin.url && b.url) twin.url = b.url;
        removed++;
        tombstone(m, b.id);
        return false;
      }
      // no twin: only safe to drop if the export already covers that date
      if (b.date && b.date <= cutoff) { removed++; tombstone(m, b.id); return false; }
      keptNewer++;
      return true;
    });
  }

  if (removed) { save(); render(); }
  return { removed, donated, keptNewer };
}

/* A reviews.csv describes films that are probably already in the journal, so its
   job is to fill in notes, not to add a second copy of every film. Match the way
   the zip does: the exact watch, then the same film that year, then the film. */
function attachReviews(items) {
  const mine = allBlocks().filter((b) => b.source === 'letterboxd');
  const byDate = new Map(), byYear = new Map(), byTitle = new Map();
  for (const b of mine) {
    byDate.set(`${normTitle(b.title)}|${b.date || ''}`, b);
    byYear.set(`${normTitle(b.title)}|${b.subtitle || ''}`, b);
    if (!byTitle.has(normTitle(b.title))) byTitle.set(normTitle(b.title), b);
  }

  let attached = 0, alreadyWritten = 0;
  const unmatched = [];

  for (const it of items) {
    if (!it.review) continue;
    const hit = byDate.get(`${normTitle(it.title)}|${it.date}`)
             || byYear.get(`${normTitle(it.title)}|${it.subtitle}`)
             || byTitle.get(normTitle(it.title));
    if (!hit) { unmatched.push(it); continue; }
    if (hit.note) { alreadyWritten++; continue; }    // never clobber your own edit
    hit.note = it.review;
    if (hit.rating == null && it.rating != null) hit.rating = it.rating;
    attached++;
  }
  if (attached) { save(); render(); }
  return { attached, alreadyWritten, unmatched };
}

/* The one path every Letterboxd file takes, whether it is the zip, diary.csv or
   reviews.csv on its own. */
async function importExport(file) {
  const { items, from } = await Connectors.fromLetterboxdExport(file);
  if (!items.length) throw new Error('no dated rows found in ' + from);

  const withReviews = items.filter((i) => i.review).length;
  const res = attachReviews(items);

  // anything the journal did not already have still gets imported
  const fresh = items.filter((i) => !i.review || res.unmatched.includes(i));
  if (fresh.length) {
    importSummary('Letterboxd export', applyImport(fresh, { origin: 'export' }), fresh.length);
  }
  if (res.attached || res.alreadyWritten) {
    toast(`Reviews: ${res.attached} added to notes` +
      (res.alreadyWritten ? `, ${res.alreadyWritten} left alone (already written)` : '') +
      (res.unmatched.length ? `, ${res.unmatched.length} were for films not in the journal` : ''));
  } else if (withReviews && !res.attached) {
    toast(`Read ${withReviews} reviews from ${from}`);
  }

  afterExport();
  fillArtwork({ loud: true });
}

/* One call for everything an export import implies. */
function afterExport() {
  const { removed, donated, keptNewer } = purgeFeedEntries('letterboxd');
  mergeDuplicates();
  if (removed) {
    toast(`Export is now the record: ${removed} RSS ${removed === 1 ? 'entry' : 'entries'} removed` +
      (donated ? `, ${donated} poster${donated === 1 ? '' : 's'} kept` : '') +
      (keptNewer ? `, ${keptNewer} newer watch${keptNewer === 1 ? '' : 'es'} left alone` : ''));
  }
}

function applyImport(items, opts = {}) {
  let added = 0;
  const touched = new Set();

  let enriched = 0;

  for (const it of items) {
    const key = it.date ? it.date.slice(0, 7) : ui.cursor;
    const m = month(key);
    const sig = (it.source || '') + '|' + (it.title || '') + '|' + (it.date || '');
    const existing = m.blocks.find((b) => ((b.source || '') + '|' + (b.title || '') + '|' + (b.date || '')) === sig);

    if (existing) {
      // already here, but a re-pull may carry things the first one lacked —
      // a review you wrote later, a rating, artwork
      let changed = false;
      // re-dropping the zip promotes a block imported before origins existed, so
      // the purge below can tell export entries from feed ones
      if (opts.origin) existing.origin = opts.origin;
      if (!tagsOf(existing).length) {
        const t = defaultTag(it);
        if (t) { existing.tags = [t]; delete existing.tag; changed = true; }
      }
      if (it.review && !existing.note) { existing.note = it.review; changed = true; }
      if (it.image && !existing.src) { existing.src = it.image; changed = true; }
      if (it.rating != null && existing.rating == null) { existing.rating = it.rating; changed = true; }
      if (changed) { enriched++; touched.add(key); }
      continue;
    }

    m.blocks.push({
      id: uid(), kind: 'media', size: 'sm',
      src: it.image || '',
      title: it.title, subtitle: it.subtitle || '',
      url: it.url || '',
      date: it.date || null,
      day: it.date ? +it.date.slice(8, 10) : null,
      rating: it.rating ?? null,
      source: it.source,
      tags: defaultTag(it) ? [defaultTag(it)] : [],   // a film is a film without you saying so
      origin: opts.origin || 'feed',   // 'export' wins when the same film arrives twice
      note: it.review || ''            // your own words, kept with the thing
    });
    added++;
    touched.add(key);
  }

  save();
  render();
  return { added, enriched, months: [...touched].sort() };
}

const allBlocks = () => Object.values(state.months).flatMap((m) => m.blocks);

function setBusy(on) { $('#syncBusy').hidden = !on; }

/* ---------------- file sync ----------------
   The journal document and the files it points at travel separately: the
   document is small and pushed on every save, while photos and songs are
   uploaded one by one. An upload that quietly failed used to stay failed
   forever — the other device then shows a card with a name and no picture,
   because the bytes exist on exactly one machine.

   This reconciles the two: anything held here that the account has not got is
   uploaded, and anything the document references that neither side has is
   reported, since only the device holding the original can fix that. */
/* Turn the reasons an upload can fail into something you can act on. The
   underlying libraries talk about environment variables and status codes; what
   matters is which of a few situations you are in. */
function explainUploadError(msg = '') {
  if (/no token found|BLOB_READ_WRITE_TOKEN/i.test(msg)) {
    return 'This site has no file storage connected yet. In Vercel: open the project, ' +
           'Storage, create a Blob store, connect it, then redeploy. Your photos are ' +
           'safe on this device meanwhile.';
  }
  if (/payload too large|413/i.test(msg)) {
    return 'The host refused a file for being too large. Try that photo again — it will ' +
           'be resized first.';
  }
  if (/not signed in|401/i.test(msg)) return 'Signed out mid-upload. Sign in and press sync again.';
  if (/failed to fetch|network/i.test(msg)) return 'Lost the connection. Press sync again when you are back online.';
  return msg;
}

async function syncFiles(opts = {}) {
  if (!Account.user) {
    if (opts.loud) toast('Sign in first — files only travel through an account');
    return;
  }

  setBusy(true);
  try {
    const localIds = await DB.allBlobIds();
    const remoteIds = new Set(await Account.remoteBlobIds());
    const missingUp = localIds.filter((id) => !remoteIds.has(id));

    let sent = 0, resized = 0, savedBytes = 0, sentWhole = 0;
    const failures = [];
    const stilled = [];        // Live Photos turned into pictures
    for (const id of missingUp) {
      let blob = await DB.getBlob(id);
      if (!blob) continue;

      const owner = allBlocks().find((b) => b.blobId === id);
      const label = owner?.title || 'a file';

      /* Anything too big for the host is re-encoded here rather than reported as
         a failure. This catches files added before shrinking existed, and files
         that arrived from an older version of the app. The smaller copy replaces
         the local one so both sides hold the same bytes and it never has to be
         done twice. */
      if (blob.size > UPLOAD_LIMIT) {
        const smaller = await shrinkImage(blob);
        if (smaller !== blob && smaller.size < blob.size) {
          await DB.putBlob(id, smaller);
          savedBytes += blob.size - smaller.size;
          resized++;

          /* A Live Photo just became a still. The block still calls itself a
             video, and a video element pointing at a picture renders nothing —
             so it has to be told what it is holding now. */
          if (owner && owner.mime !== smaller.type) {
            if (/^video\//.test(owner.mime || '') ) stilled.push(label);
            owner.mime = smaller.type;
            delete owner.ratio;                // the still may be shaped differently
          }

          blob = smaller;
          const url = urlCache.get(id);        // the on-screen copy is now stale
          if (url) { URL.revokeObjectURL(url); urlCache.delete(id); }
        }
      }

      /* Still too big to shrink is not the end of the road: a file over the
         limit goes straight to the storage service instead of through this
         site, which is the whole reason that route exists. Refusing here — as
         this used to — stranded exactly the files that needed it most, Live
         Photos above all. Send it and let the upload decide. */
      const oversize = blob.size > UPLOAD_LIMIT;

      try {
        const ok = await Account.uploadBlob(id, blob, { loud: true });
        if (ok) { sent++; if (oversize) sentWhole++; }
      } catch (e) {
        const mb = (blob.size / 1048576).toFixed(1);
        const why = shrinkFailures.get(blob);
        failures.push(oversize
          ? `${label} (${mb} MB${why ? `, ${why}` : ''}): ${e.message}`
          : `${label}: ${e.message}`);
      }
      if (opts.loud && missingUp.length > 3 && sent && sent % 5 === 0) {
        toast(`Uploading files… ${sent} of ${missingUp.length}`);
      }
    }

    // files the journal points at that are nowhere this device can reach
    const localSet = new Set(localIds);
    const wanted = new Set(allBlocks().filter((b) => b.blobId).map((b) => b.blobId));
    for (const m of Object.values(state.months)) if (m.song) wanted.add(m.song.blobId);
    const stranded = [...wanted].filter((id) => !localSet.has(id) && !remoteIds.has(id));

    if (stilled.length) {
      toast(`${stilled.length} Live Photo${stilled.length === 1 ? '' : 's'} saved as a still so ${stilled.length === 1 ? 'it' : 'they'} can sync: ${stilled.slice(0, 3).join(', ')}`);
    }
    if (sent) {
      toast(`Uploaded ${sent} file${sent === 1 ? '' : 's'} to your account` +
        (resized ? ` · ${resized} resized first, saving ${(savedBytes / 1048576).toFixed(1)} MB` : '') +
        (sentWhole ? ` · ${sentWhole} sent full size straight to storage` : ''));
    }
    if (failures.length) {
      toast(`${failures.length} file${failures.length === 1 ? '' : 's'} could not upload. ` +
        explainUploadError(failures[0]), true);
      console.warn('journal.jack — files that did not upload:', failures);
    }
    // only worth mentioning when uploads are otherwise working
    if (stranded.length && !failures.length) {
      setTimeout(() => toast(
        `${stranded.length} item${stranded.length === 1 ? '' : 's'} here still have no file on the account — ` +
        'open the app on the device you added them from and choose "Upload missing files"', true), 1200);
    }
    if (opts.loud && !sent && !failures.length && !stranded.length) toast('Every file is already on your account');

    if (sent) render();      // anything that just arrived can now be drawn
  } catch (e) {
    if (opts.loud) toast('File sync failed: ' + e.message, true);
  }
  setBusy(false);
}

/* ---- posters for imports that arrived without artwork ----
   A Letterboxd export has titles, years and ratings but no images. The server
   resolves them (Wikipedia by default, TMDb if you add a key) and caches every
   answer, so a second run over the same films is instant. */
const MUSIC_SOURCES = new Set(['musicboard', 'lastfm']);

/* Albums are identified by artist, films by year. Build the request and the key
   the server will answer with from the same place, so they cannot drift apart. */
function artworkQuery(b) {
  if (MUSIC_SOURCES.has(b.source)) {
    // "John Coltrane · 42 plays" -> "John Coltrane"
    const artist = String(b.subtitle || '').split('·')[0].trim();
    return {
      item: { kind: 'album', title: b.title, artist },
      key: `album:${b.title.toLowerCase()}|${artist.toLowerCase()}`
    };
  }
  /* Only a real year counts. A subtitle can be "MOVIE" (AniList) or "Sep 2"
     (a feed with no year), and passing that as the year means every match is
     rejected and nothing ever resolves. */
  const raw = String(b.subtitle || '').trim();
  const year = /^(19|20)\d{2}$/.test(raw) ? raw : '';
  return { item: { title: b.title, year }, key: `${b.title.toLowerCase()}|${year}` };
}

let fillingArtwork = false;

async function fillArtwork(opts = {}) {
  if (fillingArtwork) return 0;                    // one sweep at a time
  /* Repair before filling. A music block wearing an image from IMDb's CDN got it
     from the film cascade — that is the "Evangelion single with a comedy film
     poster" case — so drop it and look the album up properly. */
  let repaired = 0;
  for (const b of allBlocks()) {
    if (MUSIC_SOURCES.has(b.source) && /media-amazon.com|upload.wikimedia.org/.test(b.src || '')) {
      b.src = '';
      repaired++;
    }
  }
  if (repaired) { save(); toast(`Dropped ${repaired} wrong cover${repaired === 1 ? '' : 's'} — looking them up again`); }

  const missing = allBlocks().filter((b) => b.kind === 'media' && !b.src && b.title);
  if (!missing.length) { if (opts.loud) toast('Every item already has artwork'); return 0; }

  // fill what you are actually looking at first
  const here = new Set(month().blocks);
  const need = [...missing].sort((a, b) => (here.has(b) ? 1 : 0) - (here.has(a) ? 1 : 0));
  fillingArtwork = true;
  try {
    return await runArtwork(need, opts);
  } finally {
    fillingArtwork = false;
  }
}

async function runArtwork(need, opts = {}) {

  setBusy(true);
  // Wikipedia allows about one lookup a second, so a long diary takes a while.
  // Small chunks keep the tiles filling in as it goes.
  // small batches: a serverless host caps how long one request may run
  const CHUNK = 12;
  const eta = ` (~${Math.max(1, Math.ceil(need.length * (state.sync.tmdbKey ? 0.1 : 0.35)))}s)`;
  if (opts.loud) toast(`Looking up ${need.length} poster${need.length === 1 ? '' : 's'}${eta}`);

  let filled = 0, none = 0, pending = 0, throttled = false;

  for (let i = 0; i < need.length; i += CHUNK) {
    const chunk = need.slice(i, i + CHUNK);
    let data;
    try {
      const res = await fetch('/api/artwork', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: chunk.map((b) => artworkQuery(b).item),
          tmdbKey: state.sync.tmdbKey || ''
        })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        if (err.error) toast('Posters: ' + err.error, true);
        pending += need.length - i;
        break;
      }
      data = await res.json();
    } catch { pending += need.length - i; break; }

    pending += data.pending || 0;
    throttled = throttled || data.throttled;

    for (const b of chunk) {
      const url = data.found[artworkQuery(b).key];
      if (url) { b.src = url; filled++; }
      else if (url === '') none++;
    }
    save();
    renderView();

    const left = need.length - Math.min(i + CHUNK, need.length);
    if (opts.loud && left) toast(`Posters: ${filled} found · ${left} to go`);
  }

  setBusy(false);

  // Say exactly what happened — a silent partial result is what made this look broken.
  const parts = [];
  if (filled) parts.push(`${filled} found`);
  if (none) parts.push(`${none} found nowhere`);
  if (pending) parts.push(`${pending} not looked up yet`);
  if (opts.loud) {
    toast(parts.length ? 'Posters: ' + parts.join(' · ') : 'No posters matched those titles', !filled);
  } else if (filled) {
    toast(`Found ${filled} poster${filled === 1 ? '' : 's'}`);
  }
  if (pending && throttled && opts.loud) {
    setTimeout(() => toast('Throttled on the rest — run "Find missing posters" again', true), 1200);
  }
  return filled;
}

/* ---- refresh configured services when the app opens ---- */
async function autoRefresh(force = false) {
  if (!state.sync.autoRefresh && !force) return;
  const since = Date.now() - (state.sync.lastAuto || 0);
  if (!force && since < 30 * 60 * 1000) return;      // at most twice an hour

  let list;
  try { list = await Connectors.services(); } catch { return; }   // no server: nothing to do

  const ready = list.filter((svc) =>
    svc.fields.every((f) => f.optional || (state.sync.services[svc.id] || {})[f.key]));
  if (!ready.length) return;

  setBusy(true);
  const mk = ui.cursor;
  let added = 0;
  const names = [];
  for (const svc of ready) {
    try {
      const items = await Connectors.pull(svc.id, state.sync.services[svc.id], { from: mk, to: mk });
      const res = applyImport(items);
      mergeDuplicates();
      if (res.added) { added += res.added; names.push(svc.name); }
    } catch { /* a service being down should not interrupt opening the app */ }
  }
  state.sync.lastAuto = Date.now();
  save();
  setBusy(false);
  fillArtwork();                       // anything that arrived without artwork
  if (added) toast(`Refreshed: ${added} new from ${names.join(', ')}`);
}

function importSummary(label, res, total) {
  if (!res.added) {
    toast(res.enriched
      ? `${label}: nothing new, but filled in ${res.enriched} review${res.enriched === 1 ? '' : 's'} / rating${res.enriched === 1 ? '' : 's'}`
      : `${label}: nothing new (${total} already in the journal)`);
    return;
  }
  const span = res.months.length > 1
    ? `${res.months.length} months, ${res.months[0]} → ${res.months[res.months.length - 1]}`
    : res.months[0];
  toast(`${label}: ${res.added} added across ${span}`);
  state.sync.last = { label, added: res.added, months: res.months, at: Date.now() };
  save();
  if (!$('#syncDrawer').hidden) renderSync();
}

function autoControls() {
  const box = el('input', { type: 'checkbox' });
  box.checked = !!state.sync.autoRefresh;
  box.addEventListener('change', () => { state.sync.autoRefresh = box.checked; save(); });

  const when = state.sync.lastAuto
    ? 'Last run ' + new Date(state.sync.lastAuto).toLocaleString()
    : 'Has not run yet';

  const tmdb = el('input', {
    value: state.sync.tmdbKey || '', type: 'password', placeholder: 'optional TMDb key'
  });
  tmdb.addEventListener('input', () => { state.sync.tmdbKey = tmdb.value.trim(); save(); });

  return el('div', { class: 'f' },
    el('label', {}, 'On open'),
    el('label', { class: 'check' }, box,
      el('span', {}, 'Refresh every configured service for the current month')),
    el('div', { class: 'hint' }, when, ' · runs at most twice an hour · ',
      el('button', {
        class: 'linky',
        onclick: () => { closePops(); autoRefresh(true); }
      }, 'refresh now')),
    el('label', { style: 'margin-top:10px' }, 'Poster lookup'),
    tmdb,
    el('div', { class: 'hint' },
      'Imports with no artwork (a Letterboxd export) get posters automatically from IMDb — no key, no setup, and it covers festival one-offs, foreign titles and anime. A TMDb key is optional: it is tried first when present and matches years more strictly. ',
      el('button', { class: 'linky', onclick: () => { closePops(); fillArtwork({ loud: true }); } }, 'find missing posters')));
}

function rangeControls() {
  const r = state.sync.range || (state.sync.range = { from: '', to: '' });

  const from = el('input', { type: 'month', value: r.from || '' });
  const to = el('input', { type: 'month', value: r.to || '' });
  const sync = () => { r.from = from.value; r.to = to.value; save(); renderSync(); };
  from.addEventListener('change', sync);
  to.addEventListener('change', sync);

  const preset = (label, f, t) => el('button', {
    class: 'chip' + ((r.from || '') === f && (r.to || '') === t ? ' is-on' : ''),
    onclick: () => { r.from = f; r.to = t; save(); renderSync(); }
  }, label);

  const now = `${today.getFullYear()}-${pad(today.getMonth() + 1)}`;
  const yr = today.getFullYear();

  return el('div', { class: 'f' },
    el('label', {}, 'How far back to pull'),
    el('div', { class: 'chipset' },
      preset('Everything', '', ''),
      preset('This month', ui.cursor, ui.cursor),
      preset('This year', `${yr}-01`, `${yr}-12`),
      preset('Last 3 years', `${yr - 2}-01`, now)),
    el('div', { class: 'row', style: 'margin-top:6px' }, from, to),
    el('div', { class: 'hint' }, 'Leave both blank for your whole history. Items land in the month they happened, not the month you are looking at.'));
}

function csvDrop(cfg) {
  const zone = el('div', {
    class: 'dropzone',
    onclick: () => picker.click()
  }, el('b', {}, 'Drop diary.csv or the export .zip'),
     el('span', {}, 'letterboxd.com/settings/data → Export your data. This reads your entire diary, dates and star ratings included.'));

  const picker = el('input', { type: 'file', accept: '.csv,.zip', style: 'display:none' });

  const take = async (file) => {
    if (!file) return;
    zone.classList.add('busy');
    try { await importExport(file); }
    catch (e) { toast('Export import failed: ' + e.message, true); }
    zone.classList.remove('busy');
  };

  picker.addEventListener('change', () => { take(picker.files[0]); picker.value = ''; });
  zone.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault(); e.stopPropagation();
    zone.classList.remove('over');
    document.body.classList.remove('dropping');
    take(e.dataTransfer.files[0]);
  });

  return el('div', {}, zone, picker);
}

async function renderSync() {
  const body = $('#syncBody');
  const cfgAll = state.sync.services;

  let list;
  try {
    list = await Connectors.services();
  } catch (e) {
    body.replaceChildren(el('div', { class: 'hint' },
      el('b', { style: 'color:var(--ink);font-size:13px;display:block;margin-bottom:6px' }, 'The importer needs the local server'),
      'Syncing runs in Node, not the page — the services either block browser requests outright or send no CORS header. Stop, run ',
      el('code', {}, 'node server.js'),
      ', and open ', el('code', {}, 'http://localhost:5173'), '.'));
    return;
  }

  const nodes = [autoControls(), rangeControls()];

  if (state.sync.last) {
    const l = state.sync.last;
    nodes.push(el('div', { class: 'hint' },
      `Last import — ${l.label}: ${l.added} items into ${l.months.length} month${l.months.length === 1 ? '' : 's'}.`));
  }

  for (const svc of list) {
    const cfg = cfgAll[svc.id] || (cfgAll[svc.id] = {});
    const box = el('div', { class: 'svc' });
    const bodyWrap = el('div', { class: 'svc-body' });
    bodyWrap.hidden = !cfg._open;

    const head = el('button', {
      class: 'svc-head',
      onclick: () => { cfg._open = !cfg._open; bodyWrap.hidden = !cfg._open; save(); }
    },
      el('span', { class: 'svc-dot ' + (svc.access === 'full' ? 'live' : 'partial') }),
      el('b', {}, svc.name),
      el('span', { class: 'tag' }, svc.history));

    for (const f of svc.fields) {
      const input = f.type === 'select'
        ? el('select', {}, ...f.options.map((o) => {
            const opt = el('option', { value: o }, o);
            if (cfg[f.key] === o) opt.selected = true;
            return opt;
          }))
        : el('input', {
            value: cfg[f.key] || '', placeholder: f.placeholder || '',
            type: f.secret ? 'password' : 'text'
          });
      const store = () => { cfg[f.key] = input.value; save(); };
      input.addEventListener('input', store);
      input.addEventListener('change', store);
      bodyWrap.append(el('div', { class: 'f' }, el('label', {}, f.label), input));
    }

    bodyWrap.append(el('div', { class: 'hint' }, svc.note));

    const r = state.sync.range || {};
    const label = () => 'Pull ' + (r.from || r.to
      ? `${r.from || 'the beginning'} → ${r.to || 'now'}`
      : 'everything');

    const btn = el('button', { class: 'pull' }, label());
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = 'Fetching…';
      try {
        const items = await Connectors.pull(svc.id, cfg, { from: r.from, to: r.to });
        importSummary(svc.name, applyImport(items), items.length);
        mergeDuplicates();
      } catch (e) {
        toast(svc.name + ': ' + e.message, true);
      }
      btn.disabled = false;
      btn.textContent = label();
    });
    bodyWrap.append(btn);

    if (svc.csv) bodyWrap.append(csvDrop(cfg));

    box.append(head, bodyWrap);
    nodes.push(box);
  }

  body.replaceChildren(...nodes);
}

/* ---------------- account ---------------- */

function paintAccountButton() {
  const btn = $('#openAccount');
  btn.textContent = Account.user ? Account.user.email.split('@')[0] : 'Sign in';
  btn.title = Account.user ? 'Signed in as ' + Account.user.email : 'Sync across devices';
}

/* Bring this device and the account copy together. Only one of them can win, so
   when both hold work, ask rather than guess. */
/* Pull the account's copy, merge it in (nothing is ever replaced), push the
   union back, then reconcile the files. Safe to press at any time and safe to
   press twice — merging is additive, so the worst case is that nothing changes. */
async function syncNow(opts = {}) {
  if (!Account.user) {
    if (opts.loud) toast('Sign in first — there is no account to sync with');
    return;
  }
  setBusy(true);
  try {
    const before = Object.values(state.months).reduce((n, m) => n + m.blocks.length, 0);
    const remote = await Account.pullDoc();

    if (remote.doc) {
      mergeDocs(state, remote.doc);
      resetPrints(state);
      await DB.saveState(state);
      render();
    }
    await Account.pushDoc(state);

    const after = Object.values(state.months).reduce((n, m) => n + m.blocks.length, 0);
    const gained = after - before;
    if (gained > 0) toast(`Pulled in ${gained} item${gained === 1 ? '' : 's'} from your account`);
    else if (opts.loud) toast('Journal already matches your account');

    await syncFiles(opts);
  } catch (e) {
    toast('Sync failed: ' + e.message, true);
  }
  setBusy(false);
  paintAccountButton();
}

async function syncAfterSignIn() {
  setBusy(true);
  try {
    const remote = await Account.pullDoc();

    /* This used to stop and ask which copy to keep, on every single load, because
       adopting was all or nothing. It isn't any more: months are merged one at a
       time and blocks are unioned by id, so both sides survive and there is
       nothing to choose between. */
    if (remote.doc) {
      const before = Object.values(state.months).reduce((n, m) => n + m.blocks.length, 0);
      mergeDocs(state, remote.doc);
      resetPrints(state);
      await DB.saveState(state);
      render();

      const after = Object.values(state.months).reduce((n, m) => n + m.blocks.length, 0);
      if (after > before) toast(`Signed in — ${after - before} items pulled in from your account`);
    }

    // push the merged result back so the account holds everything either side had
    await Account.pushDoc(state);

    await syncFiles();
  } catch (e) {
    toast('Sync failed: ' + e.message, true);
  }
  setBusy(false);
  paintAccountButton();
}

function renderAccount() {
  const pop = $('#accountPop');

  if (Account.user) {
    pop.replaceChildren(
      el('div', { class: 'acct-head' },
        el('div', { class: 'avatar' }, Account.user.email[0].toUpperCase()),
        el('div', {},
          el('b', {}, Account.user.email),
          el('div', { class: 'hint' }, state.updatedAt
            ? 'Last change ' + new Date(state.updatedAt).toLocaleString()
            : 'No changes yet'))),
      el('div', { class: 'row' },
        el('button', {
          class: 'btn', onclick: async () => { closePops(); await syncNow({ loud: true }); }
        }, 'Sync now'),
        el('button', {
          class: 'btn danger',
          onclick: async () => {
            await Account.logout();
            paintAccountButton();
            closePops();
            toast('Signed out — this device keeps its own copy');
          }
        }, 'Sign out')),
      el('div', { class: 'hint' },
        'Your journal and files live in the ', el('code', {}, 'data'),
        ' folder next to server.js — on this machine, not anyone else’s. To reach it from your phone or laptop, that server has to be reachable from them: same wi-fi via this machine’s LAN address, a tunnel like Tailscale, or a small host you run.'));
    return;
  }

  const email = el('input', { type: 'email', placeholder: 'you@example.com', autocomplete: 'username' });
  const pw = el('input', { type: 'password', placeholder: 'at least 8 characters', autocomplete: 'current-password' });
  const code = el('input', { type: 'text', placeholder: 'invite code' });
  const msg = el('div', { class: 'hint' });
  const { signupOpen, needsCode } = Account.policy;

  const attempt = async (fn, label) => {
    msg.textContent = label + '…';
    msg.classList.remove('bad');
    try {
      await fn(email.value.trim(), pw.value);
      closePops();
      paintAccountButton();
      await syncAfterSignIn();
    } catch (e) {
      msg.textContent = e.message;
      msg.classList.add('bad');
    }
  };

  const signIn = () => attempt((e, p) => Account.login(e, p), 'Signing in');
  pw.addEventListener('keydown', (e) => { if (e.key === 'Enter') signIn(); });

  pop.replaceChildren(
    el('div', { class: 'acct-title' }, 'Sync across devices'),
    el('div', { class: 'f' }, el('label', {}, 'Email'), email),
    el('div', { class: 'f' }, el('label', {}, 'Password'), pw),
    needsCode ? el('div', { class: 'f' }, el('label', {}, 'Invite code'), code) : null,
    el('div', { class: 'row' },
      el('button', { class: 'pull', onclick: signIn }, 'Sign in'),
      signupOpen
        ? el('button', {
            class: 'btn',
            onclick: () => attempt((e, p) => Account.signup(e, p, code.value.trim()), 'Creating account')
          }, 'Create account')
        : null),
    msg,
    el('div', { class: 'hint' },
      signupOpen
        ? 'The account lives on the server running this page. Signed out, the journal stays in this browser exactly as it is now.'
        : 'This server already has its account, and new sign-ups are closed. Sign in with it, or set SIGNUP_CODE on the server to invite someone.'));
}

$('#openAccount').addEventListener('click', () => {
  const open = $('#accountPop').hidden;
  closePops();
  if (!open) return;
  renderAccount();
  placePop($('#accountPop'), $('#openAccount'));
  $('#scrim').hidden = false;
});

/* ---------------- month navigation ---------------- */

function shiftMonth(delta) {
  const { year, month: mo } = cursorParts();
  // an arrow means "a month", so it steps out of the everything view first
  if (allMode()) { ui.all = false; selectedId = null; closeInspector(); save(); render(); return; }
  const d = new Date(year, mo - 1 + delta, 1);
  ui.cursor = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  selectedId = null;
  closeInspector();
  save();
  render();
}

let popYear = today.getFullYear();
function renderMonthPop() {
  $('#popYear').textContent = popYear;
  const { year, month: mo } = cursorParts();
  $('#popGrid').replaceChildren(...MONTHS.map((name, i) => {
    const key = `${popYear}-${pad(i + 1)}`;
    const has = !!state.months[key]?.blocks?.length;
    return el('button', {
      class: (!allMode() && popYear === year && i + 1 === mo) ? 'is-on' : '',
      onclick: () => { ui.all = false; ui.cursor = key; closePops(); save(); render(); }
    }, name.slice(0, 3) + (has ? ' •' : ''));
  }));

  /* Every month at once. It sits under the grid of months rather than among
     them, because it is not one of them. */
  const count = everyBlock().length;
  $('#popAll').replaceChildren(el('button', {
    class: 'pop-all' + (allMode() ? ' is-on' : ''),
    onclick: () => {
      ui.all = true;
      ui.view = 'grid';            // a calendar of every month at once is not a calendar
      selectedId = null;
      closeInspector();
      closePops();
      save();
      render();
    }
  }, `All${count ? ` · ${count} item${count === 1 ? '' : 's'}` : ''}`));
}

/* ---------------- per-month colours ----------------
   A month can set its own background and text colour. Only those two are
   stored; everything else the interface needs — panels, borders, the quieter
   greys — is mixed between them, so a month stays coherent whatever pair you
   pick, and readable text is never left sitting on a background it cannot be
   seen against.

   The values are written as inline custom properties on the root element, which
   beat the light/dark palette without replacing it: clear them and the theme
   comes straight back. */

const DEFAULT_COLOURS = {
  dark:  { bg: '#0e0e10', ink: '#f2efe9' },
  light: { bg: '#f6f2ea', ink: '#201d18' }
};

const COLOUR_PRESETS = [
  { name: 'Default',   bg: null,      ink: null },
  { name: 'Paper',     bg: '#f6f2ea', ink: '#201d18' },
  { name: 'Midnight',  bg: '#0b1020', ink: '#e6ecff' },
  { name: 'Forest',    bg: '#0f1a14', ink: '#e8f3ea' },
  { name: 'Oxblood',   bg: '#1a0d10', ink: '#f6e7e6' },
  { name: 'Sand',      bg: '#efe3cf', ink: '#3a2f21' },
  { name: 'Slate',     bg: '#171a1d', ink: '#e9eef2' },
  { name: 'Bubblegum', bg: '#2a0f1f', ink: '#ffe8f4' }
];

const hexToRgb = (hex) => {
  const h = String(hex || '').replace('#', '');
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return Number.isNaN(n) ? null : { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
};

/* Take a hex code the way a person would paste one: with or without the hash,
   three digits or six, any case, spaces around it. Returns #rrggbb, or null if
   it is not a colour at all. */
function normaliseHex(text) {
  const raw = String(text || '').trim().replace(/^#/, '');
  if (!/^[0-9a-f]{3}$|^[0-9a-f]{6}$/i.test(raw)) return null;
  const full = raw.length === 3 ? [...raw].map((c) => c + c).join('') : raw;
  return '#' + full.toLowerCase();
}

const rgbToHex = ({ r, g, b }) =>
  '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

/* t = 0 keeps a, t = 1 becomes b */
function mixHex(a, b, t) {
  const x = hexToRgb(a), y = hexToRgb(b);
  if (!x || !y) return a;
  return rgbToHex({ r: x.r + (y.r - x.r) * t, g: x.g + (y.g - x.g) * t, b: x.b + (y.b - x.b) * t });
}

const DEFAULT_SHADOW = '#000000';
const SHADOW_DEFAULTS = { y: 10, blur: 26 };   // how far it drops, how soft it is

/* Background and text belong to the year, not to each month: a journal reads as
   a run of months, and changing the paper twelve times a year is not what you
   want. Shadow is left alone — that stays per month, with its own switch for
   applying everywhere. */
// note: yearOf() above is about a film's release year — different thing entirely
function yearKey(monthKey) { return String(monthKey || ui.cursor).slice(0, 4); }

function colourYear(key) {
  state.yearColours = state.yearColours || {};
  const y = yearKey(key);
  state.yearColours[y] = state.yearColours[y] || {};
  return state.yearColours[y];
}

function applyMonthColours(m) {
  const root = document.documentElement.style;
  const fallback = DEFAULT_COLOURS[ui.theme === 'light' ? 'light' : 'dark'];
  const year = colourYear(ui.cursor);
  const bg = year.bg || null;
  const ink = year.ink || null;

  /* Tile shadow is its own switch, so it works whether or not the month has
     custom colours. The chosen colour is laid on at partial strength — a fully
     opaque shadow reads as a border, not a shadow. */
  /* When the shadow is set to apply everywhere it is read from one place on the
     journal instead of from the month, so every month — including ones that do
     not exist yet — picks it up without copying anything around. */
  const shadowFrom = state.shadowAll ? (state.shadowGlobal || {}) : m;

  if (shadowFrom.shadow) {
    const c = hexToRgb(shadowFrom.shadowColour || DEFAULT_SHADOW) || { r: 0, g: 0, b: 0 };
    const drop = Number.isFinite(shadowFrom.shadowY) ? shadowFrom.shadowY : SHADOW_DEFAULTS.y;
    const blur = Number.isFinite(shadowFrom.shadowBlur) ? shadowFrom.shadowBlur : SHADOW_DEFAULTS.blur;
    root.setProperty('--tile-shadow', `0 ${drop}px ${blur}px rgba(${c.r}, ${c.g}, ${c.b}, .5)`);
  } else {
    root.removeProperty('--tile-shadow');
  }

  if (!bg && !ink) {
    for (const key of ['--bg', '--bg-2', '--panel', '--line', '--ink', '--ink-2', '--ink-3']) {
      root.removeProperty(key);
    }
    return;
  }

  const base = bg || fallback.bg;
  const text = ink || fallback.ink;

  root.setProperty('--bg', base);
  root.setProperty('--bg-2', mixHex(base, text, 0.06));
  root.setProperty('--panel', mixHex(base, text, 0.10));
  root.setProperty('--line', mixHex(base, text, 0.20));
  root.setProperty('--ink', text);
  root.setProperty('--ink-2', mixHex(text, base, 0.35));
  root.setProperty('--ink-3', mixHex(text, base, 0.58));
}

/* Pairs you have mixed yourself, kept so you can reach for them again. Stored
   on the journal, capped, newest first, and never duplicating something the
   list already offers. */
const MAX_CUSTOM_COLOURS = 14;
const samePair = (a, b) =>
  (a.bg || '').toLowerCase() === (b.bg || '').toLowerCase() &&
  (a.ink || '').toLowerCase() === (b.ink || '').toLowerCase();

function rememberColour(pair) {
  if (!pair.bg && !pair.ink) return;
  state.customColours = state.customColours || [];
  const known = COLOUR_PRESETS.some((p) => samePair(p, pair)) ||
                state.customColours.some((p) => samePair(p, pair));
  if (known) return;
  state.customColours.unshift({ bg: pair.bg || null, ink: pair.ink || null });
  state.customColours.length = Math.min(state.customColours.length, MAX_CUSTOM_COLOURS);
  save();
}

/* The chips on offer: the built-in pairs you have not thrown away, then the
   ones you mixed yourself. Customs are labelled by their background hex, since
   they have no name. */
function swatchList() {
  const hidden = new Set(state.hiddenPresets || []);
  const builtin = COLOUR_PRESETS
    .filter((p) => !hidden.has(p.name))
    .map((p) => ({ p, custom: false }));
  const mine = (state.customColours || []).map((c) => ({
    p: { name: c.bg || c.ink || 'custom', bg: c.bg || null, ink: c.ink || null },
    custom: true
  }));
  return [...builtin, ...mine];
}

/* Adding a picture by link. Nothing is downloaded or stored: the block simply
   points at the address, so it costs no space and needs no uploading to appear
   on your other devices. The flip side is that if that page ever takes the
   image down, the tile goes with it — a file you choose from this computer is
   yours for good. */
function addImageByLink(raw) {
  const text = String(raw || '').trim();
  if (!text) return false;

  let url;
  try { url = new URL(text); } catch { toast('That is not a web address', true); return false; }
  if (!/^https?:$/.test(url.protocol)) {
    toast('Only http and https links can be shown', true);
    return false;
  }

  const last = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() || '');
  const title = last.replace(/\.[^.]+$/, '') || url.hostname.replace(/^www\./, '');
  const isVideo = /\.(mp4|webm|mov|m4v)$/i.test(last);

  addBlocks([{
    id: uid(),
    kind: 'photo',
    src: url.href,
    mime: isVideo ? 'video/mp4' : 'image/*',
    title,
    subtitle: url.hostname.replace(/^www\./, ''),
    note: '',
    day: null,
    size: 'sm',
    rating: null
  }]);

  toast(`Added from ${url.hostname.replace(/^www\./, '')}`);
  return true;
}

function openMediaPicker() {
  const pop = $('#mediaPop');

  const link = el('input', {
    type: 'url', class: 'linkfield', placeholder: 'https://…/photo.jpg',
    spellcheck: 'false', 'aria-label': 'Image address'
  });

  const submit = () => {
    if (addImageByLink(link.value)) { link.value = ''; closePops(); }
  };
  link.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });

  pop.replaceChildren(
    el('div', { class: 'pop-head' },
      el('span', {}, 'Add media'),
      el('button', { class: 'icon', title: 'Close', onclick: closePops }, '✕')),

    el('button', {
      class: 'pull',
      onclick: () => {
        closePops();
        delete $('#filePicker').dataset.day;
        $('#filePicker').click();
      }
    }, 'Choose from this computer'),

    el('div', { class: 'hint' }, 'Photos and short videos. Large pictures are resized so they can sync.'),

    el('div', { class: 'f' },
      el('label', {}, 'Or paste a link to a picture'),
      el('div', { class: 'row' }, link, el('button', { class: 'btn', onclick: submit }, 'Add'))),

    el('div', { class: 'hint' },
      'A linked picture is not stored here, so it shows up on your other devices straight away — but it disappears if the page hosting it takes it down.')
  );

  placePop(pop, $('#addPhotos'));
  $('#scrim').hidden = false;
  setTimeout(() => link.focus(), 30);
}

function openColourPicker() {
  const pop = $('#colourPop');
  const m = month();
  const palette = colourYear(ui.cursor);      // background and text belong to the year
  const fallback = DEFAULT_COLOURS[ui.theme === 'light' ? 'light' : 'dark'];

  const set = (patch) => {
    Object.assign(m, patch);
    save();
    render();
    openColourPicker();          // redraw so the swatches show what is selected
  };

  /* Shadow settings are written to the journal when "every month" is ticked,
     and to this month otherwise. Everything else always belongs to the month. */
  const shadowTarget = () => {
    if (!state.shadowAll) return m;
    state.shadowGlobal = state.shadowGlobal || {};
    return state.shadowGlobal;
  };

  /* Apply without rebuilding the popover, so typing in the hex box does not
     lose the caret mid-word. */
  const apply = (key, value, target) => {
    (target || m)[key] = value;
    save();
    render();
  };

  const field = (label, key, fallbackValue, target) => {
    const source = target || m;
    const current = source[key] || fallback[key] || fallbackValue;
    const swatch = el('input', { type: 'color', value: current });
    const hex = el('input', {
      type: 'text', class: 'hex', value: current, spellcheck: 'false',
      maxlength: '7', 'aria-label': label + ' hex code'
    });

    swatch.addEventListener('input', () => {
      hex.value = swatch.value;
      hex.classList.remove('bad');
      apply(key, swatch.value, source);
    });
    swatch.addEventListener('change', () => {
      if (source !== palette || (key !== 'bg' && key !== 'ink')) return;
      rememberColour({ bg: palette.bg, ink: palette.ink });
      openColourPicker();
    });

    // accept what people actually paste: abc, #abc, AABBCC, with stray spaces
    hex.addEventListener('input', () => {
      const parsed = normaliseHex(hex.value);
      hex.classList.toggle('bad', !parsed);
      if (parsed) { swatch.value = parsed; apply(key, parsed, source); }
    });

    const tidy = () => {
      const parsed = normaliseHex(hex.value);
      hex.value = parsed || (source[key] || fallback[key] || fallbackValue);   // put back what is real
      hex.classList.remove('bad');
      // only the background/text pair is worth keeping as a swatch
      if (parsed && source === palette && (key === 'bg' || key === 'ink')) {
        rememberColour({ bg: palette.bg, ink: palette.ink });
        openColourPicker();          // show the new swatch straight away
      }
    };
    hex.addEventListener('blur', tidy);
    hex.addEventListener('keydown', (e) => { if (e.key === 'Enter') { tidy(); hex.blur(); } });
    hex.addEventListener('focus', () => hex.select());   // one click to copy it

    return el('label', { class: 'colour-row' },
      el('span', {}, label),
      el('span', { class: 'colour-inputs' }, hex, swatch));
  };

  /* Dragging a slider redraws nothing but the tiles, so the handle stays under
     your finger while the shadow changes behind it. */
  const slider = (label, key, fallbackValue, min, max, target) => {
    const source = target || m;
    const current = Number.isFinite(source[key]) ? source[key] : fallbackValue;
    const input = el('input', {
      type: 'range', min: String(min), max: String(max), value: String(current),
      'aria-label': label
    });
    const readout = el('span', { class: 'slider-value' }, current + 'px');

    input.addEventListener('input', () => {
      readout.textContent = input.value + 'px';
      apply(key, Number(input.value), source);
    });

    return el('label', { class: 'colour-row' },
      el('span', {}, label),
      el('span', { class: 'colour-inputs' }, input, readout));
  };

  const everyMonth = el('input', { type: 'checkbox' });
  everyMonth.checked = !!state.shadowAll;
  everyMonth.addEventListener('change', () => {
    if (everyMonth.checked) {
      /* Seed the shared setting from whatever is on screen right now, so ticking
         the box keeps the look you were just looking at rather than resetting
         it. Each month's own shadow settings are left untouched underneath, and
         come back if you untick. */
      const from = state.shadowGlobal || {};
      state.shadowGlobal = {
        shadow: m.shadow !== undefined ? !!m.shadow : !!from.shadow,
        shadowColour: m.shadowColour || from.shadowColour || DEFAULT_SHADOW,
        shadowY: Number.isFinite(m.shadowY) ? m.shadowY
          : Number.isFinite(from.shadowY) ? from.shadowY : SHADOW_DEFAULTS.y,
        shadowBlur: Number.isFinite(m.shadowBlur) ? m.shadowBlur
          : Number.isFinite(from.shadowBlur) ? from.shadowBlur : SHADOW_DEFAULTS.blur
      };
    }
    state.shadowAll = everyMonth.checked;
    set({});
  });

  const shadowToggle = el('input', { type: 'checkbox' });
  shadowToggle.checked = !!shadowTarget().shadow;
  // redraw here on purpose: switching it on reveals the rows below
  shadowToggle.addEventListener('change', () => {
    shadowTarget().shadow = shadowToggle.checked;
    set({});
  });

  pop.replaceChildren(
    el('div', { class: 'pop-head' },
      el('span', {}, `Colours for ${yearKey(ui.cursor)}`),
      el('button', { class: 'icon', title: 'Close', onclick: closePops }, '✕')),
    field('Background', 'bg', null, palette),
    field('Text', 'ink', null, palette),
    el('label', { class: 'colour-row' },
      el('span', {}, 'Drop shadow'),
      el('span', { class: 'colour-inputs' }, shadowToggle)),
    shadowTarget().shadow ? field('Shadow colour', 'shadowColour', DEFAULT_SHADOW, shadowTarget()) : null,
    shadowTarget().shadow ? slider('Distance', 'shadowY', SHADOW_DEFAULTS.y, 0, 40, shadowTarget()) : null,
    shadowTarget().shadow ? slider('Blur', 'shadowBlur', SHADOW_DEFAULTS.blur, 0, 80, shadowTarget()) : null,
    el('label', { class: 'colour-row' },
      el('span', {}, 'Use on every month'),
      el('span', { class: 'colour-inputs' }, everyMonth)),
    el('div', { class: 'colour-presets' }, ...swatchList().map(({ p, custom }) => {
      const chosen = (palette.bg || null) === p.bg && (palette.ink || null) === p.ink;
      const chip = el('button', {
        class: 'colour-chip' + (chosen ? ' is-on' : ''),
        title: p.name,
        style: p.bg
          ? `background:${p.bg};color:${p.ink}`
          : 'background:var(--bg-2);color:var(--ink-2)',
        onclick: () => { palette.bg = p.bg; palette.ink = p.ink; set({}); }
      }, p.name);

      // Default is the reset, not a colour, so it stays put
      if (p.name === 'Default') return el('span', { class: 'chip-wrap' }, chip);

      const remove = el('button', {
        class: 'chip-x',
        title: `Remove ${p.name}`,
        onclick: (e) => {
          e.stopPropagation();                 // removing is not choosing
          if (custom) {
            state.customColours = (state.customColours || []).filter((c) => !samePair(c, p));
          } else {
            state.hiddenPresets = [...(state.hiddenPresets || []), p.name];
          }
          set({});
        }
      }, '✕');

      return el('span', { class: 'chip-wrap' }, chip, remove);
    })),
    el('div', { class: 'hint' },
      `Background and text apply to every month of ${yearKey(ui.cursor)}. Panels, borders and the quieter greys are mixed from those two, so the year stays readable. The shadow settings above belong to this month unless you tick every month.`)
  );

  placePop(pop, $('#openMenu'));
  $('#scrim').hidden = false;
}

/* ---------------- render ---------------- */

function renderView() {
  const grid = $('#gridView'), cal = $('#calendarView');
  const isGrid = ui.view === 'grid';
  grid.hidden = !isGrid;
  cal.hidden = isGrid;
  $$('#viewSeg .seg-btn').forEach((b) => b.classList.toggle('is-on', b.dataset.view === ui.view));
  isGrid ? renderGrid() : renderCalendar();
}

function render() {
  const { year, month: mo } = cursorParts();
  const m = month();

  document.documentElement.dataset.theme = ui.theme;
  applyMonthColours(m);

  if (allMode()) {
    /* The header says what you are looking at: everything, and the span it
       covers. The song belongs to a month, so it steps aside here. */
    const { first, last } = journalSpan();
    $('#monthName').textContent = 'Everything';
    $('#monthYear').textContent = !first ? '' : first === last ? first : `${first}–${last}`;
  } else {
    $('#monthName').textContent = MONTHS[mo - 1];
    $('#monthYear').textContent = year;
  }
  $('#player').hidden = allMode();
  // the button says when it is doing something, so a hidden tag is never a mystery
  const off = (ui.hiddenTags || []).length;
  $('#openTags').textContent = off ? `Tags · ${off} off` : 'Tags';
  $('#openTags').classList.toggle('is-on', !!off);
  $('#sortSel').value = ui.sort || 'manual';
  $('#resetOrder').hidden = allMode() || (ui.sort || 'manual') !== 'manual';
  paintAutoplay();
  loadSong();
  renderView();
  if (!$('#syncDrawer').hidden) renderSync();
}

/* ---------------- menus & popovers ---------------- */

/* Close every popover there is, rather than a hand-written list — a list is how
   the colour picker ended up unclosable by Escape, by the scrim, or by its own
   close button. */
function closePops() {
  $$('.pop').forEach((n) => { n.hidden = true; });
  $('#scrim').hidden = true;
  $('#syncDrawer').hidden = true;
}

function placePop(pop, anchor) {
  pop.hidden = false;
  const r = anchor.getBoundingClientRect();
  const w = pop.offsetWidth;
  pop.style.top = (r.bottom + 8) + 'px';
  pop.style.left = Math.max(12, Math.min(window.innerWidth - w - 12, r.left)) + 'px';
}

$('#monthLabel').addEventListener('click', () => {
  const open = $('#monthPop').hidden;
  closePops();
  if (open) { popYear = cursorParts().year; renderMonthPop(); placePop($('#monthPop'), $('#monthLabel')); $('#scrim').hidden = false; }
});
$('#popPrevYear').addEventListener('click', (e) => { e.stopPropagation(); popYear--; renderMonthPop(); });
$('#popNextYear').addEventListener('click', (e) => { e.stopPropagation(); popYear++; renderMonthPop(); });

$('#openTags').addEventListener('click', () => {
  const open = $('#tagPop').hidden;
  closePops();
  if (open) openTagFilter();
});

$('#prevMonth').addEventListener('click', () => shiftMonth(-1));
$('#nextMonth').addEventListener('click', () => shiftMonth(1));

$('#viewSeg').addEventListener('click', (e) => {
  const b = e.target.closest('.seg-btn');
  if (!b) return;
  ui.view = b.dataset.view;
  // a calendar is a month's worth of days, so asking for one leaves the all view
  if (ui.view === 'calendar' && allMode()) { ui.all = false; save(); render(); return; }
  save();
  renderView();
});

$('#sortSel').addEventListener('change', (e) => { ui.sort = e.target.value; save(); render(); });

/* Throw away the hand-placed coordinates for this month and let the board pack
   itself again. Sizes are left alone — that is a separate decision from where a
   tile sits, and losing them to a layout reset would be a nasty surprise. */
$('#resetOrder').addEventListener('click', () => {
  const m = month();
  const placed = m.blocks.filter((b) => Number.isInteger(b.gx) || Number.isInteger(b.gy));
  if (!placed.length) { toast('Nothing has been moved in this month yet'); return; }

  const { year, month: mo } = cursorParts();
  if (!confirm(`Reset the layout for ${MONTHS[mo - 1]} ${year}?

` +
      `${placed.length} tile${placed.length === 1 ? '' : 's'} will be packed back in order. ` +
      'Any sizes you set by hand are kept.')) return;

  for (const b of m.blocks) { delete b.gx; delete b.gy; }
  lastTouched = null;
  save();
  render();
  toast(`Layout reset — ${placed.length} tile${placed.length === 1 ? '' : 's'} repacked`);
});

$('#addPhotos').addEventListener('click', () => {
  const wasOpen = !$('#mediaPop').hidden;
  closePops();
  if (!wasOpen) openMediaPicker();
});

$('#addWidget').addEventListener('click', () => {
  const pop = $('#widgetPop');
  const open = pop.hidden;
  closePops();
  if (!open) return;
  pop.replaceChildren(...WIDGETS.map((w) =>
    el('button', { onclick: () => { addWidget(w.kind); closePops(); } }, w.label)));
  placePop(pop, $('#addWidget'));
  $('#scrim').hidden = false;
});

$('#openSync').addEventListener('click', () => {
  const open = $('#syncDrawer').hidden;
  closePops();
  if (open) { renderSync(); $('#syncDrawer').hidden = false; $('#scrim').hidden = false; }
});

$('#openMenu').addEventListener('click', () => {
  const open = $('#menuPop').hidden;
  closePops();
  if (open) { placePop($('#menuPop'), $('#openMenu')); $('#scrim').hidden = false; }
});

$('#scrim').addEventListener('click', () => { closePops(); closeInspector(); });
$$('[data-close]').forEach((b) => b.addEventListener('click', closePops));

$('#menuPop').addEventListener('click', async (e) => {
  const act = e.target.dataset.act;
  if (!act) return;
  closePops();
  if (act === 'theme') { ui.theme = ui.theme === 'dark' ? 'light' : 'dark'; save(); render(); }
  if (act === 'export') exportJournal();
  if (act === 'import') $('#jsonPicker').click();
  if (act === 'posters') fillArtwork({ loud: true });
  if (act === 'files') syncFiles({ loud: true });
  if (act === 'sync') syncNow({ loud: true });
  if (act === 'colours') openColourPicker();
  if (act === 'dedupe') {
    const { removed, donated, keptNewer } = purgeFeedEntries('letterboxd');
    const merged = mergeDuplicates();
    const n = removed + merged;
    toast(n
      ? `Cleaned ${n}: export kept${donated ? `, ${donated} poster${donated === 1 ? '' : 's'} salvaged` : ''}${keptNewer ? `, ${keptNewer} newer watch${keptNewer === 1 ? '' : 'es'} left` : ''}`
      : 'Nothing to clean');
  }
  if (act === 'sample') loadSample();
  if (act === 'clear') {
    // in the everything view there is no "this month" to erase, and guessing
    // would mean wiping a month you are not looking at
    if (allMode()) { toast('Open the month you want to erase first', true); return; }
    if (!confirm(`Erase everything in ${MONTHS[cursorParts().month - 1]} ${cursorParts().year}?`)) return;
    const m = month();
    for (const b of m.blocks) if (b.blobId) DB.delBlob(b.blobId);
    if (m.song) DB.delBlob(m.song.blobId);
    state.months[ui.cursor] = blankMonth();
    state.months[ui.cursor].erasedAt = Date.now();   // deliberate, so do not restore it
    save();
    render();
    toast('Month erased');
  }
});


/* ---------------- file inputs & drops ---------------- */

$('#filePicker').addEventListener('change', (e) => {
  const day = e.target.dataset.day ? +e.target.dataset.day : null;
  if (e.target.files.length) addFiles(e.target.files, day);
  e.target.value = '';
});
$('#songPicker').addEventListener('change', (e) => {
  if (e.target.files[0]) setSong(e.target.files[0]);
  e.target.value = '';
});
$('#jsonPicker').addEventListener('change', (e) => {
  if (e.target.files[0]) importJournal(e.target.files[0]);
  e.target.value = '';
});

let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  if (![...e.dataTransfer.types].includes('Files')) return;
  dragDepth++;
  document.body.classList.add('dropping');
});
window.addEventListener('dragleave', () => {
  if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dropping'); }
});
window.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
window.addEventListener('drop', (e) => {
  dragDepth = 0;
  document.body.classList.remove('dropping');
  if (!e.dataTransfer.files?.length) return;
  e.preventDefault();
  const files = [...e.dataTransfer.files];

  const audioFile = files.find((f) => /^audio\//.test(f.type));
  if (audioFile) { setSong(audioFile); return; }

  // a Letterboxd export dropped anywhere backfills the whole journal
  const exportFile = files.find((f) => /\.(csv|zip)$/i.test(f.name));
  if (exportFile) {
    importExport(exportFile).catch((err) => toast('Export import failed: ' + err.message, true));
    return;
  }

  addFiles(e.dataTransfer.files);
});

/* ---------------- keyboard ---------------- */

document.addEventListener('keydown', (e) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
  if (e.key === 'Escape') { closePops(); closeInspector(); return; }
  if (typing || e.metaKey || e.ctrlKey) return;
  if (e.key === 'ArrowLeft') shiftMonth(-1);
  if (e.key === 'ArrowRight') shiftMonth(1);
  if (e.key === 'g') { ui.view = 'grid'; save(); renderView(); }
  if (e.key === 'c') { ui.view = 'calendar'; save(); renderView(); }
  if (e.key === ' ' && month().song) { e.preventDefault(); audio.paused ? audio.play() : audio.pause(); }
});

/* ---------------- export / import ---------------- */

const toB64 = (blob) => new Promise((res) => {
  const r = new FileReader();
  r.onload = () => res(r.result);
  r.readAsDataURL(blob);
});

async function exportJournal() {
  toast('Packing journal…');
  const bundle = JSON.parse(JSON.stringify(state));
  bundle.blobs = {};
  const ids = new Set();
  for (const m of Object.values(bundle.months)) {
    for (const b of m.blocks) if (b.blobId) ids.add(b.blobId);
    if (m.song) ids.add(m.song.blobId);
  }
  for (const id of ids) {
    const blob = await DB.getBlob(id);
    if (blob) bundle.blobs[id] = { type: blob.type, data: await toB64(blob) };
  }
  const url = URL.createObjectURL(new Blob([JSON.stringify(bundle)], { type: 'application/json' }));
  const a = el('a', { href: url, download: `journal-jack-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

async function importJournal(file) {
  try {
    const bundle = JSON.parse(await file.text());
    if (!bundle.months) throw new Error('Not a journal.jack export');
    if (!confirm('Replace the current journal with this file?')) return;
    for (const [id, rec] of Object.entries(bundle.blobs || {})) {
      const blob = await (await fetch(rec.data)).blob();
      await DB.putBlob(id, blob);
    }
    delete bundle.blobs;
    state = bundle;
    urlCache.clear();
    currentSongKey = null;
    save();
    render();
    toast('Journal imported');
  } catch (err) {
    toast('Import failed: ' + err.message, true);
  }
}

/* ---------------- sample month ---------------- */

function svgTile(label, a, b) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${a}"/><stop offset="100%" stop-color="${b}"/>
    </linearGradient></defs>
    <rect width="600" height="600" fill="url(#g)"/>
    <text x="300" y="315" font-family="Georgia,serif" font-size="42" fill="rgba(255,255,255,.9)"
      text-anchor="middle">${label}</text></svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

function loadSample() {
  const m = month();
  const demo = [
    ['sample photo', '#3a3f58', '#8f6f9e', 8, 'md'],
    ['sample film', '#5b2f37', '#c4736f', 12, 'sm'],
    ['sample album', '#264034', '#88a97f', 3, 'sm'],
    ['sample photo', '#4a3a2a', '#e0a45e', 19, 'tall'],
    ['sample show', '#22303f', '#7f97c4', 24, 'sm'],
    ['sample photo', '#3d2c3a', '#ab8fc4', 27, 'wide']
  ];
  m.blocks.push(...demo.map(([t, a, b, day, size], i) => ({
    id: uid(), kind: 'media', size, src: svgTile(t, a, b),
    title: t, subtitle: 'demo data — not from a real service',
    source: 'sample', day, rating: i % 2 ? 4 : null, note: '', url: ''
  })));
  m.blocks.push({ id: uid(), kind: 'note', size: 'sm', text: 'Sample month. Everything here is placeholder data you can delete.' });
  m.blocks.push({ id: uid(), kind: 'stats', size: 'sm' });
  if (!m.title) m.title = 'a sample month';
  save();
  render();
  toast('Sample blocks added — clearly labelled as demo data');
}

/* ---------------- boot ---------------- */

(async function boot() {
  const { degraded } = await DB.init();
  const loaded = await DB.loadState();
  state = loaded || defaultState();
  loadUI(loaded);      // must run before ensureShape strips the old fields
  ensureShape();
  resetPrints(state);

  if (degraded) {
    const b = $('#banner');
    b.hidden = false;
    b.textContent = location.protocol === 'file:'
      ? 'Running from file:// — the browser blocks IndexedDB here, so uploads live only until you reload. Run "node server.js" and open http://localhost:5173 to save properly.'
      : 'Storage is restricted in this browser; uploaded files will not persist between reloads.';
  }

  render();

  // signed in? pull the account copy before anything else touches the document
  await Account.init();
  paintAccountButton();
  if (Account.user) await syncAfterSignIn();

  // then top up the current month from whatever services are configured
  setTimeout(() => autoRefresh(), 800);

  /* Anything imported before posters existed — or left behind when a lookup was
     throttled — gets picked up here, without waiting for a menu click. */
  setTimeout(() => fillArtwork(), 2500);
})();

})();
