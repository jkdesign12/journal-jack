'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import type { Block } from '@/lib/journal/types';
import type { Item } from '@/lib/journal/layout';
import { tagsOf } from '@/lib/journal/tags';
import { srcFor } from '@/lib/client/media';

const stars = (rating: number) => '★'.repeat(Math.round(rating)) + '☆'.repeat(5 - Math.round(rating));

/** A colour for a tile with no artwork, taken from its title so it stays put. */
function hueOf(title = ''): number {
  let h = 0;
  for (let i = 0; i < title.length; i++) h = (h * 31 + title.charCodeAt(i)) % 360;
  return h;
}

export function Tile({
  block,
  item,
  metrics,
  onOpen,
}: {
  block: Block;
  item: Item;
  metrics: { px: (n: number) => number; pitch: number };
  onOpen: (id: string) => void;
}) {
  const [url, setUrl] = useState<string | null>(block.src ?? null);

  useEffect(() => {
    let alive = true;
    void srcFor(block).then((found) => {
      if (alive) setUrl(found);
    });
    return () => {
      alive = false;
    };
  }, [block]);

  const tags = tagsOf(block);
  const label = tags.join(' · ') || block.source;
  const isVideo = /^video\//.test(block.mime ?? '');

  return (
    <article
      className="tile group"
      data-id={block.id}
      style={{
        left: item.gx * metrics.pitch,
        top: item.gy * metrics.pitch,
        width: metrics.px(item.w),
        height: metrics.px(item.h),
      }}
      onDoubleClick={() => onOpen(block.id)}
    >
      {url ? (
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
          <Image
            className="h-full w-full object-cover"
            src={url}
            alt={block.title ?? ''}
            fill
            unoptimized
            sizes="(max-width: 560px) 50vw, 25vw"
          />
        )
      ) : (
        <div
          className="flex h-full w-full items-center justify-center font-serif text-2xl text-white/90"
          style={{ background: `hsl(${hueOf(block.title)} 32% 26%)` }}
        >
          {(block.title ?? '?').trim()[0]?.toUpperCase() ?? '?'}
        </div>
      )}

      {/* Nothing sits on the artwork uninvited: where it came from, the day and
          the rating all wait for a hover, or a press on a touch screen. */}
      {label ? (
        <span className="reveal absolute left-2 top-2 rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-white/90 backdrop-blur-sm">
          {label}
        </span>
      ) : null}

      {block.day ? (
        <span className="reveal absolute right-2 top-2 rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] tabular-nums text-white/90 backdrop-blur-sm">
          {block.day}
        </span>
      ) : null}

      {block.rating != null ? (
        <span className="reveal absolute bottom-2 right-2 text-[10px] text-white/90 [text-shadow:0_1px_2px_rgb(0_0_0/0.8)]">
          {stars(block.rating)}
        </span>
      ) : null}

      {block.title ? (
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
    </article>
  );
}
