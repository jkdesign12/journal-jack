import 'server-only';
import { Transient, UA, normalise, sleep } from './http';

/* Putting pictures back on things that arrived without them.
 *
 * A Letterboxd export carries titles, years and ratings but no images, and
 * Musicboard and Last.fm both hand over the occasional blank. The sources below
 * fill those in, cheapest useful one first.
 */

/* Last.fm's "no image" star, and Deezer covers with an empty hash. */
const PLACEHOLDER = /2a96cbd8b46e442fc41c2b86b821562f|\/images\/cover\/\/|\/images\/cover\/$/;
export const isRealCover = (u: string | undefined | null): boolean => !!u && !PLACEHOLDER.test(u);

/** Artist is checked the way a film's year is: an album title alone is not an
 *  identity — "Mercy" by two different bands is two different records. */
const artistMatches = (a: unknown, b: unknown): boolean => {
  const x = normalise(a);
  const y = normalise(b);
  if (!y) return true; // we were given no artist to check
  if (!x) return false; // they gave none: cannot claim a match
  return x === y || x.includes(y) || y.includes(x);
};

/* ---- films and series ---- */

/* Wikimedia asks anonymous clients for a descriptive User-Agent and roughly one
   request a second. Ignore either and you get "You are making too many
   requests" as plain text — which is a temporary failure, NOT an answer, and
   must never be remembered as "this film has no poster". */
const WIKI_UA = 'journal.jack/1.0 (personal media journal; single-user, self-hosted)';

async function fromWikipedia(title: string, year: string): Promise<string> {
  const u =
    'https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&maxlag=5' +
    '&generator=search&gsrlimit=1&gsrsearch=' +
    encodeURIComponent(`${title} ${year || ''} film`.trim()) +
    '&prop=pageimages&piprop=thumbnail&pithumbsize=600&pilicense=any';

  const res = await fetch(u, { headers: { 'User-Agent': WIKI_UA, 'Api-User-Agent': WIKI_UA } });
  const text = await res.text();

  let j: { error?: { code?: string }; query?: { pages?: { thumbnail?: { source?: string } }[] } };
  try {
    j = JSON.parse(text);
  } catch {
    throw new Transient('Wikipedia is rate-limiting: ' + text.slice(0, 60));
  }

  if (j.error) throw new Transient(j.error.code || 'wikipedia error');

  const page = j.query?.pages?.[0];
  if (!page) return ''; // searched fine, nothing matched
  const src = page.thumbnail?.source;
  return src ? src.split('?')[0] : ''; // drop wikimedia's tracking query
}

/* TMDb — the right source for this, and the one that actually has everything.
   The image CDN is public, but the path for a given title only comes from the
   search API, which needs a free key. Both key styles work: a v3 api_key, or a
   v4 read access token (a long "eyJ…" JWT) in the Authorization header. */
interface TmdbHit {
  poster_path?: string;
  title?: string;
  name?: string;
  release_date?: string;
  first_air_date?: string;
}

async function tmdbSearch(
  kind: string,
  params: Record<string, string>,
  key: string,
): Promise<{ results?: TmdbHit[] }> {
  const isToken = /^eyJ/.test(key);
  const qs = new URLSearchParams(params);
  if (!isToken) qs.set('api_key', key);

  const res = await fetch(`https://api.themoviedb.org/3/search/${kind}?${qs}`, {
    headers: { Accept: 'application/json', ...(isToken ? { Authorization: 'Bearer ' + key } : {}) },
  });

  if (res.status === 401) throw new Error('TMDb rejected that key');
  if (res.status === 429) throw new Transient('tmdb rate limit');
  if (!res.ok) throw new Transient('tmdb HTTP ' + res.status);
  return res.json();
}

const tmdbPoster = (hit?: TmdbHit) =>
  hit?.poster_path ? 'https://image.tmdb.org/t/p/w500' + hit.poster_path : '';

const tmdbYear = (r: TmdbHit) =>
  parseInt((r.release_date || r.first_air_date || '').slice(0, 4), 10) || 0;

