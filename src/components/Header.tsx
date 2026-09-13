'use client';

import { MONTHS } from '@/lib/journal/dates';
import { SORT_LABELS, SORT_MODES, type SortMode } from '@/lib/journal/sort';
import type { ViewState } from '@/lib/client/view';

const button =
  'rounded-[9px] border border-line bg-panel px-3 py-1.5 text-[12.5px] font-medium whitespace-nowrap ' +
  'enabled:hover:border-accent enabled:hover:text-accent';

/** Everything the old app had here that this one has not brought back yet. */
export const NOT_YET = ['＋ Media', 'Widget'] as const;

export function Header({
  view,
  span,
  onShift,
  onView,
  onSort,
  onOpenMonths,
  onOpenAccount,
  onSync,
  signedIn,
  busy,
}: {
  view: ViewState;
  span: { first?: string; last?: string };
  onShift: (delta: number) => void;
  onView: (mode: 'grid' | 'calendar') => void;
  onSort: (mode: SortMode) => void;
  onOpenMonths: () => void;
  onOpenAccount: () => void;
  onSync: () => void;
  signedIn: boolean;
  busy: boolean;
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

  return (
    <header className="sticky top-0 z-40 flex flex-wrap items-center gap-4 border-b border-line bg-bg/85 px-5 py-3.5 backdrop-blur-md max-[640px]:static">
      <span className="font-serif text-[22px] whitespace-nowrap">
        journal<em className="not-italic text-brand">.jack</em>
      </span>

      <nav className="mx-auto flex items-center gap-1 max-[640px]:order-first max-[640px]:w-full max-[640px]:justify-center">
        <button
          className="flex h-8 w-8 items-center justify-center rounded-[9px] text-[17px] text-ink-2 hover:bg-bg-2 hover:text-ink max-[640px]:h-[46px] max-[640px]:w-[46px] max-[640px]:text-[27px]"
          onClick={() => onShift(-1)}
          title="Previous month"
          aria-label="Previous month"
        >
          ‹
        </button>

        <button
          className="flex items-baseline gap-2 rounded-[10px] px-3.5 py-1 hover:bg-bg-2"
          onClick={onOpenMonths}
        >
          <span className="font-serif text-[30px] leading-none">{title}</span>
          <span className="text-[13px] font-extrabold tracking-[0.14em] text-ink max-[640px]:text-[15px]">
            {subtitle}
          </span>
        </button>

        <button
          className="flex h-8 w-8 items-center justify-center rounded-[9px] text-[17px] text-ink-2 hover:bg-bg-2 hover:text-ink max-[640px]:h-[46px] max-[640px]:w-[46px] max-[640px]:text-[27px]"
          onClick={() => onShift(1)}
          title="Next month"
          aria-label="Next month"
        >
          ›
        </button>
      </nav>

      <div className="flex items-center gap-2 max-[640px]:w-full max-[640px]:flex-wrap">
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

        {/* Still to come. A button that looks clickable and does nothing is
            worse than one that admits it, so these say so rather than swallow
            the click — and a test holds them to it, which will fail the day one
            is wired up and left like this. */}
        {NOT_YET.map((label) => (
          <button
            key={label}
            className={button + ' cursor-not-allowed opacity-40'}
            disabled
            title={`${label} is not ported yet — it is coming back`}
          >
            {label}
          </button>
        ))}

        <button className={button} onClick={onSync} disabled={!signedIn || busy}>
          {busy ? 'Syncing…' : 'Sync'}
        </button>

        <button className={button} onClick={onOpenAccount}>
          {signedIn ? 'Account' : 'Sign in'}
        </button>
      </div>
    </header>
  );
}
