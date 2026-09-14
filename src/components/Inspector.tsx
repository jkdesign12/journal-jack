'use client';

import { useEffect, useRef, useState } from 'react';
import { Popover } from './Popover';
import { TagField } from './TagField';
import { store } from '@/lib/client/store';
import { srcFor } from '@/lib/client/media';
import { knownTags, setTags, tagsOf } from '@/lib/journal/tags';
import { everyBlock } from '@/lib/journal/sort';
import { SIZES, type Block, type Size } from '@/lib/journal/types';
import { sizeOf } from '@/lib/journal/layout';
import { MONTHS } from '@/lib/journal/dates';

const SIZE_LABEL: Record<Size, string> = { sm: 'Small', md: 'Medium', lg: 'Large' };

export function Inspector({
  block,
  onClose,
  onChange,
  onRemove,
  onMoved,
}: {
  block: Block;
  onClose: () => void;
  onChange: () => void;
  onRemove: (id: string) => void;
  onMoved: (message: string) => void;
}) {
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void srcFor(block).then((url) => alive && setPreview(url));
    return () => {
      alive = false;
    };
  }, [block]);

  const edit = (patch: Partial<Block>) => {
    Object.assign(block, patch);
    onChange();
  };

  /* A cover you type in is the one you want, so it is marked as yours and the
     lookups stop trying to find another. Emptying the field hands that job
     back. The measured shape goes with the old picture. */
  const poster = useRef<HTMLInputElement>(null);
  const setPoster = (url: string) => {
    edit({ src: url, ratio: undefined, srcByHand: url ? true : undefined });
  };

  /* Escape closes the panel without the field ever blurring, and what you had
     just typed went with it — which reads as the app overruling your URL. What
     is in the box when the panel goes is what you meant. */
  useEffect(
    () => {
      // held from here: React has already let go of the ref by the time a
      // cleanup runs, so reading it then finds nothing
      const el = poster.current;
      return () => {
        if (el && el.value.trim() !== (block.src ?? '')) setPoster(el.value.trim());
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const tags = tagsOf(block);
  const choices = knownTags(everyBlock(store.doc));

  const commitTags = (next: string[]) => {
    setTags(block, next, choices);
    onChange();
  };

  /* Dating a block is also filing it: a photo uploaded in September but taken
     in June belongs in June, so a date outside the month on screen moves it. */
  const setDate = (value: string) => {
    const moved = store.setBlockDate(block, value);
    onChange();
    if (moved) {
      const [y, m] = moved.split('-').map(Number);
      onMoved(`Moved to ${MONTHS[m - 1]} ${y}`);
      onClose();
    }
  };

  const isMedia = block.kind === 'photo' || block.kind === 'media';

  return (
    <Popover title={block.source ? block.source : block.kind} onClose={onClose} wide>
      {preview ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="max-h-[38vh] w-full rounded-xl object-contain" src={preview} alt="" />
      ) : null}

      {isMedia ? (
        <>
          <Field label="Title">
            <input
              className="field"
              value={block.title ?? ''}
              onChange={(e) => edit({ title: e.target.value })}
            />
          </Field>

          <Field label="Subtitle">
            <input
              className="field"
              value={block.subtitle ?? ''}
              onChange={(e) => edit({ subtitle: e.target.value })}
            />
          </Field>

          <Field label="Tags">
            <TagField tags={tags} choices={choices} onChange={commitTags} />
          </Field>
        </>
      ) : null}

      <Field label="Date">
        <div className="flex flex-wrap gap-2">
          <input
            className="field flex-1"
            type="date"
            value={block.date ?? ''}
            onChange={(e) => setDate(e.target.value)}
          />
          <button className="btn ghost" onClick={() => setDate('')}>
            No date
          </button>
        </div>
      </Field>

      {isMedia ? (
        <>
          <Field label="Rating (0–5)">
            <input
              className="field"
              type="number"
              min={0}
              max={5}
              step={0.5}
              value={block.rating ?? ''}
              onChange={(e) => edit({ rating: e.target.value === '' ? null : +e.target.value })}
            />
          </Field>

          {block.kind === 'media' ? (
            <Field label="Poster URL">
              {/* When a lookup picks the wrong film, or you want a specific one.
                  Typing one marks it as yours and the lookups leave it alone —
                  emptying the field is how you ask for one to be found again. */}
              <input
                ref={poster}
                className="field"
                defaultValue={block.src ?? ''}
                placeholder="https://…/poster.jpg"
                onBlur={(e) => setPoster(e.target.value.trim())}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') setPoster(e.currentTarget.value.trim());
                }}
              />
              {block.srcByHand ? (
                <p className="mt-1.5 text-[11px] text-ink-3">
                  Yours — nothing will look up another one. Clear it to go back to finding one.
                </p>
              ) : null}
            </Field>
          ) : null}
        </>
      ) : null}

      <Field label="Note">
        <textarea
          className="field min-h-[76px] resize-y"
          placeholder="what happened…"
          value={block.note ?? ''}
          onChange={(e) => edit({ note: e.target.value })}
        />
      </Field>

      <Field label="Size">
        <div className="flex flex-wrap gap-1.5">
          {SIZES.map((s) => (
            <button
              key={s}
              className={
                'rounded-lg border px-2.5 py-1.5 text-[12px] ' +
                (sizeOf(block) === s ? 'border-accent text-accent' : 'border-line text-ink-2')
              }
              onClick={() => edit({ size: s, uw: undefined, uh: undefined })}
            >
              {SIZE_LABEL[s]}
            </button>
          ))}
        </div>
      </Field>

      {block.url ? (
        <a
          className="text-[11.5px] text-accent"
          href={block.url}
          target="_blank"
          rel="noreferrer"
        >
          Open on {block.source ?? 'site'} ↗
        </a>
      ) : null}

      <button className="btn text-[#e2725b]" onClick={() => onRemove(block.id)}>
        Delete block
      </button>
    </Popover>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10.5px] uppercase tracking-[0.12em] text-ink-3">{label}</span>
      {children}
    </div>
  );
}
