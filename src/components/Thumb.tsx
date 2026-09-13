'use client';

import { useEffect, useState } from 'react';
import { srcFor } from '@/lib/client/media';
import type { Block } from '@/lib/journal/types';

/** A small square of a block, for the calendar and its tray. */
export function Thumb({ block, onOpen }: { block: Block; onOpen: (id: string) => void }) {
  const [url, setUrl] = useState<string | null>(block.src ?? null);

  useEffect(() => {
    let alive = true;
    void srcFor(block).then((found) => alive && setUrl(found));
    return () => {
      alive = false;
    };
  }, [block]);

  return (
    <button
      className="h-14 w-14 overflow-hidden rounded-lg bg-black/20"
      title={block.title ?? ''}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/journal-block', block.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onClick={() => onOpen(block.id)}
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="h-full w-full object-cover" src={url} alt="" />
      ) : (
        <span className="flex h-full w-full items-center justify-center font-serif text-lg text-white/90">
          {(block.title ?? '?').trim()[0]?.toUpperCase() ?? '?'}
        </span>
      )}
    </button>
  );
}
