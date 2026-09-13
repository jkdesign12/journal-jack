import 'server-only';
import type { ImportedItem } from '@/lib/journal/types';
import { ymd } from './http';

/* Feed parsing by regex, because there is no DOM on the server and a feed is
   not worth a parser dependency. */

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  '#39': "'",
  hellip: '…',
  mdash: '—',
  ndash: '–',
  rsquo: '’',
  lsquo: '‘',
  ldquo: '“',
  rdquo: '”',
};

export function htmlToText(html: string): string {
  return String(html ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (m, e: string) => {
      const known = ENTITIES[e.toLowerCase()];
      if (known) return known;
      if (e[0] === '#') {
        const hex = e[1] === 'x' || e[1] === 'X';
        return String.fromCodePoint(parseInt(e.slice(1).replace(/^x/i, ''), hex ? 16 : 10));
      }
      return m;
    })
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export const tag = (xml: string, name: string): string => {
  const m = xml.match(new RegExp('<' + name + '[^>]*>([\\s\\S]*?)</' + name + '>', 'i'));
  return m ? m[1].replace(/^<!\[CDATA\[|\]\]>$/g, '').trim() : '';
};

export function parseFeed(
  xml: string,
  source: string,
  opts: { diaryOnly?: boolean } = {},
): ImportedItem[] {
  const chunks = xml.split(/<(?:item|entry)[\s>]/i).slice(1);
  const out: ImportedItem[] = [];

  for (const raw of chunks) {
    const chunk = raw.split(/<\/(?:item|entry)>/i)[0];
    const watchedDate = tag(chunk, 'letterboxd:watchedDate');

    /* A Letterboxd feed mixes diary entries with lists ("Ranked: 28 Films
       Later", watchlists). Only diary entries carry a watched date, and only
       those are things you actually did on a day. */
    if (opts.diaryOnly && !watchedDate) continue;

    const watched =
      watchedDate || tag(chunk, 'pubDate') || tag(chunk, 'published') || tag(chunk, 'updated');
    const when = new Date(watched);
    if (isNaN(when.getTime())) continue;

    const desc =
      tag(chunk, 'description') || tag(chunk, 'content:encoded') || tag(chunk, 'content');
    const img = desc.match(/<img[^>]+src=["']([^"']+)["']/i);
    const filmTitle = tag(chunk, 'letterboxd:filmTitle');
    const year = tag(chunk, 'letterboxd:filmYear');
    const rating = tag(chunk, 'letterboxd:memberRating');

    // feeds arrive HTML-escaped: "Butcher&#039;s Stain" should read as an apostrophe
    let title = htmlToText(filmTitle || tag(chunk, 'title') || '(untitled)');
    const starIdx = title.indexOf(' - ★');
    if (!filmTitle && starIdx > -1) title = title.slice(0, starIdx);

    let link = tag(chunk, 'link');
    if (!link) {
      const m = chunk.match(/<link[^>]+href=["']([^"']+)["']/i);
      link = m ? m[1] : '';
    }

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
      review,
    });
  }
  return out;
}
