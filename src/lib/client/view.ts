/* What this window is looking at.
 *
 * The month on screen, the view, the sort, the theme, autoplay and the tag
 * filter are about this tab, not about the journal. They used to live inside
 * the synced document, which meant two open tabs fought: one pushed, the other
 * hit a version conflict, adopted the whole document, and got yanked to the
 * first tab's month mid-sentence.
 *
 * sessionStorage is per tab, so two tabs cannot tread on each other.
 * localStorage keeps a copy purely so a brand new tab opens where you left off.
 * Neither is ever sent to the server.
 */

export const UI_KEY = 'journal:view';

export type ViewMode = 'grid' | 'calendar';
export type Theme = 'dark' | 'light';

export interface ViewState {
  /** 'YYYY-MM' */
  cursor: string;
  view: ViewMode;
  sort: string;
  theme: Theme;
  autoplay: boolean;
  /** every month at once, rather than the one on the cursor */
  all: boolean;
  /** tags switched off in the filter; empty means everything shows */
  hiddenTags: string[];
}

const pad = (n: number) => String(n).padStart(2, '0');

export function thisMonth(now = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
}

export const defaultView = (): ViewState => ({
  cursor: thisMonth(),
  view: 'grid',
  sort: 'manual',
  theme: 'dark',
  autoplay: false,
  all: false,
  hiddenTags: [],
});

export function loadView(): ViewState {
  const view = defaultView();
  if (typeof window === 'undefined') return view;

  let saved: Partial<ViewState> | null = null;
  try {
    saved = JSON.parse(sessionStorage.getItem(UI_KEY) ?? 'null');
  } catch {
    /* a tab that cannot read its own storage still gets defaults */
  }
  if (!saved) {
    try {
      saved = JSON.parse(localStorage.getItem(UI_KEY) ?? 'null');
    } catch {
      /* same */
    }
  }
  if (!saved) return view;

  const fields = Object.keys(view) as (keyof ViewState)[];
  const target = view as unknown as Record<string, unknown>;
  const from = saved as Record<string, unknown>;
  for (const key of fields) {
    const value = from[key];
    if (value !== undefined && value !== null) target[key] = value;
  }
  if (!view.cursor) view.cursor = thisMonth();
  return view;
}

export function saveView(view: ViewState): void {
  if (typeof window === 'undefined') return;
  const body = JSON.stringify(view);
  try {
    sessionStorage.setItem(UI_KEY, body);
  } catch {
    /* nothing to do: the view is a convenience, not the journal */
  }
  try {
    localStorage.setItem(UI_KEY, body);
  } catch {
    /* same */
  }
}
