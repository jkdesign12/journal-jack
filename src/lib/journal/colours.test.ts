import { describe, it, expect } from 'vitest';
import { colourYear, hexToRgb, hueOf, mixHex, monthStyle, normaliseHex, rgbToHex } from './colours';
import type { JournalDoc } from './types';

const doc = (over: Partial<JournalDoc> = {}): JournalDoc => ({ months: {}, ...over });

describe('reading a colour someone typed', () => {
  it('accepts what people actually paste', () => {
    expect(normaliseHex('#aabbcc')).toBe('#aabbcc');
    expect(normaliseHex('AABBCC')).toBe('#aabbcc');
    expect(normaliseHex('  #AaBbCc  ')).toBe('#aabbcc');
  });

  it('expands the three-character form', () => {
    expect(normaliseHex('#abc')).toBe('#aabbcc');
    expect(normaliseHex('f00')).toBe('#ff0000');
  });

  it('refuses anything that is not a colour', () => {
    expect(normaliseHex('hello')).toBeNull();
    expect(normaliseHex('#12345')).toBeNull();
    expect(normaliseHex('')).toBeNull();
    expect(normaliseHex('#gggggg')).toBeNull();
  });

  it('survives a round trip through rgb', () => {
    expect(rgbToHex(hexToRgb('#3a7f2c')!)).toBe('#3a7f2c');
  });

  it('clamps a mix that would leave the range', () => {
    expect(rgbToHex({ r: 300, g: -20, b: 128 })).toBe('#ff0080');
  });
});

describe('mixing the greys a year needs', () => {
  it('lands on each end when it is asked to', () => {
    expect(mixHex('#000000', '#ffffff', 0)).toBe('#000000');
    expect(mixHex('#000000', '#ffffff', 1)).toBe('#ffffff');
  });

  it('meets in the middle', () => {
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
  });

  it('gives back what it was given when a colour makes no sense', () => {
    expect(mixHex('nonsense', '#ffffff', 0.5)).toBe('nonsense');
  });
});

describe('the colours a month is drawn in', () => {
  it('says nothing when the year has no colours of its own', () => {
    expect(monthStyle(doc(), '2026-09', 'dark')).toEqual({});
  });

  it('mixes panels and greys from the pair you picked', () => {
    const style = monthStyle(
      doc({ yearColours: { '2026': { bg: '#000000', ink: '#ffffff' } } }),
      '2026-09',
      'dark',
    );
    expect(style['--bg']).toBe('#000000');
    expect(style['--ink']).toBe('#ffffff');
    // everything between the two is derived, so a year stays readable
    expect(style['--panel']).toBe('#1a1a1a');
    expect(style['--line']).toBe('#333333');
    expect(style['--ink-2']).toBe('#a6a6a6');
  });

  it('colours a whole year, not one month of it', () => {
    const d = doc({ yearColours: { '2026': { bg: '#102030', ink: '#f0f0f0' } } });
    expect(monthStyle(d, '2026-01', 'dark')['--bg']).toBe('#102030');
    expect(monthStyle(d, '2026-12', 'dark')['--bg']).toBe('#102030');
    expect(monthStyle(d, '2025-06', 'dark')['--bg']).toBeUndefined();
  });

  it('fills in the missing half from the theme', () => {
    const style = monthStyle(doc({ yearColours: { '2026': { bg: '#123456' } } }), '2026-09', 'light');
    expect(style['--bg']).toBe('#123456');
    expect(style['--ink']).toBe('#201d18'); // the light theme's text colour
  });

  it('takes a month’s own shadow', () => {
    const d = doc({
      months: { '2026-09': { blocks: [], shadow: true, shadowColour: '#ff0000', shadowY: 4, shadowBlur: 8 } },
    });
    expect(monthStyle(d, '2026-09', 'dark')['--tile-shadow']).toBe('0 4px 8px rgba(255, 0, 0, .5)');
  });

  it('prefers the shared shadow when it is set to apply everywhere', () => {
    const d = doc({
      shadowAll: true,
      shadowGlobal: { shadow: true, shadowColour: '#000000', shadowY: 2, shadowBlur: 3 },
      months: { '2026-09': { blocks: [], shadow: true, shadowY: 40, shadowBlur: 60 } },
    });
    // including for a month that does not exist yet
    expect(monthStyle(d, '2030-01', 'dark')['--tile-shadow']).toBe('0 2px 3px rgba(0, 0, 0, .5)');
    expect(monthStyle(d, '2026-09', 'dark')['--tile-shadow']).toBe('0 2px 3px rgba(0, 0, 0, .5)');
  });

  it('makes a year an entry the first time it is asked about', () => {
    const d = doc();
    const palette = colourYear(d, '2026-09');
    palette.bg = '#abcdef';
    expect(d.yearColours!['2026'].bg).toBe('#abcdef');
  });
});

describe('the colour a tile falls back to', () => {
  it('is the same every time for the same title, so it does not flicker', () => {
    expect(hueOf('Perfect Blue')).toBe(hueOf('Perfect Blue'));
  });

  it('differs between titles, so a board of placeholders is readable', () => {
    expect(hueOf('Perfect Blue')).not.toBe(hueOf('Tokyo Godfathers'));
  });

  it('always lands on a real hue, even with nothing to go on', () => {
    for (const title of ['', undefined, 'a', '日本語', '🎬']) {
      const hue = hueOf(title);
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(360);
    }
  });
});
