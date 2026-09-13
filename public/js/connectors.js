/* connectors.js — the browser half of syncing.
   All network work happens in the Node server (services.js); this file just
   talks to it, plus handles the one import the browser can do alone: reading a
   Letterboxd data export straight off your disk. */

const Connectors = (() => {

  let manifest = null;

  async function services() {
    if (manifest) return manifest;
    const res = await fetch('/api/services');
    if (!res.ok) throw new Error('server not reachable');
    manifest = (await res.json()).services;
    return manifest;
  }

  async function pull(id, cfg, range) {
    const p = new URLSearchParams({ service: id });
    if (range.from) p.set('from', range.from);
    if (range.to) p.set('to', range.to);
    for (const [k, v] of Object.entries(cfg)) if (v && !k.startsWith('_')) p.set('cfg.' + k, v);
    const res = await fetch('/api/pull?' + p);
    const json = await res.json().catch(() => ({ error: 'bad response from server' }));
    if (!res.ok) throw new Error(json.error || 'HTTP ' + res.status);
    return json.items;
  }

  /* ---------------- CSV ---------------- */

  function parseCSV(text) {
    const rows = [];
    let row = [], field = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
        else field += c;
      } else if (c === '"') quoted = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c !== '\r') field += c;
    }
    if (field || row.length) { row.push(field); rows.push(row); }
    if (!rows.length) return [];
    const head = rows.shift().map((h) => h.trim().toLowerCase());
    return rows.filter((r) => r.length > 1).map((r) => {
      const o = {};
      head.forEach((h, i) => { o[h] = (r[i] || '').trim(); });
      return o;
    });
  }

  /* Letterboxd's export ships diary.csv / watched.csv / ratings.csv / reviews.csv.
     diary:   Date, Name, Year, Letterboxd URI, Rating, Rewatch, Tags, Watched Date
     reviews: ...the same, plus Review — which is why it gets merged in below. */
  function fromLetterboxdCSV(text) {
    return parseCSV(text).map((r) => {
      const date = r['watched date'] || r.date || '';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
      const name = r.name || r.title;
      if (!name) return null;
      const rating = r.rating ? parseFloat(r.rating) : null;
      return {
        source: 'letterboxd',
        title: name,
        subtitle: r.year || '',
        image: '',                       // the export carries no artwork
        url: r['letterboxd uri'] || '',
        date,
        rating: isNaN(rating) ? null : rating,
        review: (r.review || '').trim(),
        tags: (r.tags || '').trim()
      };
    }).filter(Boolean);
  }

  /* The diary and the reviews are separate files describing the same watches, so
     fold the review text onto the matching diary entry rather than importing the
     same film twice. */
  function mergeReviews(diary, reviewRows) {
    const norm = (t) => String(t || '').toLowerCase()
      .normalize('NFKD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, ' ').trim();

    /* The two files describe the same watches but do not always agree on the
       day — a review edited later carries a different Date. So try the exact
       watch first, then the same film that year, then the film at all. Only a
       genuinely unmatched review becomes its own entry. */
    const byDate = new Map();
    const byYear = new Map();
    const byTitle = new Map();
    for (const i of diary) {
      byDate.set(`${norm(i.title)}|${i.date}`, i);
      byYear.set(`${norm(i.title)}|${i.subtitle}`, i);
      if (!byTitle.has(norm(i.title))) byTitle.set(norm(i.title), i);
    }

    let attached = 0;
    for (const r of reviewRows) {
      if (!r.review) continue;
      const hit = byDate.get(`${norm(r.title)}|${r.date}`)
               || byYear.get(`${norm(r.title)}|${r.subtitle}`)
               || byTitle.get(norm(r.title));
      if (hit) {
        if (!hit.review) { hit.review = r.review; attached++; }
        if (hit.rating == null) hit.rating = r.rating;
      } else {
        diary.push(r);                 // reviewed something that never hit the diary
        byTitle.set(norm(r.title), r);
        attached++;
      }
    }
    return attached;
  }

  /* ---------------- ZIP (the export downloads as one) ----------------
     Reads the central directory, then inflates entries with the browser's own
     DecompressionStream. Stored and deflated entries only, which is all the
     export uses. */
  async function readZip(file) {
    const buf = new Uint8Array(await file.arrayBuffer());
    const view = new DataView(buf.buffer);
    const dec = new TextDecoder();

    let eocd = -1;
    for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) {
      if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Not a zip file');

    const count = view.getUint16(eocd + 10, true);
    let p = view.getUint32(eocd + 16, true);
    const out = {};

    for (let n = 0; n < count; n++) {
      if (view.getUint32(p, true) !== 0x02014b50) break;
      const method = view.getUint16(p + 10, true);
      const compSize = view.getUint32(p + 20, true);
      const nameLen = view.getUint16(p + 28, true);
      const extraLen = view.getUint16(p + 30, true);
      const commentLen = view.getUint16(p + 32, true);
      const localOff = view.getUint32(p + 42, true);
      const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen));
      p += 46 + nameLen + extraLen + commentLen;

      if (!/\.csv$/i.test(name)) continue;
      const lNameLen = view.getUint16(localOff + 26, true);
      const lExtraLen = view.getUint16(localOff + 28, true);
      const start = localOff + 30 + lNameLen + lExtraLen;
      const raw = buf.subarray(start, start + compSize);

      if (method === 0) out[name] = dec.decode(raw);
      else if (method === 8) {
        const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        out[name] = await new Response(stream).text();
      }
    }
    return out;
  }

  /* Accepts either the raw .zip export or a single .csv pulled out of it. */
  async function fromLetterboxdExport(file) {
    if (/\.zip$/i.test(file.name)) {
      const files = await readZip(file);
      const names = Object.keys(files);
      const pick = names.find((f) => /diary\.csv$/i.test(f))
                || names.find((f) => /watched\.csv$/i.test(f))
                || names.find((f) => /ratings\.csv$/i.test(f));
      if (!pick) throw new Error('No diary.csv inside that zip');

      const items = fromLetterboxdCSV(files[pick]);
      const reviewFile = names.find((f) => /reviews\.csv$/i.test(f));
      if (reviewFile) mergeReviews(items, fromLetterboxdCSV(files[reviewFile]));

      const reviewed = items.filter((i) => i.review).length;
      return { items, from: pick + (reviewFile ? ` + reviews.csv (${reviewed} reviews)` : '') };
    }
    return { items: fromLetterboxdCSV(await file.text()), from: file.name };
  }

  return { services, pull, fromLetterboxdExport, parseCSV };
})();
