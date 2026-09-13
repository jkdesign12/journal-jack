'use client';

import { useEffect, useState, type ReactNode } from 'react';
import type { Block } from '@/lib/journal/types';
import type { Item } from '@/lib/journal/layout';
import type { Corner } from '@/lib/client/placing';
import { tagsOf } from '@/lib/journal/tags';
import { hueOf } from '@/lib/journal/colours';
import { srcFor } from '@/lib/client/media';
import { Account } from '@/lib/client/account';

const stars = (rating: number) => '★'.repeat(Math.floor(rating)) + (rating % 1 >= 0.5 ? '½' : '');

const CORNERS: Corner[] = ['nw', 'ne', 'sw', 'se'];

const CORNER_AT: Record<Corner, string> = {
  nw: 'left-0 top-0 cursor-nwse-resize',
  ne: 'right-0 top-0 cursor-nesw-resize',
  sw: 'bottom-0 left-0 cursor-nesw-resize',
  se: 'bottom-0 right-0 cursor-nwse-resize',
};

/**
 * Some sources give no artwork — a Letterboxd export carries titles and dates
 * but no posters — so those get a typeset card rather than a broken tile. The
 * colour comes from the title, so it is the same one every time.
 */
function PosterCard({ block }: { block: Block }) {
  return (
    <div
      className="poster flex h-full flex-col justify-end gap-1 p-3.5"
      style={{ ['--h' as string]: String(hueOf(block.title)) }}
    >
      <div className="poster-t font-serif text-[19px] leading-tight">{block.title || 'untitled'}</div>
      {block.subtitle ? (
        <div className="poster-s text-[11px] opacity-65">{block.subtitle}</div>
      ) : null}
      {block.rating != null ? (
        <div className="poster-r text-[11px]">{stars(block.rating)}</div>
      ) : null}
    </div>
  );
}

/**
 * A block whose file cannot be found. Saying which of the two possible reasons
 * it is saves guessing: the file is on another device and was never uploaded,
 * or you are signed out and it lives in a different browser.
 */
function MissingFile({ block }: { block: Block }) {
  const reason = Account.user ? 'not uploaded from the device that has it' : 'sign in to load it';

  return (
    <div className="flex h-full flex-col items-center justify-center gap-1.5 p-3 text-center">
      <div className="text-[22px] opacity-50">{block.kind === 'media' ? '◎' : '▢'}</div>
      <div className="text-[11.5px] text-ink-2">{block.title || 'missing file'}</div>
      {block.blobId ? <div className="text-[10.5px] leading-snug text-ink-3">{reason}</div> : null}
    </div>
  );
}

