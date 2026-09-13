'use client';

import { useEffect, useRef, useState } from 'react';
import type { Block } from '@/lib/journal/types';
import { gridMetrics, layout, type Metrics } from '@/lib/journal/layout';
import { Tile } from './Tile';

/**
 * The board measures itself and lays the tiles out in units, rather than
 * handing the work to CSS grid: a tile has to be able to sit exactly where you
 * put it and shove its neighbours down, which a grid template cannot express.
 */
export function Board({
  blocks,
  manual,
  lastTouched,
  onOpen,
  empty,
}: {
  blocks: Block[];
  manual: boolean;
  lastTouched?: string | null;
  onOpen: (id: string) => void;
  empty?: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const measure = () => setMetrics(gridMetrics(node.clientWidth));
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  if (!blocks.length) {
    return (
      <div ref={ref} className="flex min-h-[40vh] items-center justify-center">
        {empty}
      </div>
    );
  }

  const placed = metrics ? layout(blocks, metrics, { manual, lastTouched }) : null;
  const byId = new Map(blocks.map((b) => [b.id, b]));

  return (
    <div
      ref={ref}
      className="board"
      style={{ height: placed && metrics ? placed.rows * metrics.pitch - metrics.gap : undefined }}
    >
      {placed && metrics
        ? placed.items.map((item) => {
            const block = byId.get(item.id);
            if (!block) return null;
            return (
              <Tile key={item.id} block={block} item={item} metrics={metrics} onOpen={onOpen} />
            );
          })
        : null}
    </div>
  );
}
