'use client';

import { useState } from 'react';
import { Popover } from './Popover';
import {
  COLOUR_PRESETS,
  DEFAULT_COLOURS,
  DEFAULT_SHADOW,
  SHADOW_DEFAULTS,
  colourYear,
  normaliseHex,
  yearKey,
} from '@/lib/journal/colours';
import type { JournalDoc, Palette, ShadowSettings } from '@/lib/journal/types';

const MAX_CUSTOM = 14;

const samePair = (a: Palette, b: Palette) =>
  (a.bg ?? '').toLowerCase() === (b.bg ?? '').toLowerCase() &&
  (a.ink ?? '').toLowerCase() === (b.ink ?? '').toLowerCase();

/**
 * Background and text belong to the year, not to each month: a journal reads as
 * a run of months, and changing the paper twelve times a year is not what you
 * want. The shadow is the exception — that is per month, with its own switch
 * for applying everywhere.
 */
export function ColourPicker({
  doc,
  cursor,
  theme,
  onChange,
  onClose,
}: {
  doc: JournalDoc;
  cursor: string;
  theme: 'dark' | 'light';
  onChange: () => void;
  onClose: () => void;
}) {
  const palette = colourYear(doc, cursor);
  const fallback = DEFAULT_COLOURS[theme];
  const [, redraw] = useState(0);
  const bump = () => {
    onChange();
    redraw((n) => n + 1);
  };

  const month = (doc.months[cursor] ??= { blocks: [], song: null });
  const shadowTarget = (): ShadowSettings => {
    if (!doc.shadowAll) return month;
    doc.shadowGlobal ??= {};
    return doc.shadowGlobal;
  };

  /* A pair you mixed yourself is kept so you can reach for it again: capped,
     newest first, and never duplicating something the list already offers. */
  const remember = (pair: Palette) => {
    if (!pair.bg && !pair.ink) return;
    doc.customColours ??= [];
    const known =
      COLOUR_PRESETS.some((p) => samePair(p, pair)) || doc.customColours.some((p) => samePair(p, pair));
    if (known) return;
    doc.customColours.unshift({ bg: pair.bg ?? null, ink: pair.ink ?? null });
    doc.customColours.length = Math.min(doc.customColours.length, MAX_CUSTOM);
  };

  const hidden = new Set(doc.hiddenPresets ?? []);
  const swatches = [
    ...COLOUR_PRESETS.filter((p) => !hidden.has(p.name)).map((p) => ({ p, custom: false })),
    ...(doc.customColours ?? []).map((c) => ({
      p: { name: c.bg ?? c.ink ?? 'custom', bg: c.bg ?? null, ink: c.ink ?? null },
      custom: true,
    })),
  ];

  const colourRow = (label: string, key: 'bg' | 'ink', fallbackValue: string) => {
    const current = palette[key] || fallbackValue;
    return (
      <label key={key} className="flex items-center justify-between gap-3 text-[12.5px]">
        <span>{label}</span>
        <span className="flex items-center gap-1.5">
          <input
            type="color"
            className="h-7 w-9 cursor-pointer rounded border border-line bg-transparent"
            value={current}
            onChange={(e) => {
              palette[key] = e.target.value;
              bump();
            }}
            onBlur={() => {
              remember({ bg: palette.bg, ink: palette.ink });
              bump();
            }}
          />
          <input
            className="field w-[9ch] px-2 py-1 text-[12px]"
            defaultValue={current}
            maxLength={7}
            spellCheck={false}
            aria-label={`${label} hex code`}
            onChange={(e) => {
              // accept what people actually paste: abc, #abc, AABBCC
              const parsed = normaliseHex(e.target.value);
              e.target.classList.toggle('border-[#e2725b]', !parsed);
              if (parsed) {
                palette[key] = parsed;
                bump();
              }
            }}
          />
        </span>
      </label>
    );
  };

  const slider = (label: string, key: 'shadowY' | 'shadowBlur', max: number, fallbackValue: number) => {
    const target = shadowTarget();
    const value = Number.isFinite(target[key]) ? (target[key] as number) : fallbackValue;
    return (
      <label className="flex items-center justify-between gap-3 text-[12.5px]">
        <span>{label}</span>
        <span className="flex items-center gap-2">
          <input
            type="range"
            className="w-[120px] accent-[var(--accent)]"
            min={0}
            max={max}
            value={value}
            onChange={(e) => {
              shadowTarget()[key] = Number(e.target.value);
              bump();
            }}
          />
          <span className="min-w-[4.5ch] text-right text-[11.5px] tabular-nums text-ink-3">
            {value}px
          </span>
        </span>
      </label>
    );
  };

  return (
    <Popover title={`Colours for ${yearKey(cursor)}`} onClose={onClose}>
      {colourRow('Background', 'bg', fallback.bg)}
      {colourRow('Text', 'ink', fallback.ink)}

      <label className="flex items-center justify-between gap-3 text-[12.5px]">
        <span>Drop shadow</span>
        <input
          type="checkbox"
          className="h-[17px] w-[17px] accent-[var(--accent)]"
          checked={!!shadowTarget().shadow}
          onChange={(e) => {
            shadowTarget().shadow = e.target.checked;
            bump();
          }}
        />
      </label>

      {shadowTarget().shadow ? (
        <>
          <label className="flex items-center justify-between gap-3 text-[12.5px]">
            <span>Shadow colour</span>
            <input
              type="color"
              className="h-7 w-9 cursor-pointer rounded border border-line bg-transparent"
              value={shadowTarget().shadowColour ?? DEFAULT_SHADOW}
              onChange={(e) => {
                shadowTarget().shadowColour = e.target.value;
                bump();
              }}
            />
          </label>
          {slider('Distance', 'shadowY', 40, SHADOW_DEFAULTS.y)}
          {slider('Blur', 'shadowBlur', 80, SHADOW_DEFAULTS.blur)}
        </>
      ) : null}

      <label className="flex items-center justify-between gap-3 text-[12.5px]">
        <span>Use on every month</span>
        <input
          type="checkbox"
          className="h-[17px] w-[17px] accent-[var(--accent)]"
          checked={!!doc.shadowAll}
          onChange={(e) => {
            /* Seed the shared setting from what is on screen, so ticking the box
               keeps the look you were just looking at. Each month's own settings
               are left underneath, and come back if you untick. */
            if (e.target.checked) {
              const from = doc.shadowGlobal ?? {};
              doc.shadowGlobal = {
                shadow: month.shadow !== undefined ? !!month.shadow : !!from.shadow,
                shadowColour: month.shadowColour ?? from.shadowColour ?? DEFAULT_SHADOW,
                shadowY: month.shadowY ?? from.shadowY ?? SHADOW_DEFAULTS.y,
                shadowBlur: month.shadowBlur ?? from.shadowBlur ?? SHADOW_DEFAULTS.blur,
              };
            }
            doc.shadowAll = e.target.checked;
            bump();
          }}
        />
      </label>

      <div className="grid grid-cols-3 gap-1.5">
        {swatches.map(({ p, custom }) => {
          const chosen = (palette.bg ?? null) === p.bg && (palette.ink ?? null) === p.ink;
          return (
            <span key={p.name + String(custom)} className="relative block">
              <button
                className={'w-full rounded-lg px-2 py-2 text-[11.5px] ' + (chosen ? 'ring-1 ring-accent' : '')}
                title={p.name}
                style={
                  p.bg
                    ? { background: p.bg, color: p.ink ?? undefined }
                    : { background: 'var(--bg-2)', color: 'var(--ink-2)' }
                }
                onClick={() => {
                  palette.bg = p.bg;
                  palette.ink = p.ink;
                  bump();
                }}
              >
                {p.name}
              </button>

              {/* Default is the reset, not a colour, so it stays put */}
              {p.name === 'Default' ? null : (
                <button
                  className="absolute -right-1.5 -top-1.5 flex h-[18px] w-[18px] items-center justify-center rounded-full border border-line bg-bg-2 text-[9px] text-ink-2 opacity-0 hover:bg-[#e2725b] hover:text-white focus:opacity-100 group-hover:opacity-100 [span:hover>&]:opacity-100"
                  title={`Remove ${p.name}`}
                  onClick={(e) => {
                    e.stopPropagation(); // removing is not choosing
                    if (custom) {
                      doc.customColours = (doc.customColours ?? []).filter((c) => !samePair(c, p));
                    } else {
                      doc.hiddenPresets = [...(doc.hiddenPresets ?? []), p.name];
                    }
                    bump();
                  }}
                >
                  ✕
                </button>
              )}
            </span>
          );
        })}
      </div>

      <p className="text-[11.5px] leading-relaxed text-ink-3">
        Background and text apply to every month of {yearKey(cursor)}. Panels, borders and the
        quieter greys are mixed from those two, so the year stays readable. The shadow belongs to
        this month unless you tick every month.
      </p>
    </Popover>
  );
}
