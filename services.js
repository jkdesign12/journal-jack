/* services.js — server-side importers.
 *
 * These run in Node, not the browser, which buys two things: no CORS wall, and
 * the ability to page through a full history instead of whatever fits in a feed.
 *
 * Every importer returns a flat array of:
 *   { source, title, subtitle, image, url, date: 'YYYY-MM-DD' | null, rating: 0-5 | null }
 *
 * What each service actually allows (probed, not assumed):
 *
 *   musicboard  api.musicboard.app/v2 is an open read API. Look the username up,
 *               then page /ratings/?creator=<uid>. Full history, covers, scores,
 *               listened_at timestamps. No key.
 *   anilist     Public GraphQL. Refuses server-side calls that arrive without an
 *               Origin/Referer, so both are sent. Full history.
 *   lastfm      user.getRecentTracks with from/to. Full history, needs a free key.
 *   letterboxd  Profile HTML is behind a Cloudflare bot challenge — scraping it
 *               would mean defeating that, so this does not try. The public RSS
 *               feed is open and carries watched date, rating and poster, but
 *               Letterboxd caps it at roughly the last 50 entries. For older
 *               months, use their official data export (the CSV importer in the
 *               app reads the whole diary).
 *   rss         Anything else with a dated feed.
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/* range helpers — from/to are inclusive 'YYYY-MM' strings */
function rangeBounds(from, to) {
  const [fy, fm] = (from || '1970-01').split('-').map(Number);
  const [ty, tm] = (to || '2999-12').split('-').map(Number);
  return { start: new Date(fy, fm - 1, 1), end: new Date(ty, tm, 1) };
}
const inRange = (date, b) => date >= b.start && date < b.end;

/* a small polite fetch: retries once, backs off, always identifies as a browser
   because several of these hosts reject unknown agents outright */
async function get(url, opts = {}) {
  const headers = { 'User-Agent': UA, Accept: opts.json ? 'application/json' : '*/*', ...(opts.headers || {}) };
  let last;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { ...opts, headers });
      if (res.status === 429 || res.status >= 500) { last = new Error('HTTP ' + res.status); await sleep(1200); continue; }
      if (!res.ok) {
        const body = await res.text();
        // APIs often explain themselves in the error body — say what they said
        let msg = '';
        try {
          const j = JSON.parse(body);
          msg = j.errors?.[0]?.message || j.message || j.detail || '';
        } catch { /* not json */ }
        const cf = /Just a moment|cf-browser-verification|challenge-platform/i.test(body);
        throw new Error(msg
          ? msg
          : cf
            ? 'blocked by the site’s bot protection (HTTP ' + res.status + ')'
            : 'HTTP ' + res.status);
      }
      return opts.json ? res.json() : res.text();
    } catch (e) { last = e; if (attempt) throw e; await sleep(600); }
  }
  throw last;
}

/* ---------------- feed parsing (regex; no DOM on the server) ---------------- */

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”' };

function htmlToText(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (m, e) => {
      if (ENTITIES[e.toLowerCase()]) return ENTITIES[e.toLowerCase()];
      if (e[0] === '#') return String.fromCodePoint(parseInt(e.slice(1).replace(/^x/i, ''), e[1] === 'x' || e[1] === 'X' ? 16 : 10));
      return m;
    })
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const tag = (xml, name) => {
  const m = xml.match(new RegExp('<' + name + '[^>]*>([\\s\\S]*?)</' + name + '>', 'i'));
  return m ? m[1].replace(/^<!\[CDATA\[|\]\]>$/g, '').trim() : '';
};

