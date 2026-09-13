'use client';

import { useState } from 'react';
import { MONTHS, cursorParts, monthKey } from '@/lib/journal/dates';
import { everyBlock } from '@/lib/journal/sort';
import type { JournalDoc } from '@/lib/journal/types';
import type { ViewState } from '@/lib/client/view';

/** Jump to a month, or open every month at once. */
export function MonthPicker({
  doc,
  view,
  onPick,
  onAll,
  onClose,
}: {
  doc: JournalDoc;
  view: ViewState;
  onPick: (cursor: string) => void;
  onAll: () => void;
  onClose: () => void;
}) {
  const here = cursorParts(view.cursor);
  const [year, setYear] = useState(here.year);
  const count = everyBlock(doc).length;

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/45" onClick={onClose} />

      <div className="fixed left-1/2 top-20 z-[80] w-[min(340px,94vw)] -translate-x-1/2 rounded-2xl border border-line bg-panel p-3 shadow-[var(--shadow)] max-[640px]:p-3.5">
        <div className="mb-2 flex items-center justify-between font-serif text-[19px] max-[640px]:text-[23px]">
          <button
            className="flex h-8 w-8 items-center justify-center rounded-[9px] text-ink-2 hover:bg-bg-2 hover:text-ink max-[640px]:h-[46px] max-[640px]:w-[46px] max-[640px]:text-[27px]"
            onClick={() => setYear((y) => y - 1)}
            aria-label="Previous year"
          >
            ‹
          </button>
          <span>{year}</span>
          <button
            className="flex h-8 w-8 items-center justify-center rounded-[9px] text-ink-2 hover:bg-bg-2 hover:text-ink max-[640px]:h-[46px] max-[640px]:w-[46px] max-[640px]:text-[27px]"
            onClick={() => setYear((y) => y + 1)}
            aria-label="Next year"
          >
            ›
          </button>
        </div>

        <div className="grid grid-cols-3 gap-[5px] max-[640px]:gap-2">
          {MONTHS.map((name, i) => {
            const key = monthKey(year, i + 1);
            const has = !!doc.months[key]?.blocks?.length;
            const current = !view.all && year === here.year && i + 1 === here.month;
            return (
              <button
                key={key}
                className={
                  'rounded-[9px] px-3 py-2.5 text-[12.5px] max-[640px]:px-2 max-[640px]:py-[15px] max-[640px]:text-base ' +
                  (current
                    ? 'bg-accent font-semibold text-[#141210]'
                    : 'text-ink-2 hover:bg-bg-2 hover:text-ink')
                }
                onClick={() => onPick(key)}
              >
                {name.slice(0, 3)}
                {has ? ' •' : ''}
              </button>
            );
          })}
        </div>

        {/* Every month at once. It sits under the twelve rather than among
            them, because it is not one of them. */}
        <div className="mt-2 border-t border-line pt-2">
          <button
            className={
              'w-full rounded-[9px] border px-3 py-2.5 text-[13px] max-[640px]:py-[15px] max-[640px]:text-[15px] ' +
              (view.all
                ? 'border-accent text-accent'
                : 'border-line text-ink-2 hover:bg-bg-2 hover:text-ink')
            }
            onClick={onAll}
          >
            All{count ? ` · ${count} item${count === 1 ? '' : 's'}` : ''}
          </button>
        </div>
      </div>
    </>
  );
}
