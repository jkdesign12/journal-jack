/* A year's own background and text colour.
 *
 * Only those two are stored. Everything else the interface needs — panels,
 * borders, the quieter greys — is mixed between them, so a year stays coherent
 * whatever pair you pick, and readable text is never left sitting on a
 * background it cannot be seen against.
 *
 * Colours belong to the year rather than the month: a journal reads as a run of
 * months, and changing the paper twelve times a year is not what you want.
 */

import type { JournalDoc, Month, Palette, ShadowSettings } from './types';

export const DEFAULT_COLOURS = {
  dark: { bg: '#0e0e10', ink: '#f2efe9' },
  light: { bg: '#f6f2ea', ink: '#201d18' },
} as const;

export const DEFAULT_SHADOW = '#000000';
export const SHADOW_DEFAULTS = { y: 10, blur: 26 }; // how far it drops, how soft

export const COLOUR_PRESETS: Array<{ name: string; bg: string | null; ink: string | null }> = [
  { name: 'Default', bg: null, ink: null },
  { name: 'Paper', bg: '#f6f2ea', ink: '#201d18' },
  { name: 'Midnight', bg: '#0b0f1a', ink: '#e6ecff' },
  { name: 'Forest', bg: '#0f1a14', ink: '#e8f3ea' },
  { name: 'Oxblood', bg: '#1a0e10', ink: '#f5e6e6' },
  { name: 'Sand', bg: '#ece3d2', ink: '#3a3222' },
  { name: 'Slate', bg: '#16181c', ink: '#dfe3e8' },
  { name: 'Bubblegum', bg: '#f2c6d5', ink: '#3d1020' },
];

export const yearKey = (monthKey: string): string => String(monthKey ?? '').slice(0, 4);

export function colourYear(doc: JournalDoc, monthKey: string): Palette {
  doc.yearColours ??= {};
  const y = yearKey(monthKey);
  doc.yearColours[y] ??= {};
  return doc.yearColours[y];
}

/* ---- hex ---- */

export function normaliseHex(value: string): string | null {
  const raw = String(value ?? '').trim().replace(/^#/, '');
  // accept what people actually paste: abc, #abc, AABBCC, with stray spaces
  if (/^[0-9a-f]{3}$/i.test(raw)) {
    return '#' + raw.split('').map((c) => c + c).join('').toLowerCase();
  }
  if (/^[0-9a-f]{6}$/i.test(raw)) return '#' + raw.toLowerCase();
  return null;
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const value = normaliseHex(hex);
  if (!value) return null;
  return {
    r: parseInt(value.slice(1, 3), 16),
    g: parseInt(value.slice(3, 5), 16),
    b: parseInt(value.slice(5, 7), 16),
  };
}

const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));

export const rgbToHex = ({ r, g, b }: { r: number; g: number; b: number }): string =>
  '#' + [r, g, b].map((n) => clamp(n).toString(16).padStart(2, '0')).join('');

/** `t` of the way from `a` towards `b`. */
export function mixHex(a: string, b: string, t: number): string {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  if (!x || !y) return a;
  return rgbToHex({
    r: x.r + (y.r - x.r) * t,
    g: x.g + (y.g - x.g) * t,
    b: x.b + (y.b - x.b) * t,
  });
}

/**
 * The custom properties to put on the root element for this month.
 *
 * Returns only what should be set; anything absent means "let the theme decide",
 * which is what clearing a year's colours does.
 */
export function monthStyle(
  doc: JournalDoc,
  monthKey: string,
  theme: 'dark' | 'light',
): Record<string, string> {
  const out: Record<string, string> = {};
  const year = colourYear(doc, monthKey);
  const fallback = DEFAULT_COLOURS[theme];

  /* The tile shadow is its own switch, so it works whether or not the year has
     custom colours. When it is set to apply everywhere it is read from the
     journal instead of the month, so every month — including ones that do not
     exist yet — picks it up without copying anything around. */
  const month: Month | undefined = doc.months[monthKey];
  const from: ShadowSettings = (doc.shadowAll ? doc.shadowGlobal : month) ?? {};

  if (from.shadow) {
    const c = hexToRgb(from.shadowColour ?? DEFAULT_SHADOW) ?? { r: 0, g: 0, b: 0 };
    const drop = Number.isFinite(from.shadowY) ? from.shadowY! : SHADOW_DEFAULTS.y;
    const blur = Number.isFinite(from.shadowBlur) ? from.shadowBlur! : SHADOW_DEFAULTS.blur;
    // laid on at partial strength: a fully opaque shadow reads as a border
    out['--tile-shadow'] = `0 ${drop}px ${blur}px rgba(${c.r}, ${c.g}, ${c.b}, .5)`;
  }

  const bg = year.bg || null;
  const ink = year.ink || null;
  if (!bg && !ink) return out;

  const base = bg || fallback.bg;
  const text = ink || fallback.ink;

  out['--bg'] = base;
  out['--bg-2'] = mixHex(base, text, 0.06);
  out['--panel'] = mixHex(base, text, 0.1);
  out['--line'] = mixHex(base, text, 0.2);
  out['--ink'] = text;
  out['--ink-2'] = mixHex(text, base, 0.35);
  out['--ink-3'] = mixHex(text, base, 0.58);
  return out;
}

/**
 * A colour for a tile with no artwork, taken from its title so it stays the
 * same every time the board redraws rather than flickering on each render.
 */
export function hueOf(title: string | undefined): number {
  return [...(title || 'x')].reduce((a, c) => a + c.charCodeAt(0) * 7, 0) % 360;
}
