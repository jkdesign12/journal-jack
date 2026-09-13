'use client';

import { MONTHS } from '@/lib/journal/dates';
import { SORT_LABELS, SORT_MODES, type SortMode } from '@/lib/journal/sort';
import type { ViewState } from '@/lib/client/view';

const button =
  'rounded-[9px] border border-line bg-panel px-3 py-1.5 text-[12.5px] font-medium whitespace-nowrap ' +
  'enabled:hover:border-accent enabled:hover:text-accent disabled:opacity-50';

const arrow =
  'flex h-8 w-8 items-center justify-center rounded-[9px] text-[17px] text-ink-2 ' +
  'hover:bg-bg-2 hover:text-ink max-[640px]:h-[46px] max-[640px]:w-[46px] max-[640px]:text-[27px]';

/** Nothing left: every control the original had is wired up. */
export const NOT_YET: readonly string[] = [];

export function Header({
  view,
  span,
  signedIn,
  busy,
  canReset,
  onShift,
  onView,
  onSort,
  onOpenMonths,
  onOpenAccount,
  onOpenTags,
  onOpenMedia,
  onOpenWidgets,
  onOpenSync,
  onOpenMenu,
  onSync,
  onResetLayout,
}: {
  view: ViewState;
  span: { first?: string; last?: string };
  signedIn: boolean;
  busy: boolean;
  canReset: boolean;
  onShift: (delta: number) => void;
  onView: (mode: 'grid' | 'calendar') => void;
  onSort: (mode: SortMode) => void;
  onOpenMonths: () => void;
  onOpenAccount: () => void;
  onOpenTags: () => void;
  onOpenMedia: () => void;
  onOpenWidgets: () => void;
  onOpenSync: () => void;
  onOpenMenu: () => void;
  onSync: () => void;
  onResetLayout: () => void;
}) {
  const [year, month] = view.cursor.split('-').map(Number);
  const title = view.all ? 'Everything' : MONTHS[month - 1];
  const subtitle = view.all
    ? !span.first
      ? ''
      : span.first === span.last
        ? span.first
        : `${span.first}–${span.last}`
    : String(year);

  const off = view.hiddenTags.length;

  return (
    <header className="sticky top-0 z-40 flex flex-wrap items-center gap-4 border-b border-line bg-bg/85 px-5 py-3.5 backdrop-blur-md max-[640px]:static max-[640px]:gap-2 max-[640px]:px-3">
      <span className="font-serif text-[22px] whitespace-nowrap max-[640px]:text-[19px]">
        journal<em className="not-italic text-brand">.jack</em>
      </span>

      <nav className="mx-auto flex items-center gap-1 max-[640px]:order-first max-[640px]:w-full max-[640px]:justify-center">
        <button className={arrow} onClick={() => onShift(-1)} title="Previous month" aria-label="Previous month">
          ‹
        </button>

        <button
          className="flex items-baseline gap-2 rounded-[10px] px-3.5 py-1 hover:bg-bg-2 max-[640px]:gap-2.5"
          onClick={onOpenMonths}
        >
          <span className="font-serif text-[30px] leading-none">{title}</span>
          <span className="text-[13px] font-extrabold tracking-[0.14em] text-ink max-[640px]:text-[15px]">
            {subtitle}
          </span>
        </button>

        <button className={arrow} onClick={() => onShift(1)} title="Next month" aria-label="Next month">
          ›
        </button>
      </nav>

      <div className="flex items-center gap-2 max-[640px]:w-full max-[640px]:flex-wrap max-[640px]:gap-1.5">
        <div className="flex rounded-[10px] border border-line bg-bg-2 p-[3px]">
          {(['grid', 'calendar'] as const).map((mode) => (
            <button
              key={mode}
              className={
                'rounded-[7px] px-3 py-1 text-[12.5px] capitalize ' +
                (view.view === mode ? 'bg-panel text-ink shadow-sm' : 'text-ink-2')
              }
              onClick={() => onView(mode)}
            >
              {mode}
            </button>
          ))}
        </div>

        <select
          className="rounded-[9px] border border-line bg-panel px-2.5 py-1.5 text-[12.5px] text-ink-2 outline-none hover:border-accent hover:text-ink"
          value={view.sort}
          onChange={(e) => onSort(e.target.value as SortMode)}
          title="Order"
        >
          {SORT_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {SORT_LABELS[mode]}
            </option>
          ))}
        </select>

        {/* Only worth offering where there is a hand-made layout to undo. */}
        {canReset ? (
          <button
            className={button}
            onClick={onResetLayout}
            title="Repack this month's tiles in order. Sizes you set by hand are kept."
          >
            Reset layout
          </button>
        ) : null}

        <button
          className={button + (off ? ' border-accent text-accent' : '')}
          onClick={onOpenTags}
          title="Show or hide items by tag"
        >
          {off ? `Tags · ${off} off` : 'Tags'}
        </button>

        <button className={button} onClick={onOpenMedia}>
          ＋ Media
        </button>

        <button className={button} onClick={onOpenWidgets}>
          Widget
        </button>

        <button className={button} onClick={onOpenSync}>
          Sync{busy ? <span className="busy-dot" aria-hidden /> : null}
        </button>

        {/* Syncing without an account would do nothing, so it only appears
            once there is one to sync with. */}
        {signedIn ? (
          <button className={button} onClick={onSync} disabled={busy}>
            {busy ? 'Syncing…' : 'Sync now'}
          </button>
        ) : null}

        <button className={button} onClick={onOpenAccount}>
          {signedIn ? 'Account' : 'Sign in'}
        </button>

        <button
          className="flex h-8 w-8 items-center justify-center rounded-[9px] text-[17px] text-ink-2 hover:bg-bg-2 hover:text-ink"
          onClick={onOpenMenu}
          title="More"
          aria-label="More"
        >
          ⋯
        </button>
      </div>
    </header>
  );
}
