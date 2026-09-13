'use client';

import { useState } from 'react';
import { DOW, monthShape } from '@/lib/journal/dates';
import type { Block } from '@/lib/journal/types';
import { Thumb } from './Thumb';

/**
 * The month as days rather than as a board.
 *
 * Day squares are filled with the text colour and numbered in the background
 * colour — the inverse of everything else on the page, so the shape of the
 * month reads at a glance instead of being a grid of outlines.
 */
export function Calendar({
  cursor,
  blocks,
  onOpen,
  onDropOn,
  onFilesOn,
  onAddOn,
}: {
  cursor: string;
  blocks: Block[];
  onOpen: (id: string) => void;
  onDropOn: (id: string, day: number) => void;
  onFilesOn: (files: FileList, day: number) => void;
  onAddOn?: (day: number) => void;
}) {
  const { firstDay, days } = monthShape(cursor);
  const [over, setOver] = useState<number | null>(null);
  const today = new Date();
  const [year, month] = cursor.split('-').map(Number);

  const media = blocks.filter((b) => b.kind === 'photo' || b.kind === 'media');
  const loose = media.filter((b) => !b.day);

  return (
    <>
      <div className="mb-2 hidden grid-cols-7 gap-2 text-[10.5px] uppercase tracking-[0.12em] text-ink-3 min-[761px]:grid">
        {DOW.map((d) => (
          <div key={d}>{d}</div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2 min-[761px]:grid-cols-7">
        {/* the blanks before the first only make sense in a seven-wide month */}
        {Array.from({ length: firstDay }, (_, i) => (
          <div key={`pad-${i}`} className="hidden min-[761px]:block" />
        ))}

        {Array.from({ length: days }, (_, i) => {
          const day = i + 1;
          const isToday =
            today.getFullYear() === year && today.getMonth() + 1 === month && today.getDate() === day;
          const mine = media.filter((b) => b.day === day);
          const notes = blocks.filter((b) => b.day === day && b.kind === 'note' && b.text);

          return (
            <div
              key={day}
              className={
                'min-h-[104px] rounded-xl border border-[var(--ink)] bg-[var(--ink)] p-2 ' +
                (isToday ? 'outline outline-2 -outline-offset-2 outline-accent ' : '') +
                (over === day ? 'brightness-90 ' : '')
              }
              onDragOver={(e) => {
                e.preventDefault();
                setOver(day);
              }}
              onDragLeave={() => setOver(null)}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setOver(null);
                const id = e.dataTransfer.getData('text/journal-block');
                if (id) onDropOn(id, day);
                else if (e.dataTransfer.files?.length) onFilesOn(e.dataTransfer.files, day);
              }}
              onDoubleClick={() => onAddOn?.(day)}
            >
              <div className="mb-1.5 text-[13px] font-extrabold text-[var(--bg)]">
                {String(day).padStart(2, '0')}
              </div>

              <div className="flex flex-wrap gap-1">
                {mine.slice(0, 6).map((b) => (
                  <Thumb key={b.id} block={b} onOpen={onOpen} />
                ))}
              </div>

              {mine.length > 6 ? (
                <div className="mt-1 text-[11px] font-semibold text-[var(--bg)]/80">
                  +{mine.length - 6} more
                </div>
              ) : null}

              {notes.map((n) => (
                <div key={n.id} className="mt-1 text-[11px] text-[var(--bg)]/80">
                  {n.text!.slice(0, 60)}
                </div>
              ))}
            </div>
          );
        })}
      </div>

      <div className="mt-6 border-t border-line pt-3.5">
        <div className="mb-2.5 text-[10.5px] uppercase tracking-[0.12em] text-ink-3">
          Unscheduled — drag onto a day
        </div>
        <div className="flex flex-wrap gap-2">
          {loose.length ? (
            loose.map((b) => <Thumb key={b.id} block={b} onOpen={onOpen} />)
          ) : (
            <span className="text-[11.5px] text-ink-3">
              Everything is dated. Drop photos on a day to add them straight to it.
            </span>
          )}
        </div>
      </div>
    </>
  );
}
