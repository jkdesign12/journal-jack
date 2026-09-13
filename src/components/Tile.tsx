'use client';

import { useEffect, useState, type ReactNode } from 'react';
import type { Block } from '@/lib/journal/types';
import type { Item } from '@/lib/journal/layout';
import type { Corner } from '@/lib/client/placing';
import { tagsOf } from '@/lib/journal/tags';
import { hueOf } from '@/lib/journal/colours';
import { srcFor } from '@/lib/client/media';

const stars = (rating: number) =>
  '★'.repeat(Math.floor(rating)) + (rating % 1 >= 0.5 ? '½' : '');

const CORNERS: Corner[] = ['nw', 'ne', 'sw', 'se'];

const CORNER_AT: Record<Corner, string> = {
  nw: 'left-0 top-0 cursor-nwse-resize',
  ne: 'right-0 top-0 cursor-nesw-resize',
  sw: 'bottom-0 left-0 cursor-nesw-resize',
  se: 'bottom-0 right-0 cursor-nwse-resize',
};

export function Tile({
  block,
  item,
  metrics,
  dragging,
  onOpen,
  onRemove,
  onCycleSize,
  onPointerDown,
  onResizeFrom,
  body,
}: {
  block: Block;
  item: Item;
  metrics: { px: (n: number) => number; pitch: number };
  dragging?: boolean;
  onOpen: (id: string) => void;
  onRemove?: (id: string) => void;
  onCycleSize?: (id: string) => void;
  onPointerDown?: (e: React.PointerEvent) => void;
  onResizeFrom?: (e: React.PointerEvent, corner: Corner) => void;
  body?: ReactNode;
}) {
  const [url, setUrl] = useState<string | null>(block.src ?? null);

  useEffect(() => {
    let alive = true;
    void srcFor(block).then((found) => alive && setUrl(found));
    return () => {
      alive = false;
    };
  }, [block]);

  const tags = tagsOf(block);
  const label = tags.join(' · ') || block.source;
  const isVideo = /^video\//.test(block.mime ?? '');
  const isMedia = block.kind === 'photo' || block.kind === 'media';

  return (
    <article
      className={'tile group' + (dragging ? ' z-30 opacity-90 shadow-2xl' : '')}
      data-id={block.id}
      style={{
        left: item.gx * metrics.pitch,
        top: item.gy * metrics.pitch,
        width: metrics.px(item.w),
        height: metrics.px(item.h),
        transition: dragging ? 'none' : undefined,
      }}
      onPointerDown={onPointerDown}
      onDoubleClick={() => onOpen(block.id)}
    >
      {isMedia ? (
        url ? (
          isVideo ? (
            <video
              className="h-full w-full object-cover"
              src={url}
              muted
              loop
              playsInline
              onMouseEnter={(e) => void e.currentTarget.play().catch(() => {})}
              onMouseLeave={(e) => e.currentTarget.pause()}
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="h-full w-full object-cover" src={url} alt={block.title ?? ''} />
          )
        ) : (
          <div
            className="flex h-full w-full items-center justify-center font-serif text-2xl text-white/90"
            style={{ background: `hsl(${hueOf(block.title)}, 32%, 26%)` }}
          >
            {(block.title ?? '?').trim()[0]?.toUpperCase() ?? '?'}
          </div>
        )
      ) : (
        <div className="h-full w-full border border-line bg-panel">{body}</div>
      )}

      {/* Nothing sits on the artwork uninvited: where it came from, the day and
          the rating all wait for a hover, or a press on a touch screen. */}
      {isMedia && label ? (
        <span className="reveal absolute left-2 top-2 rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-white/90 backdrop-blur-sm">
          {label}
        </span>
      ) : null}

      {isMedia && block.day ? (
        <span className="reveal absolute right-2 top-2 rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] tabular-nums text-white/90 backdrop-blur-sm">
          {block.day}
        </span>
      ) : null}

      {isMedia && block.rating != null ? (
        <span className="reveal absolute bottom-2 right-2 text-[10px] text-white/90 [text-shadow:0_1px_2px_rgb(0_0_0/0.8)]">
          {stars(block.rating)}
        </span>
      ) : null}

      {isMedia && block.title ? (
        <div className="reveal pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent p-3">
          <b className="block truncate text-[13px] text-white">{block.title}</b>
          {block.subtitle ? (
            <span className="block truncate text-[11px] text-white/70">{block.subtitle}</span>
          ) : null}
          {block.note ? (
            <em className="mt-1 block line-clamp-2 text-[11px] not-italic text-white/60">
              {block.note.replace(/\s+/g, ' ')}
            </em>
          ) : null}
        </div>
      ) : null}

      {/* The three things you do to a tile without opening it. */}
      <div className="reveal absolute right-1.5 top-1.5 flex gap-1">
        {onCycleSize ? (
          <button
            className="flex h-6 w-6 items-center justify-center rounded-md bg-black/55 text-[11px] text-white/90 backdrop-blur-sm max-[640px]:h-[30px] max-[640px]:w-[30px]"
            title="Resize"
            onClick={(e) => {
              e.stopPropagation();
              onCycleSize(block.id);
            }}
          >
            ⤢
          </button>
        ) : null}
        <button
          className="flex h-6 w-6 items-center justify-center rounded-md bg-black/55 text-[11px] text-white/90 backdrop-blur-sm max-[640px]:h-[30px] max-[640px]:w-[30px]"
          title="Details"
          onClick={(e) => {
            e.stopPropagation();
            onOpen(block.id);
          }}
        >
          i
        </button>
        {onRemove ? (
          <button
            className="flex h-6 w-6 items-center justify-center rounded-md bg-black/55 text-[11px] text-white/90 backdrop-blur-sm max-[640px]:h-[30px] max-[640px]:w-[30px]"
            title="Remove"
            onClick={(e) => {
              e.stopPropagation();
              onRemove(block.id);
            }}
          >
            ✕
          </button>
        ) : null}
      </div>

      {/* Grab any corner to set the size by hand. Hidden on a touch screen,
          where there is no way to tell a resize from a scroll. */}
      {onResizeFrom
        ? CORNERS.map((corner) => (
            <div
              key={corner}
              className={
                'absolute h-4 w-4 opacity-0 group-hover:opacity-100 [@media(pointer:coarse)]:hidden ' +
                CORNER_AT[corner]
              }
              title="Drag to resize"
              data-corner={corner}
              onPointerDown={(e) => onResizeFrom(e, corner)}
            />
          ))
        : null}
    </article>
  );
}
