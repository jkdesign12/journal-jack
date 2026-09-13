import 'server-only';

/* The shared manners for talking to somebody else's server.
 *
 * These importers run here rather than in the browser, which buys two things:
 * no CORS wall, and the ability to page through a whole history instead of
 * whatever fits in a feed.
 */

export const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/131.0.0.0 Safari/537.36';

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const pad = (n: number) => String(n).padStart(2, '0');
export const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Try again later; do not remember this as an answer. */
export class Transient extends Error {}

export const normalise = (s: unknown): string =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export interface Range {
  from?: string;
  to?: string;
}

/** from/to are inclusive 'YYYY-MM' strings. */
export function rangeBounds(from?: string, to?: string) {
  const [fy, fm] = (from || '1970-01').split('-').map(Number);
  const [ty, tm] = (to || '2999-12').split('-').map(Number);
  return { start: new Date(fy, fm - 1, 1), end: new Date(ty, tm, 1) };
}

export const inRange = (date: Date, b: { start: Date; end: Date }) =>
  date >= b.start && date < b.end;

interface GetOptions extends RequestInit {
  json?: boolean;
}

/**
 * A small polite fetch: retries once, backs off, and always identifies as a
 * browser, because several of these hosts reject unknown agents outright.
 */
export async function get<T = string>(url: string, opts: GetOptions = {}): Promise<T> {
  const headers = {
    'User-Agent': UA,
    Accept: opts.json ? 'application/json' : '*/*',
    ...((opts.headers as Record<string, string>) ?? {}),
  };

  let last: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { ...opts, headers });

      if (res.status === 429 || res.status >= 500) {
        last = new Error('HTTP ' + res.status);
        await sleep(1200);
        continue;
      }

      if (!res.ok) {
        const body = await res.text();
        // APIs often explain themselves in the error body — say what they said
        let message = '';
        try {
          const j = JSON.parse(body) as { errors?: { message?: string }[]; message?: string; detail?: string };
          message = j.errors?.[0]?.message || j.message || j.detail || '';
        } catch {
          /* not json */
        }
        const challenged = /Just a moment|cf-browser-verification|challenge-platform/i.test(body);
        throw new Error(
          message
            ? message
            : challenged
              ? `blocked by the site’s bot protection (HTTP ${res.status})`
              : 'HTTP ' + res.status,
        );
      }

      return (opts.json ? await res.json() : await res.text()) as T;
    } catch (e) {
      last = e;
      if (attempt) throw e;
      await sleep(600);
    }
  }
  throw last;
}
