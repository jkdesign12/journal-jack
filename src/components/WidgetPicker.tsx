'use client';

import { Popover } from './Popover';
import { WIDGETS } from './Widget';
import type { Block } from '@/lib/journal/types';

/** The things you can put on a board that are not photos or imports. */
export function WidgetPicker({
  onPick,
  onClose,
}: {
  onPick: (kind: Block['kind']) => void;
  onClose: () => void;
}) {
  return (
    <Popover title="Add a widget" onClose={onClose}>
      {WIDGETS.map((w) => (
        <button
          key={w.kind}
          className="rounded-[9px] px-3 py-2.5 text-left text-[13px] hover:bg-bg-2 max-[640px]:py-3.5 max-[640px]:text-[15px]"
          onClick={() => onPick(w.kind)}
        >
          {w.label}
        </button>
      ))}
    </Popover>
  );
}