function parseFeed(xml, source, opts = {}) {
  const chunks = xml.split(/<(?:item|entry)[\s>]/i).slice(1);
  const out = [];

  for (const raw of chunks) {
    const chunk = raw.split(/<\/(?:item|entry)>/i)[0];
    const watchedDate = tag(chunk, 'letterboxd:watchedDate');
    /* A Letterboxd feed mixes diary entries with lists ("Ranked: 28 Films Later",
       watchlists). Only diary entries carry a watched date, and only those are
       things you actually did on a day. */
    if (opts.diaryOnly && !watchedDate) continue;
    const watched = watchedDate || tag(chunk, 'pubDate') ||
                    tag(chunk, 'published') || tag(chunk, 'updated');
    const when = new Date(watched);
    if (isNaN(when)) continue;

    const desc = tag(chunk, 'description') || tag(chunk, 'content:encoded') || tag(chunk, 'content');
    const img = desc.match(/<img[^>]+src=["']([^"']+)["']/i);
    const filmTitle = tag(chunk, 'letterboxd:filmTitle');
    const year = tag(chunk, 'letterboxd:filmYear');
    const rating = tag(chunk, 'letterboxd:memberRating');

    // feeds arrive HTML-escaped: "Butcher&#039;s Stain" should read as an apostrophe
    let title = htmlToText(filmTitle || tag(chunk, 'title') || '(untitled)');
    const starIdx = title.indexOf(' - ★');
    if (!filmTitle && starIdx > -1) title = title.slice(0, starIdx);

    let link = tag(chunk, 'link');
    if (!link) { const m = chunk.match(/<link[^>]+href=["']([^"']+)["']/i); link = m ? m[1] : ''; }

    // the description is the poster followed by whatever you wrote about it
    const review = htmlToText(desc.replace(/<p>\s*<img[\s\S]*?<\/p>/i, ''))
      .replace(/^Watched on .*$/gm, '')
      .trim();

    out.push({
      source,
      title,
      subtitle: year || when.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      image: img ? img[1] : '',
      url: link,
      date: ymd(when),
      rating: rating ? parseFloat(rating) : null,
      review
    });
  }
  return out;
}

/* ---------------- the services ---------------- */

