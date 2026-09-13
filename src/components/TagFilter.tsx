'use client';

import { Popover } from './Popover';
import { UNTAGGED, tagsOf } from '@/lib/journal/tags';
import type { Block } from '@/lib/journal/types';

/**
 * Every tag in the journal with a switch, plus a row for the things that have
 * none. Counts come from the whole journal rather than the month on screen, so
 * the list does not rearrange itself as you move about.
 */
export function TagFilter({
  blocks,
  hidden,
  onChange,
  onClose,
}: {
  blocks: Block[];
  hidden: string[];
  onChange: (hidden: string[]) => void;
  onClose: () => void;
}) {
  const counts = new Map<string, number>();
  let untagged = 0;

  for (const b of blocks) {
    const tags = tagsOf(b);
    if (!tags.length) {
      untagged++;
      continue;
    }
    for (const t of tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  }

  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const off = new Set(hidden.map((t) => t.toLowerCase()));
  const isOn = (key: string) => !off.has(key.toLowerCase());

  const toggle = (key: string, on: boolean) => {
    const rest = hidden.filter((t) => t.toLowerCase() !== key.toLowerCase());
    onChange(on ? rest : [...rest, key]);
  };

  const everyKey = [...rows.map(([t]) => t), ...(untagged ? [UNTAGGED] : [])];

  const row = (key: string, label: string, count: number) => (
    <label
      key={key}
      className="flex cursor-pointer items-center justify-between gap-2.5 rounded-lg px-2 py-1.5 text-[12.5px] hover:bg-bg-2 max-[640px]:py-2.5 max-[640px]:text-[15px]"
    >
      <span className="flex min-w-0 items-center gap-2 truncate">
        <input
          type="checkbox"
          className="h-[15px] w-[15px] flex-none accent-[var(--accent)] max-[640px]:h-5 max-[640px]:w-5"
          checked={isOn(key)}
          onChange={(e) => toggle(key, e.target.checked)}
        />
        {label}
      </span>
      <span className="flex-none text-[11px] tabular-nums text-ink-3">{count}</span>
    </label>
  );

  return (
    <Popover title="Show" onClose={onClose}>
      {rows.length || untagged ? (
        <>
          <div className="flex max-h-[46vh] flex-col gap-0.5 overflow-auto">
            {rows.map(([t, n]) => row(t, t, n))}
            {untagged ? row(UNTAGGED, 'Untagged', untagged) : null}
          </div>

          <div className="flex gap-2">
            <button className="btn ghost flex-1" onClick={() => onChange([])}>
              All
            </button>
            <button className="btn ghost flex-1" onClick={() => onChange(everyKey)}>
              None
            </button>
          </div>
        </>
      ) : (
        <p className="text-[11.5px] text-ink-3">
          Nothing is tagged yet. Open a tile&rsquo;s details to give it one.
        </p>
      )}

      <p className="text-[11.5px] leading-relaxed text-ink-3">
        A tile with more than one tag needs all of them on, so turning one off takes those things
        off the board.
      </p>
    </Popover>
  );
}