async function fromTMDB(title: string, year: string, key: string): Promise<string> {
  const target = parseInt(year, 10) || 0;
  const named = (r: TmdbHit) => normalise(r.title || r.name) === normalise(title);

  const pick = (results: TmdbHit[] = []) => {
    const withArt = results.filter((r) => r.poster_path);
    if (!target) return withArt.find(named) ?? withArt[0];
    // same rule as IMDb: the year is identity, not a preference
    return (
      withArt.find((r) => named(r) && tmdbYear(r) === target) ??
      withArt.find((r) => tmdbYear(r) === target) ??
      withArt.find((r) => named(r) && Math.abs(tmdbYear(r) - target) <= 1) ??
      withArt.find((r) => Math.abs(tmdbYear(r) - target) <= 1)
    );
  };

  if (target) {
    const j = await tmdbSearch('movie', { query: title, year: String(target), include_adult: 'true' }, key);
    const hit = pick(j.results);
    if (hit) return tmdbPoster(hit);
  }

  const j2 = await tmdbSearch('movie', { query: title, include_adult: 'true' }, key);
  const hit2 = pick(j2.results);
  if (hit2) return tmdbPoster(hit2);

  // series, anime, specials — a journal is not only films
  const j3 = await tmdbSearch('multi', { query: title, include_adult: 'true' }, key);
  return tmdbPoster(pick(j3.results));
}

/* IMDb's title-suggestion endpoint — the one their own search box uses. No key,
   no sign-up, and it knows everything: festival one-offs, foreign titles, anime
   specials, TV. Each hit carries a poster on Amazon's image CDN; those
   originals are huge, so the URL is rewritten to IMDb's own resize form —
   3.4 MB becomes 82 KB. */
const KINDS = new Set(['movie', 'tvSeries', 'tvMiniSeries', 'tvMovie', 'video', 'short', 'tvSpecial']);

interface ImdbHit {
  l?: string;
  y?: number;
  qid?: string;
  i?: { imageUrl?: string };
}

const imdbPoster = (url?: string) =>
  url ? url.replace(/\._V1_.*?\.jpg$/i, '._V1_QL75_UX500_.jpg') : '';

async function imdbSuggest(query: string): Promise<ImdbHit[]> {
  const res = await fetch(
    `https://v3.sg.media-imdb.com/suggestion/x/${encodeURIComponent(query)}.json?includeVideos=0`,
    { headers: { 'User-Agent': UA, Accept: 'application/json' } },
  );
  if (res.status === 429 || res.status >= 500) throw new Transient('imdb ' + res.status);
  if (!res.ok) return [];
  const json = (await res.json()) as { d?: ImdbHit[] };
  return (json.d ?? []).filter((h) => h.i?.imageUrl && KINDS.has(h.qid ?? ''));
}

/**
 * The year is not a tie-breaker, it is part of the identity. Searching "House"
 * returns the 2004 TV series; "House 1977" returns Hausu, which is the film
 * that was actually watched. So the year goes into the query AND is verified —
 * and when nothing matches it, this returns no poster rather than a confident
 * wrong one. A card with the right title beats a picture of the wrong film.
 */
async function fromIMDb(title: string, year: string): Promise<string> {
  const q = String(title ?? '').trim();
  if (!q) return '';
  const target = parseInt(year, 10) || 0;

  const named = (h: ImdbHit) => normalise(h.l) === normalise(q);
  // one title containing the other covers subtitles and "The" prefixes
  const close = (h: ImdbHit) => {
    const a = normalise(h.l);
    const b = normalise(q);
    return !!a && !!b && (a.includes(b) || b.includes(a));
  };
  // festival vs general release makes catalogues disagree by a year
  const near = (h: ImdbHit) => !!target && Math.abs((h.y ?? 0) - target) <= 1;

  /* With no year to check against, the title has to carry the match on its own.
     IMDb's suggest endpoint answers *something* for any string — asking it for
     a Japanese song title returns "Identity Thief" as the top hit — so taking
     the first result is how an album ends up wearing a film poster. */
  if (!target) {
    const hits = await imdbSuggest(q);
    const pick = hits.find(named) ?? hits.find(close);
    return pick ? imdbPoster(pick.i?.imageUrl) : '';
  }

  for (const query of [`${q} ${target}`, q]) {
    const hits = await imdbSuggest(query);
    const pick =
      hits.find((h) => named(h) && h.y === target) ??
      hits.find((h) => close(h) && h.y === target) ??
      hits.find((h) => named(h) && near(h)) ??
      hits.find((h) => close(h) && near(h));
    if (pick) return imdbPoster(pick.i?.imageUrl);
  }
  return '';
}