const services = {

  letterboxd: {
    name: 'Letterboxd',
    access: 'partial',
    tag: 'films',
    history: 'last ~50 entries only',
    note: 'Letterboxd has no public API, and their profile pages are behind bot protection this app will not try to defeat. The public RSS feed is open and carries watched date, your star rating and the poster — but only the most recent ~50 entries. For your whole history, export your data from letterboxd.com/settings/data and drop diary.csv (or the export .zip) on the drop area below.',
    fields: [{ key: 'user', label: 'Username', placeholder: 'yourname' }],
    async pull(cfg, { from, to }) {
      if (!cfg.user) throw new Error('Username required');
      const xml = await get(`https://letterboxd.com/${encodeURIComponent(cfg.user)}/rss/`);
      const b = rangeBounds(from, to);
      return parseFeed(xml, 'letterboxd', { diaryOnly: true }).filter((i) => inRange(new Date(i.date), b));
    }
  },

  musicboard: {
    name: 'Musicboard',
    access: 'full',
    tag: 'music',
    history: 'complete',
    note: 'Open read API, no key needed. Pulls every album you rated, with cover art, your score and the date you listened.',
    fields: [{ key: 'user', label: 'Username', placeholder: 'yourname' }],
    async pull(cfg, { from, to }) {
      if (!cfg.user) throw new Error('Username required');
      const found = await get(
        `https://api.musicboard.app/v2/users/?search=${encodeURIComponent(cfg.user)}&limit=5`, { json: true });
      const me = (found.results || []).find(
        (u) => u.username.toLowerCase() === cfg.user.toLowerCase()) || found.results?.[0];
      if (!me) throw new Error(`No Musicboard user called "${cfg.user}"`);

      const b = rangeBounds(from, to);
      const out = [];
      const LIMIT = 50;

      /* Review text lives on a separate endpoint; a rating points at its review
         by uid. Pull the reviews once up front and look them up as we go. */
      const reviews = new Map();
      try {
        for (let offset = 0; offset < 1000; offset += LIMIT) {
          const page = await get(
            `https://api.musicboard.app/v2/reviews/?creator=${me.uid}&limit=${LIMIT}&offset=${offset}`, { json: true });
          const rows = page.results || [];
          if (!rows.length) break;
          let allOlder = true;
          for (const r of rows) {
            const when = new Date(r.created_at);
            if (when >= b.start) allOlder = false;
            const text = (r.description || '').trim();
            if (text) reviews.set(r.uid, text);
          }
          if (allOlder || !page.next) break;
          await sleep(200);
        }
      } catch { /* reviews are a bonus; ratings still import without them */ }

      // ratings come back newest first, so we can stop once we fall past the window
      for (let offset = 0; offset < 4000; offset += LIMIT) {
        const page = await get(
          `https://api.musicboard.app/v2/ratings/?creator=${me.uid}&limit=${LIMIT}&offset=${offset}`, { json: true });
        const rows = page.results || [];
        if (!rows.length) break;

        let allOlder = true;
        for (const r of rows) {
          const when = new Date(r.listened_at || r.created_at);
          if (isNaN(when)) continue;
          if (when >= b.start) allOlder = false;
          if (!inRange(when, b)) continue;
          const c = r.content || {};
          out.push({
            source: 'musicboard',
            title: c.title || '(untitled)',
            subtitle: c.artist?.name || '',
            image: isRealCover(c.cover) ? c.cover : '',   // blank ones get filled in later
            url: r.review_url_slug ? 'https://musicboard.app' + r.review_url_slug : '',
            date: ymd(when),
            rating: r.rating != null ? r.rating / 2 : null,  // musicboard scores out of 10
            review: reviews.get(r.review_uid) || ''
          });
        }
        if (allOlder) break;          // everything on this page predates the window
        if (!page.next) break;
        await sleep(200);             // be a good guest
      }
      return out;
    }
  },

  anilist: {
    name: 'AniList',
    access: 'full',
    tag: 'anime / manga',
    history: 'complete',
    note: 'Public GraphQL API, no key. Pulls everything marked completed, with cover art, your score and the completion date. Entries you finished without a date recorded are skipped — AniList only stores one if you set it.',
    fields: [
      { key: 'user', label: 'Username', placeholder: 'yourname' },
      { key: 'type', label: 'List', type: 'select', options: ['ANIME', 'MANGA', 'BOTH'], optional: true }
    ],
    async pull(cfg, { from, to }) {
      if (!cfg.user) throw new Error('Username required');
      const b = rangeBounds(from, to);
      const types = cfg.type === 'BOTH' ? ['ANIME', 'MANGA'] : [cfg.type || 'ANIME'];
      const query = `
        query ($name: String, $type: MediaType) {
          MediaListCollection(userName: $name, type: $type, status: COMPLETED) {
            lists { entries {
              score(format: POINT_10)
              notes
              completedAt { year month day }
              media { siteUrl format title { romaji english } coverImage { large } }
            } }
          }
        }`;
      const out = [];
      for (const type of types) {
        let json;
        try {
          json = await get('https://graphql.anilist.co', {
            method: 'POST',
            json: true,
            headers: {
              'Content-Type': 'application/json',
              // AniList refuses server-side calls that arrive with no browser context
              Origin: 'https://anilist.co',
              Referer: 'https://anilist.co/'
            },
            body: JSON.stringify({ query, variables: { name: cfg.user, type } })
          });
        } catch (e) {
          if (/private user/i.test(e.message)) {
            throw new Error(`"${cfg.user}" has a private list (or the username is wrong) — AniList only serves public lists`);
          }
          if (/not found/i.test(e.message)) throw new Error(`No AniList user called "${cfg.user}"`);
          throw e;
        }
        if (json.errors) throw new Error(json.errors[0].message);
        for (const list of json.data?.MediaListCollection?.lists || []) {
          for (const e of list.entries) {
            const c = e.completedAt || {};
            if (!c.year || !c.month) continue;
            const when = new Date(c.year, c.month - 1, c.day || 1);
            if (!inRange(when, b)) continue;
            out.push({
              source: 'anilist',
              title: e.media.title.english || e.media.title.romaji,
              subtitle: e.media.format || type.toLowerCase(),
              image: e.media.coverImage?.large || '',
              url: e.media.siteUrl,
              date: ymd(when),
              rating: e.score ? e.score / 2 : null,
              review: (e.notes || '').trim()
            });
          }
        }
        await sleep(250);
      }
      return out;
    }
  },

  lastfm: {
    name: 'Last.fm',
    access: 'full',
    tag: 'music',
    history: 'complete',
    note: 'Public API, free key from last.fm/api/account/create. Scrobbles are grouped into albums per month, most-played first, so a month reads as the records you actually lived on.',
    fields: [
      { key: 'user', label: 'Username', placeholder: 'yourname' },
      { key: 'key', label: 'API key', placeholder: '32-character key', secret: true },
      { key: 'perMonth', label: 'Albums per month', placeholder: '12', optional: true }
    ],
    async pull(cfg, { from, to }) {
      if (!cfg.user || !cfg.key) throw new Error('Username and API key required');
      const b = rangeBounds(from, to);
      const fromTs = Math.floor(b.start / 1000);
      const toTs = Math.floor(b.end / 1000);
      const perMonth = parseInt(cfg.perMonth || '12', 10) || 12;

      const byMonth = new Map();     // 'YYYY-MM' -> Map(albumKey -> row)
      let page = 1, pages = 1;
      const MAX_PAGES = 60;          // 200 tracks each: 12k scrobbles per pull

      while (page <= pages && page <= MAX_PAGES) {
        const url = `https://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks` +
          `&user=${encodeURIComponent(cfg.user)}&api_key=${encodeURIComponent(cfg.key)}` +
          `&format=json&limit=200&from=${fromTs}&to=${toTs}&page=${page}`;
        const json = await get(url, { json: true });
        if (json.error) throw new Error(json.message || 'Last.fm error ' + json.error);
        const rt = json.recenttracks || {};
        pages = parseInt(rt['@attr']?.totalPages || '1', 10);

        for (const t of [].concat(rt.track || [])) {
          if (t['@attr']?.nowplaying || !t.date?.uts) continue;
          const when = new Date(parseInt(t.date.uts, 10) * 1000);
          const mk = `${when.getFullYear()}-${pad(when.getMonth() + 1)}`;
          if (!byMonth.has(mk)) byMonth.set(mk, new Map());
          const bucket = byMonth.get(mk);
          const artist = t.artist?.['#text'] || '';
          const album = t.album?.['#text'] || t.name;
          const key = artist + '|' + album;
          const row = bucket.get(key) || {
            source: 'lastfm', title: album, subtitle: artist,
            image: (() => { const i = (t.image || []).slice(-1)[0]?.['#text'] || ''; return isRealCover(i) ? i : ''; })(),
            url: t.url || '', date: ymd(when), rating: null, plays: 0
          };
          row.plays++;
          if (when < new Date(row.date)) row.date = ymd(when);
          bucket.set(key, row);
        }
        page++;
        if (page <= pages) await sleep(250);
      }

      const out = [];
      for (const bucket of byMonth.values()) {
        [...bucket.values()]
          .sort((a, b2) => b2.plays - a.plays)
          .slice(0, perMonth)
          .forEach((r) => out.push({ ...r, subtitle: `${r.subtitle} · ${r.plays} plays` }));
      }
      return out;
    }
  },

  rss: {
    name: 'Any RSS feed',
    access: 'full',
    tag: 'anything else',
    history: 'whatever the feed holds',
    note: 'Backloggd, Serializd, Goodreads shelves, a YouTube channel, a blog. Entries dated inside the range get pulled in. Most feeds only carry recent items.',
    fields: [{ key: 'url', label: 'Feed URL', placeholder: 'https://example.com/feed.xml' }],
    async pull(cfg, { from, to }) {
      if (!cfg.url) throw new Error('Feed URL required');
      // this endpoint fetches a URL on the user's behalf: keep it off the local network
      let u;
      try { u = new URL(cfg.url); } catch { throw new Error('That is not a valid URL'); }
      if (!/^https?:$/.test(u.protocol)) throw new Error('Only http and https feeds');
      if (/^(localhost$|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1)/i.test(u.hostname)) {
        throw new Error('Refusing to fetch a private/local address');
      }
      const xml = await get(cfg.url);
      const b = rangeBounds(from, to);
      return parseFeed(xml, 'rss').filter((i) => inRange(new Date(i.date), b));
    }
  }
};

