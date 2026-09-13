'use client';

import { useEffect, useRef } from 'react';
import type { Block } from '@/lib/journal/types';
import { groupByMonth, type MonthGroup } from '@/lib/journal/sort';
import { Board } from './Board';

/**
 * A run of months of the same year, to be painted in that year's colours.
 *
 * Colours belong to the year rather than the month, so the band has to as well:
 * twelve separately painted months of one year would read as twelve changes of
 * paper rather than one year you are scrolling through.
 */
export interface YearBand {
  year: string;
  groups: MonthGroup[];
}

export function bandsOf(groups: MonthGroup[]): YearBand[] {
  const bands: YearBand[] = [];
  for (const group of groups) {
    const year = group.key.slice(0, 4);
    const last = bands.at(-1);
    if (last && last.year === year) last.groups.push(group);
    else bands.push({ year, groups: [group] });
  }
  return bands;
}

/** Where a band counts as "the one you are reading": just under the header. */
export const PROBE = 80;

/** Which band the probe line is inside, given where each one currently sits. */
export function bandAt(
  boxes: Array<{ key: string; top: number; bottom: number }>,
  probe = PROBE,
): string | null {
  for (const box of boxes) {
    if (box.top <= probe && box.bottom > probe) return box.key;
  }
  // above the first band — nothing has been scrolled to yet, so it is the one
  return boxes[0]?.key ?? null;
}

/**
 * The whole journal as a run of months, each under its own heading, on the
 * paper of the year it belongs to.
 *
 * One board per month rather than one long board: a month's tiles should pack
 * against each other and stop, so the gap before the next heading is real and
 * the sections cannot bleed into one another. The colour, though, runs behind
 * a whole year at once — the gaps between its months are part of the band, so
 * scrolling a year is scrolling one sheet of paper rather than twelve.
 */
export function MonthSections({
  blocks,
  home,
  styleFor,
  onReading,
  onOpen,
  onRemove,
  onCycleSize,
  onChange,
  onRefuse,
  onMeasured,
  selected,
  onSelect,
  renderWidget,
  empty,
}: {
  blocks: Block[];
  /** Which month each block is filed under, for the ones carrying no date. */
  home?: Map<string, string>;
  /** That month's custom properties — its year's colours, if it has any. */
  styleFor?: (monthKey: string) => Record<string, string>;
  /** The month whose band is under the header, as that changes with scrolling. */
  onReading?: (monthKey: string) => void;
  onOpen: (id: string) => void;
  onRemove: (id: string) => void;
  onCycleSize: (id: string) => void;
  onChange: () => void;
  onRefuse: (message: string) => void;
  onMeasured?: (id: string, ratio: number) => void;
  selected?: string | null;
  onSelect?: (id: string) => void;
  renderWidget?: (block: Block) => React.ReactNode;
  empty?: React.ReactNode;
}) {
  const groups = groupByMonth(blocks, home);
  const bands = bandsOf(groups);
  const reading = useReading(bands, onReading);

  if (!groups.length) return <>{empty}</>;

  return (
    <div className="flex flex-col">
      {bands.map((band) => (
        <div
          key={band.year || 'undated'}
          data-year={band.year}
          ref={reading(band.groups[0].key)}
          /* The year's own palette, set here rather than on the root element:
             in this view several years are on screen at once. Everything inside
             reads these — the tiles, the headings, the quieter greys — so a band
             is coherent without any of them being told about the year. */
          style={
            {
              ...styleFor?.(band.groups[0].key),
              background: 'var(--bg)',
              color: 'var(--ink)',
            } as React.CSSProperties
          }
          /* Pulled out to the window's edges: a year is a sheet of paper the
             journal is written on, not a card sitting on the page. */
          className="-mx-5 flex flex-col gap-10 px-5 py-9 max-[640px]:-mx-3 max-[640px]:px-3 max-[640px]:py-7"
        >
          {band.groups.map((group) => (
            <section key={group.key || 'undated'}>
              <h2 className="sticky top-[72px] z-20 mb-3 w-fit rounded-lg bg-bg/85 py-1.5 pr-3 font-serif text-[38px] font-semibold leading-none backdrop-blur-md max-[640px]:static max-[640px]:text-[29px]">
                {group.label}
                <span className="ml-3 align-middle text-[12px] font-sans font-medium tracking-[0.08em] text-ink-3">
                  {group.blocks.length}
                </span>
              </h2>

              <Board
                blocks={group.blocks}
                manual={false}
                onOpen={onOpen}
                onRemove={onRemove}
                onCycleSize={onCycleSize}
                onChange={onChange}
                onRefuse={onRefuse}
                onMeasured={onMeasured}
                selected={selected}
                onSelect={onSelect}
                renderWidget={renderWidget}
              />
            </section>
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * Tells the caller which band the page is scrolled to.
 *
 * The header sits over this view and takes its colours from the year you are
 * looking at, which in every other view is the month in the date control. Here
 * there is no one month on screen — scrolling is what changes the year — so the
 * band under the header is the answer, and it has to be recomputed as you move.
 */
function useReading(bands: YearBand[], onReading?: (monthKey: string) => void) {
  const elements = useRef(new Map<string, HTMLElement>());
  const last = useRef<string | null>(null);
  const keys = bands.map((band) => band.groups[0].key).join(',');

  useEffect(() => {
    if (!onReading) return;

    let frame = 0;
    const look = () => {
      frame = 0;
      const boxes = [...elements.current.entries()]
        .map(([key, el]) => {
          const box = el.getBoundingClientRect();
          return { key, top: box.top, bottom: box.bottom };
        })
        .sort((a, b) => a.top - b.top);

      const key = bandAt(boxes);
      if (key && key !== last.current) {
        last.current = key;
        onReading(key);
      }
    };

    // coalesced to a frame: this runs on every pixel of a scroll
    const queue = () => {
      if (!frame) frame = requestAnimationFrame(look);
    };

    look();
    window.addEventListener('scroll', queue, { passive: true });
    window.addEventListener('resize', queue);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', queue);
      window.removeEventListener('resize', queue);
    };
  }, [keys, onReading]);

  return (key: string) => (el: HTMLElement | null) => {
    if (el) elements.current.set(key, el);
    else elements.current.delete(key);
  };
}
