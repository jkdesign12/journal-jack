/* The shape of a journal.
 *
 * These types describe documents that already exist — in browsers, and in the
 * `journals` table of the live database. Nothing here may be renamed or made
 * stricter than what is already stored, or a journal written by the old app
 * stops loading. Fields the old app wrote and this one no longer uses are kept
 * and marked legacy rather than dropped.
 */

export const SIZES = ['sm', 'md', 'lg'] as const;
export type Size = (typeof SIZES)[number];

/** 'wide' and 'tall' are what much older saves hold; sizeOf() maps them. */
export type StoredSize = Size | 'wide' | 'tall';

export type WidgetKind =
  | 'note'
  | 'heading'
  | 'quote'
  | 'checklist'
  | 'palette'
  | 'stats'
  | 'link';

export type BlockKind = 'photo' | 'media' | WidgetKind;

export interface ChecklistItem {
  t: string;
  done: boolean;
}

export interface Block {
  id: string;
  kind: BlockKind;
  size?: StoredSize;

  /** where the tile sits on its month's board, in grid units */
  gx?: number;
  gy?: number;
  /** a size set by dragging a corner, in grid units */
  uw?: number;
  uh?: number;
  /** measured aspect of the artwork, cached so layout does not wait on images */
  ratio?: number;

  /** a picture: either a URL (imports, links) or a file held locally */
  src?: string;
  /** the cover was typed in by hand, so nothing may go looking for another */
  srcByHand?: boolean;
  blobId?: string;
  mime?: string;

  title?: string;
  subtitle?: string;
  note?: string;

  /** 'YYYY-MM-DD'. `day` is the day of the month, kept for the calendar. */
  date?: string | null;
  day?: number | null;
  rating?: number | null;

  /** which service it came from: letterboxd, musicboard, lastfm, anilist, rss */
  source?: string;
  /** 'export' beats 'feed' when the same watch arrives twice */
  origin?: 'export' | 'feed';
  url?: string;

  /** what kind of thing this is: Movie, Music, Book… */
  tags?: string[];
  /** legacy single tag, migrated to `tags` on load */
  tag?: string;

  /* widget content */
  text?: string;
  items?: ChecklistItem[];
  colors?: string[];
}

export interface Song {
  blobId: string;
  name: string;
}

export interface Month {
  blocks: Block[];
  song?: Song | null;
  /** stamped when the month's contents change, so merging can compare months */
  updatedAt?: number;
  /** an erase is deliberate and beats anything older than it */
  erasedAt?: number;
  /** block id -> when it was deleted, so a merge cannot hand it back */
  removed?: Record<string, number>;

  /* legacy month fields */
  title?: string;
  note?: string;
  accent?: string;
  /** colours used to be per month; ensureShape lifts these to the year */
  bg?: string | null;
  ink?: string | null;

  /* a drop shadow set for this month alone */
  shadow?: boolean;
  shadowColour?: string;
  shadowY?: number;
  shadowBlur?: number;
}

export interface Palette {
  bg?: string | null;
  ink?: string | null;
  /** when this year's colours were last chosen — merging compares these */
  at?: number;
}

export interface ShadowSettings {
  shadow?: boolean;
  shadowColour?: string;
  shadowY?: number;
  shadowBlur?: number;
}

export interface SyncSettings {
  services: Record<string, Record<string, string>>;
  range: { from: string; to: string };
  autoRefresh?: boolean;
}

export interface JournalDoc {
  v?: number;
  /** 'YYYY-MM' -> month */
  months: Record<string, Month>;

  /** background and text colour, per year */
  yearColours?: Record<string, Palette>;

  /** one shadow for every month, rather than per month */
  shadowAll?: boolean;
  shadowGlobal?: ShadowSettings;
  shadowAt?: number;

  /** colour pairs you mixed yourself, and built-ins you threw away */
  customColours?: Palette[];
  hiddenPresets?: string[];
  paletteAt?: number;

  sync?: SyncSettings;
  updatedAt?: number;
}

export const blankMonth = (): Month => ({
  title: '',
  note: '',
  song: null,
  blocks: [],
});

export const emptyDoc = (): JournalDoc => ({
  v: 1,
  months: {},
  sync: { services: {}, range: { from: '', to: '' } },
});

/** What a service hands back before it becomes a block. */
export interface ImportedItem {
  source: string;
  title: string;
  subtitle: string;
  image: string;
  url: string;
  date: string;
  rating: number | null;
  review: string;
  tags?: string;
}