/* ---------------- artwork lookup ----------------
   A Letterboxd export carries titles, years and ratings but no images. These two
   sources fill posters back in:

   wikipedia  keyless. The article's lead image is the poster, and pilicense=any
              is what makes the API hand over non-free cover art. Good hit rate
              on anything with an English article.
   tmdb       optional free key (themoviedb.org/settings/api). Better coverage for
              foreign, obscure and very new titles, and far faster limits. */

const artCache = new Map();          // in-process; the caller adds the durable one

/* Wikimedia asks anonymous clients for a descriptive User-Agent and roughly one
   request a second. Ignore either and you get "You are making too many requests"
   as plain text — which is a temporary failure, NOT an answer, and must never be
   cached as "this film has no poster". */
const WIKI_UA = 'journal.jack/1.0 (personal media journal; single-user, self-hosted)';
const WIKI_GAP = 1100;

class Transient extends Error {}     // try again later; do not remember this

async function fromWikipedia(title, year) {
  const u = 'https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&maxlag=5' +
    '&generator=search&gsrlimit=1&gsrsearch=' + encodeURIComponent(`${title} ${year || ''} film`.trim()) +
    '&prop=pageimages&piprop=thumbnail&pithumbsize=600&pilicense=any';

  const res = await fetch(u, { headers: { 'User-Agent': WIKI_UA, 'Api-User-Agent': WIKI_UA } });
  const text = await res.text();

  let j;
  try { j = JSON.parse(text); }
  catch { throw new Transient('Wikipedia is rate-limiting: ' + text.slice(0, 60)); }

  if (j.error) {
    if (/ratelimit|maxlag|readonly/i.test(j.error.code || '')) throw new Transient(j.error.code);
    throw new Transient(j.error.code || 'wikipedia error');
  }

  const page = j.query?.pages?.[0];
  if (!page) return '';                        // searched fine, nothing matched
  const src = page.thumbnail?.source;
  return src ? src.split('?')[0] : '';         // drop wikimedia's tracking query
}