/* ---- album covers ----
   Musicboard is Deezer-backed and usually hands over a cover, but not always,
   and Last.fm serves a grey placeholder star for anything it does not know.
   Those are the tiles that end up blank, so the same treatment as films:

     deezer           keyless, the same catalogue Musicboard itself uses
     itunes           keyless, huge, good for mainstream releases
     coverartarchive  keyless, via MusicBrainz; covers obscure and self-released
*/

async function fromDeezer(album: string, artist: string): Promise<string> {
  const q = artist ? `artist:"${artist}" album:"${album}"` : album;
  const res = await fetch('https://api.deezer.com/search/album?limit=5&q=' + encodeURIComponent(q), {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
  });
  if (res.status === 429 || res.status >= 500) throw new Transient('deezer ' + res.status);
  if (!res.ok) return '';

  const rows =
    ((await res.json()) as { data?: Array<{ artist?: { name?: string }; cover_xl?: string; cover_big?: string; cover_medium?: string }> })
      .data ?? [];
  const hit =
    rows.find((r) => artistMatches(r.artist?.name, artist) && isRealCover(r.cover_xl || r.cover_big)) ??
    (!artist ? rows[0] : undefined);
  return hit ? hit.cover_xl || hit.cover_big || hit.cover_medium || '' : '';
}

async function fromITunes(album: string, artist: string): Promise<string> {
  const res = await fetch(
    'https://itunes.apple.com/search?entity=album&limit=5&term=' +
      encodeURIComponent([artist, album].filter(Boolean).join(' ')),
    { headers: { 'User-Agent': UA } },
  );
  if (res.status === 429 || res.status >= 500) throw new Transient('itunes ' + res.status);
  if (!res.ok) return '';

  const rows =
    ((await res.json()) as { results?: Array<{ artistName?: string; artworkUrl100?: string }> }).results ?? [];
  const hit = rows.find((r) => artistMatches(r.artistName, artist)) ?? (!artist ? rows[0] : undefined);
  // their thumbnails are 100px; ask for something worth looking at
  return hit?.artworkUrl100 ? hit.artworkUrl100.replace(/\/100x100bb\.jpg$/, '/600x600bb.jpg') : '';
}

/** Musicboard lets you rate a single track, and a track title will not be found
 *  in an album search. Fall back to the track's own release artwork. */
async function fromDeezerTrack(title: string, artist: string): Promise<string> {
  const q = artist ? `artist:"${artist}" track:"${title}"` : title;
  const res = await fetch('https://api.deezer.com/search/track?limit=5&q=' + encodeURIComponent(q), {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
  });
  if (res.status === 429 || res.status >= 500) throw new Transient('deezer ' + res.status);
  if (!res.ok) return '';

  const rows =
    ((await res.json()) as { data?: Array<{ artist?: { name?: string }; album?: { cover_xl?: string } }> }).data ?? [];
  const hit = rows.find((r) => artistMatches(r.artist?.name, artist) && r.album?.cover_xl);
  return hit?.album?.cover_xl ?? '';
}

async function fromITunesSong(title: string, artist: string): Promise<string> {
  const res = await fetch(
    'https://itunes.apple.com/search?entity=song&limit=5&term=' +
      encodeURIComponent([artist, title].filter(Boolean).join(' ')),
    { headers: { 'User-Agent': UA } },
  );
  if (res.status === 429 || res.status >= 500) throw new Transient('itunes ' + res.status);
  if (!res.ok) return '';

  const rows =
    ((await res.json()) as { results?: Array<{ artistName?: string; artworkUrl100?: string }> }).results ?? [];
  const hit = rows.find((r) => artistMatches(r.artistName, artist));
  return hit?.artworkUrl100 ? hit.artworkUrl100.replace(/\/100x100bb\.jpg$/, '/600x600bb.jpg') : '';
}

