'use client';

import { useEffect, useRef, useState } from 'react';
import type { Block } from '@/lib/journal/types';
import { gridMetrics, layout, unitsOf, type Item, type Metrics } from '@/lib/journal/layout';
import { coarsePointer, commitMove, dropAt, resizeTo, type Corner } from '@/lib/client/placing';
import { Tile } from './Tile';

/**
 * The board measures itself and lays the tiles out in units, rather than handing
 * the work to CSS grid: a tile has to be able to sit exactly where you put it
 * and shove its neighbours down, which a grid template cannot express.
 */
export function Board({
  blocks,
  manual,
  onOpen,
  onRemove,
  onCycleSize,
  onChange,
  onRefuse,
  empty,
  renderWidget,
  selected,
  onSelect,
  onMeasured,
}: {
  blocks: Block[];
  manual: boolean;
  onOpen: (id: string) => void;
  onRemove: (id: string) => void;
  onCycleSize: (id: string) => void;
  onChange: () => void;
  onRefuse: (message: string) => void;
  empty?: React.ReactNode;
  renderWidget?: (block: Block) => React.ReactNode;
  selected?: string | null;
  onSelect?: (id: string) => void;
  onMeasured?: (id: string, ratio: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [touched, setTouched] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  /* Where the carried tile will land, and where it is under the pointer. The
     two differ on purpose: the tile follows your hand, the ghost snaps. */
  const [ghost, setGhost] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [held, setHeld] = useState<{ x: number; y: number } | null>(null);

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

  const placed = metrics ? layout(blocks, metrics, { manual, lastTouched: touched }) : null;
  const byId = new Map(blocks.map((b) => [b.id, b]));

  /* Placing and resizing stay on the mouse: on a touch screen a drag across a
     tile means "scroll the page", and taking that away to move a tile would
     make the board unusable to read. */
  const startPlacing = (e: React.PointerEvent, block: Block, item: Item) => {
    if (e.button !== 0 || coarsePointer() || !metrics || !placed) return;
    if ((e.target as HTMLElement).closest('input,textarea,select,button,a')) return;
    if (!manual) {
      onRefuse(
        blocks.length && !manual
          ? 'Switch the order dropdown to "Custom order" to move tiles'
          : 'Tiles are arranged inside their own month — open a month to move them',
      );
      return;
    }
    e.preventDefault();

    const board = ref.current!.getBoundingClientRect();
    const offX = e.clientX - board.left - item.gx * metrics.pitch;
    const offY = e.clientY - board.top - item.gy * metrics.pitch;
    setDragging(block.id);

    const move = (ev: PointerEvent) => {
      const x = ev.clientX - board.left - offX;
      const y = ev.clientY - board.top - offY;
      const to = dropAt(x, y, metrics, item.w);

      setHeld({ x, y });
      setGhost({ x: to.gx * metrics.pitch, y: to.gy * metrics.pitch, w: item.w, h: item.h });
    };

    const done = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', done);
      setDragging(null);
      setGhost(null);
      setHeld(null);
      setTouched(block.id);

      const to = dropAt(ev.clientX - board.left - offX, ev.clientY - board.top - offY, metrics, item.w);
      commitMove(placed.items, item, to, byId);
      onChange();
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', done);
  };

  const startResizing = (e: React.PointerEvent, block: Block, item: Item, corner: Corner) => {
    if (e.button !== 0 || coarsePointer() || !metrics) return;
    e.preventDefault();
    e.stopPropagation(); // not a placement drag
    if (!manual) {
      onRefuse('Switch the order dropdown to "Custom order" to resize tiles');
      return;
    }

    const start = { w: item.w, h: item.h, anchorX: item.gx, anchorY: item.gy, units: metrics.units };
    const from = { x: e.clientX, y: e.clientY };

    const move = (ev: PointerEvent) => {
      const next = resizeTo(
        start,
        corner,
        Math.round((ev.clientX - from.x) / metrics.pitch),
        Math.round((ev.clientY - from.y) / metrics.pitch),
      );
      Object.assign(item, next);
      setTouched(block.id);
      onChange();
    };

    const done = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', done);
      // the shape you chose wins over the tile's own proportions from now on
      block.uw = item.w;
      block.uh = item.h;
      block.gx = item.gx;
      block.gy = item.gy;
      onChange();
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', done);
  };

  return (
    <div
      ref={ref}
      className={'board' + (dragging ? ' is-placing' : '')}
      style={
        {
          height: placed && metrics ? placed.rows * metrics.pitch - metrics.gap : undefined,
          '--colw': metrics ? metrics.unit + 'px' : undefined,
          '--pitch': metrics ? metrics.pitch + 'px' : undefined,
        } as React.CSSProperties
      }
    >
      {/* the lanes a carried tile can land in, drawn from the same numbers the
          layout just used, so the squares line up with where tiles really go */}
      <div className="grid-guides" />

      {ghost && metrics ? (
        <div
          className="drop-ghost"
          style={{
            left: ghost.x,
            top: ghost.y,
            width: metrics.px(ghost.w),
            height: metrics.px(ghost.h),
          }}
        />
      ) : null}

      {placed && metrics
        ? placed.items.map((item) => {
            const block = byId.get(item.id);
            if (!block) return null;
            return (
              <Tile
                key={item.id}
                block={block}
                item={item}
                metrics={metrics}
                dragging={dragging === item.id}
                held={dragging === item.id ? held : null}
                selected={selected === item.id}
                onSelect={onSelect}
                onMeasured={onMeasured}
                onOpen={onOpen}
                onRemove={onRemove}
                onCycleSize={onCycleSize}
                onPointerDown={(e) => startPlacing(e, block, item)}
                onResizeFrom={(e, corner) => startResizing(e, block, item, corner)}
                body={renderWidget?.(block)}
              />
            );
          })
        : null}
    </div>
  );
}

export { unitsOf };