/* TMDb — the right source for this, and the one that actually has everything.
   The image CDN is public (image.tmdb.org/t/p/w500/<path>.jpg), but the <path>
   for a given title only comes from the search API, which needs a free key.
   Both key styles work: a v3 api_key, or a v4 read access token (a long "eyJ…"
   JWT), which goes in the Authorization header instead. */
async function tmdbSearch(kind, params, key) {
  const isToken = /^eyJ/.test(key);
  const qs = new URLSearchParams(params);
  if (!isToken) qs.set('api_key', key);
  const res = await fetch(`https://api.themoviedb.org/3/search/${kind}?${qs}`, {
    headers: {
      Accept: 'application/json',
      ...(isToken ? { Authorization: 'Bearer ' + key } : {})
    }
  });
  if (res.status === 401) throw new Error('TMDb rejected that key');
  if (res.status === 429) throw new Transient('tmdb rate limit');
  if (!res.ok) throw new Transient('tmdb HTTP ' + res.status);
  return res.json();
}

const tmdbPoster = (hit) => hit?.poster_path ? 'https://image.tmdb.org/t/p/w500' + hit.poster_path : '';

/* IMDb's title-suggestion endpoint — the one their own search box uses. No key, no
   sign-up, and it knows everything: 2026 festival one-offs, foreign titles, anime
   specials, TV. Each hit carries the poster on Amazon's image CDN.
   Those originals are huge (4050x6000 for one test title), so the URL is rewritten
   to IMDb's own resize form: 3.4 MB becomes 82 KB. */
const KINDS = new Set(['movie', 'tvSeries', 'tvMiniSeries', 'tvMovie', 'video', 'short', 'tvSpecial']);

function imdbPoster(url) {
  if (!url) return '';
  return url.replace(/\._V1_.*?\.jpg$/i, '._V1_QL75_UX500_.jpg');
}