async function fromCoverArt(album: string, artist: string): Promise<string> {
  const query = artist ? `release:"${album}" AND artist:"${artist}"` : `release:"${album}"`;
  const mb = await fetch(
    'https://musicbrainz.org/ws/2/release-group/?fmt=json&limit=3&query=' + encodeURIComponent(query),
    {
      headers: {
        'User-Agent': 'journal.jack/1.0 (personal media journal; self-hosted)',
        Accept: 'application/json',
      },
    },
  );
  if (mb.status === 429 || mb.status >= 500) throw new Transient('musicbrainz ' + mb.status);
  if (!mb.ok) return '';

  const groups =
    ((await mb.json()) as { 'release-groups'?: Array<{ id: string; 'artist-credit'?: Array<{ name?: string }> }> })[
      'release-groups'
    ] ?? [];
  const hit = groups.find((g) => artistMatches(g['artist-credit']?.[0]?.name, artist)) ?? groups[0];
  if (!hit) return '';

  await sleep(1100); // MusicBrainz asks for one call a second
  const art = await fetch(`https://coverartarchive.org/release-group/${hit.id}/front-500`, {
    method: 'HEAD',
    headers: { 'User-Agent': UA },
    redirect: 'follow',
  });
  return art.ok ? `https://coverartarchive.org/release-group/${hit.id}/front-500` : '';
}

async function albumArt(album: string, artist: string): Promise<string> {
  for (const step of [fromDeezer, fromITunes, fromDeezerTrack, fromITunesSong, fromCoverArt]) {
    try {
      const url = await step(album, artist);
      if (isRealCover(url)) return url;
    } catch (e) {
      if (e instanceof Transient) throw e; // let the caller count it as pending
    }
    await sleep(150);
  }
  return '';
}

/* ---- resolving a batch ---- */

export interface ArtItem {
  kind?: 'album';
  title: string;
  artist?: string;
  year?: string;
}

export interface ArtOptions {
  tmdbKey?: string;
  lookup?: (key: string) => Promise<string | undefined>;
  store?: (key: string, url: string) => Promise<void>;
}

const artCache = new Map<string, string>(); // in-process; the caller adds the durable one

/**
 * Sequential and paced on purpose — these are somebody else's servers and a
 * diary can be thousands of films.
 *
 * Three outcomes per title, and the difference matters:
 *   a url  -> found, remembered
 *   ''     -> the search worked and there is genuinely no poster, remembered
 *   absent -> we could not tell (rate limit, network). Counted as pending and
 *             deliberately NOT remembered, so retrying actually retries.
 */
export async function artwork(items: ArtItem[], opts: ArtOptions = {}) {
  const found: Record<string, string> = {};
  let pending = 0;
  let throttled = false;

  for (const it of items.slice(0, 30)) {
    const key =
      it.kind === 'album'
        ? `album:${(it.title || '').toLowerCase()}|${(it.artist || '').toLowerCase()}`
        : `${(it.title || '').toLowerCase()}|${it.year || ''}`;

    if (artCache.has(key)) {
      found[key] = artCache.get(key)!;
      continue;
    }
    if (opts.lookup) {
      const hit = await opts.lookup(key);
      if (hit !== undefined) {
        artCache.set(key, hit);
        found[key] = hit;
        continue;
      }
    }

    let url: string | undefined;
    try {
      if (it.kind === 'album') {
        /* Music only ever asks music sources. Falling through to the film
           search is how an album called "Mercy" ends up wearing a film poster. */
        url = await albumArt(it.title, it.artist ?? '');
      } else {
        if (opts.tmdbKey) url = await fromTMDB(it.title, it.year ?? '', opts.tmdbKey);
        if (!url) {
          try {
            url = await fromIMDb(it.title, it.year ?? '');
          } catch (e) {
            if (!(e instanceof Transient)) url = '';
            else throw e;
          }
        }
        if (!url) {
          try {
            url = await fromWikipedia(it.title, it.year ?? '');
          } catch {
            url = '';
          }
        }
      }
    } catch (e) {
      if (/rejected that key/i.test((e as Error).message)) throw e; // say so, do not limp on
      pending++;
      if (e instanceof Transient) {
        throttled = true;
        await sleep(2500);
      }
      continue; // no entry, nothing cached
    }

    artCache.set(key, url);
    found[key] = url;
    await opts.store?.(key, url);
    await sleep(opts.tmdbKey ? 60 : 180);
  }

  return { found, pending, throttled, source: opts.tmdbKey ? 'tmdb' : 'imdb' };
}