export function Tile({
  block,
  item,
  metrics,
  dragging,
  held,
  selected,
  onOpen,
  onSelect,
  onRemove,
  onCycleSize,
  onPointerDown,
  onResizeFrom,
  onMeasured,
  body,
}: {
  block: Block;
  item: Item;
  metrics: { px: (n: number) => number; pitch: number };
  dragging?: boolean;
  /** while carried, the tile follows the pointer rather than the grid */
  held?: { x: number; y: number } | null;
  selected?: boolean;
  onOpen: (id: string) => void;
  onSelect?: (id: string) => void;
  onRemove?: (id: string) => void;
  onCycleSize?: (id: string) => void;
  onPointerDown?: (e: React.PointerEvent) => void;
  onResizeFrom?: (e: React.PointerEvent, corner: Corner) => void;
  /** the picture's real proportions, once the browser has them */
  onMeasured?: (id: string, ratio: number) => void;
  body?: ReactNode;
}) {
  const [url, setUrl] = useState<string | null>(block.src ?? null);
  const [looked, setLooked] = useState(!!block.src);
  /* Which picture failed, rather than a flag: a flag has to be cleared when the
     source changes, and clearing it from the lookup that resolves afterwards
     un-breaks the one that just failed. Comparing urls needs no reset. */
  const [brokenUrl, setBrokenUrl] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void srcFor(block).then((found) => {
      if (!alive) return;
      setUrl(found);
      setLooked(true);
    });
    return () => {
      alive = false;
    };
  }, [block]);

  const tags = tagsOf(block);
  const label = tags.join(' · ') || block.source;
  const isVideo = /^video\//.test(block.mime ?? '');
  const isMedia = block.kind === 'photo' || block.kind === 'media';
  const broken = !!url && brokenUrl === url;

  /* An import with no artwork is a card. A photo whose file is nowhere is a
     different thing, and says so. Anything else is waiting for a picture. */
  const asCard = isMedia && (!url || broken) && looked;
  const missingFile = asCard && !!block.blobId;
  const showCard = asCard && !missingFile && block.kind === 'media';

  const measure = (w: number, h: number) => {
    if (!w || !h) return;
    const ratio = +(h / w).toFixed(4);
    if (block.ratio !== ratio) onMeasured?.(block.id, ratio);
  };

  return (
    <article
      className={
        'tile group' +
        (dragging ? ' is-dragging z-30' : '') +
        (selected ? ' is-sel' : '') +
        (showCard ? ' is-card' : '')
      }
      data-id={block.id}
      style={{
        left: held ? held.x : item.gx * metrics.pitch,
        top: held ? held.y : item.gy * metrics.pitch,
        width: metrics.px(item.w),
        height: metrics.px(item.h),
        transition: dragging ? 'none' : undefined,
      }}
      onPointerDown={onPointerDown}
      onClick={() => onSelect?.(block.id)}
      onDoubleClick={() => onOpen(block.id)}
    >
      {isMedia ? (
        missingFile ? (
          <MissingFile block={block} />
        ) : url && !broken ? (
          isVideo ? (
            <video
              className="h-full w-full object-cover"
              src={url}
              muted
              loop
              playsInline
              onLoadedMetadata={(e) => measure(e.currentTarget.videoWidth, e.currentTarget.videoHeight)}
              onMouseEnter={(e) => void e.currentTarget.play().catch(() => {})}
              onMouseLeave={(e) => e.currentTarget.pause()}
            />
          ) : (
            // no-referrer keeps Wikimedia and other CDNs from refusing the hotlink
            // eslint-disable-next-line @next/next/no-img-element
            <img
              className="h-full w-full object-cover"
              src={url}
              alt={block.title ?? ''}
              decoding="async"
              referrerPolicy="no-referrer"
              onLoad={(e) => measure(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)}
              // a poster URL that 404s should read as a card, not an empty tile
              onError={() => setBrokenUrl(url)}
            />
          )
        ) : showCard ? (
          <PosterCard block={block} />
        ) : (
          <div className="h-full w-full bg-bg-2" />
        )
      ) : (
        <div className="h-full w-full border border-line bg-panel">{body}</div>
      )}

      {/* Nothing sits on the artwork uninvited: where it came from, the day and
          the rating all wait for a hover, or a press on a touch screen. */}
      {isMedia && label ? (
        <span className="reveal badge absolute left-2 top-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-white backdrop-blur-sm">
          {label}
        </span>
      ) : null}

      {isMedia && block.day ? (
        <span className="reveal absolute bottom-2 left-2 rounded-md bg-accent px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-[#141210]">
          {block.day}
        </span>
      ) : null}

      {isMedia && block.rating != null ? (
        <span className="reveal absolute bottom-2 right-2.5 text-[11px] text-[#ffd28a] [text-shadow:0_1px_3px_rgb(0_0_0/0.8)]">
          {stars(block.rating)}
        </span>
      ) : null}

      {isMedia && block.title ? (
        <div className="reveal pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-2.5 pb-[30px] pt-6">
          <b className="block text-[12.5px] font-semibold leading-tight text-white">{block.title}</b>
          {block.subtitle ? (
            <span className="block text-[11px] text-white/75">{block.subtitle}</span>
          ) : null}
          {block.note ? (
            <em className="mt-1.5 line-clamp-4 block text-[11px] italic leading-relaxed text-white/90">
              {block.note.replace(/\s+/g, ' ')}
            </em>
          ) : null}
        </div>
      ) : null}

      {/* The three things you do to a tile without opening it. Shown on hover,
          and kept while the tile is selected. */}
      <div
        className={
          'tools absolute right-1.5 top-1.5 flex gap-1 transition-opacity ' +
          (selected ? '' : 'reveal')
        }
      >
        {onCycleSize ? (
          <ToolButton title="Resize" onClick={() => onCycleSize(block.id)}>
            ⤢
          </ToolButton>
        ) : null}
        <ToolButton title="Details" onClick={() => onOpen(block.id)}>
          i
        </ToolButton>
        {onRemove ? (
          <ToolButton title="Remove" onClick={() => onRemove(block.id)}>
            ✕
          </ToolButton>
        ) : null}
      </div>

      {/* Grab any corner to set the size by hand. The grips are invisible on
          purpose — the cursor changing is the whole affordance, and dots on
          every tile would clutter the board. */}
      {onResizeFrom
        ? CORNERS.map((corner) => (
            <div
              key={corner}
              className={'absolute h-5 w-5 z-[3] [@media(pointer:coarse)]:hidden ' + CORNER_AT[corner]}
              title="Drag to resize"
              data-corner={corner}
              onPointerDown={(e) => onResizeFrom(e, corner)}
            />
          ))
        : null}
    </article>
  );
}

function ToolButton({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      className="flex h-6 w-6 items-center justify-center rounded-[7px] bg-black/55 text-[12px] text-white backdrop-blur-sm hover:bg-accent hover:text-[#141210] max-[640px]:h-[30px] max-[640px]:w-[30px]"
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {children}
    </button>
  );
}
