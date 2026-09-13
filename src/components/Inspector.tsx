'use client';

import { useEffect, useState } from 'react';
import { Popover } from './Popover';
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
  const [draftTag, setDraftTag] = useState('');

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

  const tags = tagsOf(block);
  const choices = knownTags(everyBlock(store.doc));

  const commitTags = (next: string[]) => {
    setTags(block, next, choices);
    setDraftTag('');
    onChange();
  };

  const addTyped = () => {
    const typed = draftTag.trim();
    if (!typed) return;
    // one box, several tags: "movie, rewatch" adds both
    commitTags([...tags, ...typed.split(',')]);
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
            <div className="flex flex-col gap-2">
              {tags.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {tags.map((t) => (
                    <span
                      key={t}
                      className="inline-flex items-center gap-1.5 rounded-full border border-line bg-bg-2 py-1 pl-3 pr-1.5 text-[11.5px] text-ink-2"
                    >
                      {t}
                      <button
                        className="flex h-[15px] w-[15px] items-center justify-center rounded-full text-[9px] text-ink-3 hover:bg-[#e2725b] hover:text-white"
                        title={`Remove ${t}`}
                        onClick={() => commitTags(tags.filter((x) => x !== t))}
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}

              <input
                className="field"
                list="tag-choices"
                spellCheck={false}
                placeholder={tags.length ? 'Add another…' : 'Movie, Book, Game…'}
                value={draftTag}
                onChange={(e) => setDraftTag(e.target.value)}
                onBlur={addTyped}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addTyped();
                  }
                  // backspace in an empty box takes the last chip off
                  if (e.key === 'Backspace' && !draftTag && tags.length) {
                    e.preventDefault();
                    commitTags(tags.slice(0, -1));
                  }
                }}
              />
              <datalist id="tag-choices">
                {choices.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </div>
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
              {/* when a lookup picks the wrong film, or you want a specific one */}
              <input
                className="field"
                defaultValue={block.src ?? ''}
                placeholder="https://…/poster.jpg"
                onBlur={(e) => edit({ src: e.target.value.trim(), ratio: undefined })}
              />
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
