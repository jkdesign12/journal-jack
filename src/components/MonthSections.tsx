'use client';

import type { Block } from '@/lib/journal/types';
import { groupByMonth } from '@/lib/journal/sort';
import { Board } from './Board';

/**
 * The whole journal as a run of months, each under its own heading.
 *
 * One board per month rather than one long board: a month's tiles should pack
 * against each other and stop, so the gap before the next heading is real and
 * the sections cannot bleed into one another.
 */
export function MonthSections({
  blocks,
  home,
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
  if (!groups.length) return <>{empty}</>;

  return (
    <div className="flex flex-col gap-10">
      {groups.map((group) => (
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
  );
}