async function imdbSuggest(query) {
  const res = await fetch(
    `https://v3.sg.media-imdb.com/suggestion/x/${encodeURIComponent(query)}.json?includeVideos=0`,
    { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (res.status === 429 || res.status >= 500) throw new Transient('imdb ' + res.status);
  if (!res.ok) return [];
  return ((await res.json()).d || []).filter((h) => h.i?.imageUrl && KINDS.has(h.qid));
}

/* The year is not a tie-breaker, it is part of the identity. Searching "House"
   returns the 2004 TV series; "House 1977" returns Hausu, which is the film that
   was actually watched. So the year goes into the query AND is then verified —
   and when nothing matches it, this returns no poster rather than a confident
   wrong one. A card with the right title beats a picture of the wrong film. */
async function fromIMDb(title, year) {
  const q = String(title || '').trim();
  if (!q) return '';
  const target = parseInt(year, 10) || 0;
  const named = (h) => normalise(h.l) === normalise(q);
  // one title containing the other covers subtitles and "The" prefixes
  const close = (h) => {
    const a = normalise(h.l), b = normalise(q);
    return a && b && (a.includes(b) || b.includes(a));
  };
  // festival vs general release makes catalogues disagree by a year
  const near = (h) => target && Math.abs(parseInt(h.y, 10) - target) <= 1;

  /* With no year to check against, the title has to carry the match on its own.
     IMDb's suggest endpoint answers *something* for any string — asking it for
     a Japanese song title returns "Identity Thief" as the top hit — so taking
     the first result is how an album ends up wearing a film poster. */
  if (!target) {
    const hits = await imdbSuggest(q);
    const pick = hits.find(named) || hits.find((h) => close(h));
    return pick ? imdbPoster(pick.i.imageUrl) : '';
  }

  for (const query of [`${q} ${target}`, q]) {
    const hits = await imdbSuggest(query);
    const pick =
      hits.find((h) => named(h) && parseInt(h.y, 10) === target) ||
      hits.find((h) => close(h) && parseInt(h.y, 10) === target) ||
      hits.find((h) => named(h) && near(h)) ||
      hits.find((h) => close(h) && near(h));
    if (pick) return imdbPoster(pick.i.imageUrl);
  }
  return '';
}

const normalise = (s) => String(s || '').toLowerCase()
  .normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, ' ').trim();

/* ---------------- album covers ----------------
   Musicboard is Deezer-backed and usually hands over a cover, but not always —
   about one in fifty came back empty in testing, and Last.fm serves a grey
   placeholder star for anything it doesn't know. Those are the tiles that end up
   blank, so the same fallback treatment as films applies here:

     deezer         keyless, same catalogue Musicboard itself uses -> best match
     itunes         keyless, huge, good for mainstream releases
     coverartarchive  keyless, via MusicBrainz; covers obscure and self-released

   Artist is checked the way a film's year is: an album title alone is not an
   identity ("Mercy" by two different bands is two different records). */

// Last.fm's "no image" star, and Deezer covers with an empty hash
const PLACEHOLDER = /2a96cbd8b46e442fc41c2b86b821562f|\/images\/cover\/\/|\/images\/cover\/$/;
const isRealCover = (u) => !!u && !PLACEHOLDER.test(u);

const artistMatches = (a, b) => {
  const x = normalise(a), y = normalise(b);
  if (!y) return true;                       // we were given no artist to check
  if (!x) return false;                      // they gave none: cannot claim a match
  return x === y || x.includes(y) || y.includes(x);
};

async function fromDeezer(album, artist) {
  const q = artist ? `artist:"${artist}" album:"${album}"` : album;
  const res = await fetch('https://api.deezer.com/search/album?limit=5&q=' + encodeURIComponent(q),
    { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (res.status === 429 || res.status >= 500) throw new Transient('deezer ' + res.status);
  if (!res.ok) return '';
  const rows = (await res.json()).data || [];
  const hit = rows.find((r) => artistMatches(r.artist?.name, artist) && isRealCover(r.cover_xl || r.cover_big))
           || (!artist && rows[0]);
  return hit ? (hit.cover_xl || hit.cover_big || hit.cover_medium || '') : '';
}

async function fromITunes(album, artist) {
  const res = await fetch('https://itunes.apple.com/search?entity=album&limit=5&term=' +
    encodeURIComponent([artist, album].filter(Boolean).join(' ')), { headers: { 'User-Agent': UA } });
  if (res.status === 429 || res.status >= 500) throw new Transient('itunes ' + res.status);
  if (!res.ok) return '';
  const rows = (await res.json()).results || [];
  const hit = rows.find((r) => artistMatches(r.artistName, artist)) || (!artist && rows[0]);
  // their thumbnails are 100px; ask for something worth looking at
  return hit?.artworkUrl100 ? hit.artworkUrl100.replace(/\/100x100bb\.jpg$/, '/600x600bb.jpg') : '';
}

async function fromCoverArt(album, artist) {
  const query = artist
    ? `release:"${album}" AND artist:"${artist}"`
    : `release:"${album}"`;
  const mb = await fetch('https://musicbrainz.org/ws/2/release-group/?fmt=json&limit=3&query=' +
    encodeURIComponent(query),
    { headers: { 'User-Agent': 'journal.jack/1.0 (personal media journal; self-hosted)', Accept: 'application/json' } });
  if (mb.status === 429 || mb.status >= 500) throw new Transient('musicbrainz ' + mb.status);
  if (!mb.ok) return '';
  const groups = (await mb.json())['release-groups'] || [];
  const hit = groups.find((g) => artistMatches(g['artist-credit']?.[0]?.name, artist)) || groups[0];
  if (!hit) return '';
  await sleep(1100);                            // MusicBrainz asks for one call a second
  const art = await fetch(`https://coverartarchive.org/release-group/${hit.id}/front-500`,
    { method: 'HEAD', headers: { 'User-Agent': UA }, redirect: 'follow' });
  return art.ok ? `https://coverartarchive.org/release-group/${hit.id}/front-500` : '';
}

/* Musicboard lets you rate a single track, and a track title will not be found
   in an album search. Fall back to the track's own release artwork. */
async function fromDeezerTrack(title, artist) {
  const q = artist ? `artist:"${artist}" track:"${title}"` : title;
  const res = await fetch('https://api.deezer.com/search/track?limit=5&q=' + encodeURIComponent(q),
    { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (res.status === 429 || res.status >= 500) throw new Transient('deezer ' + res.status);
  if (!res.ok) return '';
  const rows = (await res.json()).data || [];
  const hit = rows.find((r) => artistMatches(r.artist?.name, artist) && r.album?.cover_xl);
  return hit ? hit.album.cover_xl : '';
}

async function fromITunesSong(title, artist) {
  const res = await fetch('https://itunes.apple.com/search?entity=song&limit=5&term=' +
    encodeURIComponent([artist, title].filter(Boolean).join(' ')), { headers: { 'User-Agent': UA } });
  if (res.status === 429 || res.status >= 500) throw new Transient('itunes ' + res.status);
  if (!res.ok) return '';
  const rows = (await res.json()).results || [];
  const hit = rows.find((r) => artistMatches(r.artistName, artist));
  return hit?.artworkUrl100 ? hit.artworkUrl100.replace(/\/100x100bb\.jpg$/, '/600x600bb.jpg') : '';
}

async function albumArt(album, artist) {
  for (const step of [fromDeezer, fromITunes, fromDeezerTrack, fromITunesSong, fromCoverArt]) {
    try {
      const url = await step(album, artist);
      if (isRealCover(url)) return url;
    } catch (e) {
      if (e instanceof Transient) throw e;       // let the caller count it as pending
    }
    await sleep(150);
  }
  return '';
}

const tmdbYear = (r) => parseInt((r.release_date || r.first_air_date || '').slice(0, 4), 10) || 0;

async function fromTMDB(title, year, key) {
  const target = parseInt(year, 10) || 0;
  const named = (r) => normalise(r.title || r.name) === normalise(title);
  const pick = (results = []) => {
    const withArt = results.filter((r) => r.poster_path);
    if (!target) return withArt.find(named) || withArt[0];
    // same rule as IMDb: the year is identity, not a preference
    return withArt.find((r) => named(r) && tmdbYear(r) === target) ||
           withArt.find((r) => tmdbYear(r) === target) ||
           withArt.find((r) => named(r) && Math.abs(tmdbYear(r) - target) <= 1) ||
           withArt.find((r) => Math.abs(tmdbYear(r) - target) <= 1);
  };

  if (target) {
    const j = await tmdbSearch('movie', { query: title, year: target, include_adult: 'true' }, key);
    const hit = pick(j.results);
    if (hit) return tmdbPoster(hit);
  }

  const j2 = await tmdbSearch('movie', { query: title, include_adult: 'true' }, key);
  const hit2 = pick(j2.results);
  if (hit2) return tmdbPoster(hit2);

  // series, anime, specials — a journal is not only films
  const j3 = await tmdbSearch('multi', { query: title, include_adult: 'true' }, key);
  const hit3 = pick(j3.results);
  return hit3 ? tmdbPoster(hit3) : '';
}

/* Resolve a batch. Sequential and paced on purpose — these are somebody else's
   servers and a diary can be thousands of films.
   Three outcomes per title, and the difference matters:
     a url  -> found, remembered
     ''     -> the search worked and there is genuinely no poster, remembered
     absent -> we could not tell (rate limit, network). Counted as pending and
               deliberately NOT remembered, so retrying actually retries. */
async function artwork(items, opts = {}) {
  const out = {};
  let pending = 0;
  let throttled = false;

  for (const it of items.slice(0, 30)) {
    const key = it.kind === 'album'
      ? `album:${(it.title || '').toLowerCase()}|${(it.artist || '').toLowerCase()}`
      : `${(it.title || '').toLowerCase()}|${it.year || ''}`;
    if (artCache.has(key)) { out[key] = artCache.get(key); continue; }
    if (opts.lookup) {                            // durable cache, supplied by the server
      const hit = await opts.lookup(key);
      if (hit !== undefined) { artCache.set(key, hit); out[key] = hit; continue; }
    }

    /* Cascade, cheapest useful source first:
         TMDb   only when a key is present — best metadata, exact year matching
         IMDb   keyless and near-complete, so this is what usually answers
         Wiki   last resort; only covers titles with an article */
    let url;
    try {
      if (it.kind === 'album') {
        /* Music only ever asks music sources. Falling through to the film search
           is how an album called "Mercy" ends up wearing a film poster. */
        url = await albumArt(it.title, it.artist);
      } else {
        if (opts.tmdbKey) url = await fromTMDB(it.title, it.year, opts.tmdbKey);
        if (!url) {
          try { url = await fromIMDb(it.title, it.year); }
          catch (e) { if (!(e instanceof Transient)) url = ''; else throw e; }
        }
        if (!url) {
          try { url = await fromWikipedia(it.title, it.year); } catch { url = ''; }
        }
      }
    } catch (e) {
      if (/rejected that key/i.test(e.message)) throw e;   // tell the user, don't limp on
      pending++;
      if (e instanceof Transient) { throttled = true; await sleep(2500); }
      continue;                                   // no entry, nothing cached
    }

    artCache.set(key, url);
    out[key] = url;
    await opts.store?.(key, url);
    await sleep(opts.tmdbKey ? 60 : 180);
  }

  return { found: out, pending, throttled, source: opts.tmdbKey ? 'tmdb' : 'imdb' };
}

/* what the browser is allowed to know about each service */
function manifest() {
  return Object.entries(services).map(([id, s]) => ({
    id, name: s.name, access: s.access, tag: s.tag, history: s.history,
    note: s.note, fields: s.fields, csv: id === 'letterboxd'
  }));
}

/* small response cache so repeated pulls don't hammer anyone */
const cache = new Map();
const TTL = 5 * 60 * 1000;

async function pull(id, cfg, range) {
  const svc = services[id];
  if (!svc) throw new Error('Unknown service: ' + id);
  const key = id + JSON.stringify(cfg) + JSON.stringify(range);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.items;
  const items = await svc.pull(cfg, range);
  items.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  cache.set(key, { at: Date.now(), items });
  return items;
}

module.exports = { manifest, pull, artwork };
