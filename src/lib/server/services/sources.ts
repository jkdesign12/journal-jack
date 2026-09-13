import 'server-only';
import type { ImportedItem } from '@/lib/journal/types';
import { parseFeed } from './feed';
import { get, inRange, pad, rangeBounds, sleep, ymd, type Range } from './http';
import { isRealCover } from './artwork';

/* What each service actually allows — probed, not assumed. See each `note`. */

export interface Field {
  key: string;
  label: string;
  placeholder?: string;
  optional?: boolean;
  secret?: boolean;
  type?: 'select';
  options?: string[];
}

export interface Service {
  name: string;
  access: 'full' | 'partial';
  tag: string;
  history: string;
  note: string;
  fields: Field[];
  pull(cfg: Record<string, string>, range: Range): Promise<ImportedItem[]>;
}

export const services: Record<string, Service> = {
  letterboxd: {
    name: 'Letterboxd',
    access: 'partial',
    tag: 'films',
    history: 'last ~50 entries only',
    note:
      'Letterboxd has no public API, and their profile pages are behind bot protection this app ' +
      'will not try to defeat. The public RSS feed is open and carries watched date, your star ' +
      'rating and the poster — but only the most recent ~50 entries. For your whole history, ' +
      'export your data from letterboxd.com/settings/data and drop diary.csv (or the export .zip) ' +
      'on the drop area below.',
    fields: [{ key: 'user', label: 'Username', placeholder: 'yourname' }],
    async pull(cfg, { from, to }) {
      if (!cfg.user) throw new Error('Username required');
      const xml = await get<string>(`https://letterboxd.com/${encodeURIComponent(cfg.user)}/rss/`);
      const b = rangeBounds(from, to);
      return parseFeed(xml, 'letterboxd', { diaryOnly: true }).filter((i) =>
        inRange(new Date(i.date), b),
      );
    },
  },

  musicboard: {
    name: 'Musicboard',
    access: 'full',
    tag: 'music',
    history: 'complete',
    note:
      'Open read API, no key needed. Pulls every album you rated, with cover art, your score and ' +
      'the date you listened.',
    fields: [{ key: 'user', label: 'Username', placeholder: 'yourname' }],
    async pull(cfg, { from, to }) {
      if (!cfg.user) throw new Error('Username required');

      const found = await get<{ results?: { uid: string; username: string }[] }>(
        `https://api.musicboard.app/v2/users/?search=${encodeURIComponent(cfg.user)}&limit=5`,
        { json: true },
      );
      const me =
        (found.results ?? []).find((u) => u.username.toLowerCase() === cfg.user.toLowerCase()) ??
        found.results?.[0];
      if (!me) throw new Error(`No Musicboard user called "${cfg.user}"`);

      const b = rangeBounds(from, to);
      const out: ImportedItem[] = [];
      const LIMIT = 50;

      /* Review text lives on a separate endpoint; a rating points at its review
         by uid. Pull the reviews once up front and look them up as we go. */
      const reviews = new Map<string, string>();
      try {
        for (let offset = 0; offset < 1000; offset += LIMIT) {
          const page = await get<{
            results?: { uid: string; created_at: string; description?: string }[];
            next?: string | null;
          }>(
            `https://api.musicboard.app/v2/reviews/?creator=${me.uid}&limit=${LIMIT}&offset=${offset}`,
            { json: true },
          );
          const rows = page.results ?? [];
          if (!rows.length) break;

          let allOlder = true;
          for (const r of rows) {
            if (new Date(r.created_at) >= b.start) allOlder = false;
            const text = (r.description ?? '').trim();
            if (text) reviews.set(r.uid, text);
          }
          if (allOlder || !page.next) break;
          await sleep(200);
        }
      } catch {
        /* reviews are a bonus; ratings still import without them */
      }

      // ratings come back newest first, so stop once we fall past the window
      for (let offset = 0; offset < 4000; offset += LIMIT) {
        const page = await get<{
          results?: Array<{
            listened_at?: string;
            created_at?: string;
            rating?: number | null;
            review_uid?: string;
            review_url_slug?: string;
            content?: { title?: string; artist?: { name?: string }; cover?: string };
          }>;
          next?: string | null;
        }>(
          `https://api.musicboard.app/v2/ratings/?creator=${me.uid}&limit=${LIMIT}&offset=${offset}`,
          { json: true },
        );
        const rows = page.results ?? [];
        if (!rows.length) break;

        let allOlder = true;
        for (const r of rows) {
          const when = new Date(r.listened_at || r.created_at || '');
          if (isNaN(when.getTime())) continue;
          if (when >= b.start) allOlder = false;
          if (!inRange(when, b)) continue;

          const c = r.content ?? {};
          out.push({
            source: 'musicboard',
            title: c.title || '(untitled)',
            subtitle: c.artist?.name || '',
            image: isRealCover(c.cover) ? c.cover! : '', // blank ones get filled in later
            url: r.review_url_slug ? 'https://musicboard.app' + r.review_url_slug : '',
            date: ymd(when),
            rating: r.rating != null ? r.rating / 2 : null, // musicboard scores out of 10
            review: (r.review_uid && reviews.get(r.review_uid)) || '',
          });
        }

        if (allOlder) break; // everything on this page predates the window
        if (!page.next) break;
        await sleep(200); // be a good guest
      }
      return out;
    },
  },

  anilist: {
    name: 'AniList',
    access: 'full',
    tag: 'anime / manga',
    history: 'complete',
    note:
      'Public GraphQL API, no key. Pulls everything marked completed, with cover art, your score ' +
      'and the completion date. Entries you finished without a date recorded are skipped — ' +
      'AniList only stores one if you set it.',
    fields: [
      { key: 'user', label: 'Username', placeholder: 'yourname' },
      { key: 'type', label: 'List', type: 'select', options: ['ANIME', 'MANGA', 'BOTH'], optional: true },
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

      interface Entry {
        score?: number;
        notes?: string;
        completedAt?: { year?: number; month?: number; day?: number };
        media: {
          siteUrl: string;
          format?: string;
          title: { romaji?: string; english?: string };
          coverImage?: { large?: string };
        };
      }

      const out: ImportedItem[] = [];
      for (const type of types) {
        let json: {
          errors?: { message: string }[];
          data?: { MediaListCollection?: { lists?: { entries: Entry[] }[] } };
        };
        try {
          json = await get('https://graphql.anilist.co', {
            method: 'POST',
            json: true,
            headers: {
              'Content-Type': 'application/json',
              // AniList refuses server-side calls that arrive with no browser context
              Origin: 'https://anilist.co',
              Referer: 'https://anilist.co/',
            },
            body: JSON.stringify({ query, variables: { name: cfg.user, type } }),
          });
        } catch (e) {
          const message = (e as Error).message;
          if (/private user/i.test(message)) {
            throw new Error(
              `"${cfg.user}" has a private list (or the username is wrong) — AniList only serves public lists`,
            );
          }
          if (/not found/i.test(message)) throw new Error(`No AniList user called "${cfg.user}"`);
          throw e;
        }

        if (json.errors) throw new Error(json.errors[0].message);

        for (const list of json.data?.MediaListCollection?.lists ?? []) {
          for (const e of list.entries) {
            const c = e.completedAt ?? {};
            if (!c.year || !c.month) continue;
            const when = new Date(c.year, c.month - 1, c.day || 1);
            if (!inRange(when, b)) continue;

            out.push({
              source: 'anilist',
              title: e.media.title.english || e.media.title.romaji || '(untitled)',
              subtitle: e.media.format || type.toLowerCase(),
              image: e.media.coverImage?.large ?? '',
              url: e.media.siteUrl,
              date: ymd(when),
              rating: e.score ? e.score / 2 : null,
              review: (e.notes ?? '').trim(),
            });
          }
        }
        await sleep(250);
      }
      return out;
    },
  },

  lastfm: {
    name: 'Last.fm',
    access: 'full',
    tag: 'music',
    history: 'complete',
    note:
      'Public API, free key from last.fm/api/account/create. Scrobbles are grouped into albums ' +
      'per month, most-played first, so a month reads as the records you actually lived on.',
    fields: [
      { key: 'user', label: 'Username', placeholder: 'yourname' },
      { key: 'key', label: 'API key', placeholder: '32-character key', secret: true },
      { key: 'perMonth', label: 'Albums per month', placeholder: '12', optional: true },
    ],
    async pull(cfg, { from, to }) {
      if (!cfg.user || !cfg.key) throw new Error('Username and API key required');

      const b = rangeBounds(from, to);
      const fromTs = Math.floor(b.start.getTime() / 1000);
      const toTs = Math.floor(b.end.getTime() / 1000);
      const perMonth = parseInt(cfg.perMonth || '12', 10) || 12;

      interface Row extends ImportedItem {
        plays: number;
      }
      const byMonth = new Map<string, Map<string, Row>>();

      let page = 1;
      let pages = 1;
      const MAX_PAGES = 60; // 200 tracks each: 12k scrobbles per pull

      while (page <= pages && page <= MAX_PAGES) {
        const url =
          `https://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks` +
          `&user=${encodeURIComponent(cfg.user)}&api_key=${encodeURIComponent(cfg.key)}` +
          `&format=json&limit=200&from=${fromTs}&to=${toTs}&page=${page}`;

        const json = await get<{
          error?: number;
          message?: string;
          recenttracks?: {
            '@attr'?: { totalPages?: string };
            track?: Array<{
              '@attr'?: { nowplaying?: string };
              date?: { uts?: string };
              artist?: { '#text'?: string };
              album?: { '#text'?: string };
              image?: Array<{ '#text'?: string }>;
              name?: string;
              url?: string;
            }>;
          };
        }>(url, { json: true });

        if (json.error) throw new Error(json.message || 'Last.fm error ' + json.error);
        const rt = json.recenttracks ?? {};
        pages = parseInt(rt['@attr']?.totalPages ?? '1', 10);

        for (const t of ([] as NonNullable<typeof rt.track>).concat(rt.track ?? [])) {
          if (t['@attr']?.nowplaying || !t.date?.uts) continue;
          const when = new Date(parseInt(t.date.uts, 10) * 1000);
          const mk = `${when.getFullYear()}-${pad(when.getMonth() + 1)}`;

          if (!byMonth.has(mk)) byMonth.set(mk, new Map());
          const bucket = byMonth.get(mk)!;

          const artist = t.artist?.['#text'] ?? '';
          const album = t.album?.['#text'] || t.name || '';
          const key = artist + '|' + album;
          const image = (t.image ?? []).slice(-1)[0]?.['#text'] ?? '';

          const row =
            bucket.get(key) ??
            ({
              source: 'lastfm',
              title: album,
              subtitle: artist,
              image: isRealCover(image) ? image : '',
              url: t.url ?? '',
              date: ymd(when),
              rating: null,
              review: '',
              plays: 0,
            } as Row);

          row.plays++;
          if (when < new Date(row.date)) row.date = ymd(when);
          bucket.set(key, row);
        }

        page++;
        if (page <= pages) await sleep(250);
      }

      const out: ImportedItem[] = [];
      for (const bucket of byMonth.values()) {
        [...bucket.values()]
          .sort((a, b2) => b2.plays - a.plays)
          .slice(0, perMonth)
          .forEach((r) => out.push({ ...r, subtitle: `${r.subtitle} · ${r.plays} plays` }));
      }
      return out;
    },
  },

  rss: {
    name: 'Any RSS feed',
    access: 'full',
    tag: 'anything else',
    history: 'whatever the feed holds',
    note:
      'Backloggd, Serializd, Goodreads shelves, a YouTube channel, a blog. Entries dated inside ' +
      'the range get pulled in. Most feeds only carry recent items.',
    fields: [{ key: 'url', label: 'Feed URL', placeholder: 'https://example.com/feed.xml' }],
    async pull(cfg, { from, to }) {
      if (!cfg.url) throw new Error('Feed URL required');

      // this endpoint fetches a URL on someone's behalf: keep it off the local network
      let u: URL;
      try {
        u = new URL(cfg.url);
      } catch {
        throw new Error('That is not a valid URL');
      }
      if (!/^https?:$/.test(u.protocol)) throw new Error('Only http and https feeds');
      if (
        /^(localhost$|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1)/i.test(
          u.hostname,
        )
      ) {
        throw new Error('Refusing to fetch a private or local address');
      }

      const xml = await get<string>(cfg.url);
      const b = rangeBounds(from, to);
      return parseFeed(xml, 'rss').filter((i) => inRange(new Date(i.date), b));
    },
  },
};

/** What the browser is allowed to know about each service. */
export const manifest = () =>
  Object.entries(services).map(([id, s]) => ({
    id,
    name: s.name,
    access: s.access,
    tag: s.tag,
    history: s.history,
    note: s.note,
    fields: s.fields,
    csv: id === 'letterboxd',
  }));

/* A small response cache, so repeated pulls do not hammer anyone. */
const cache = new Map<string, { at: number; items: ImportedItem[] }>();
const TTL = 5 * 60 * 1000;

export async function pull(
  id: string,
  cfg: Record<string, string>,
  range: Range,
): Promise<ImportedItem[]> {
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
