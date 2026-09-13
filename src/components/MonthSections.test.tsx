/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MonthSections } from './MonthSections';
import type { Block } from '@/lib/journal/types';

/* The everything view, read as a run of months rather than one long board. */

vi.mock('@/lib/client/media', () => ({
  srcFor: async (b: Block) => b.src ?? null,
  forgetBlobUrl: () => {},
}));

const film = (id: string, date: string | null): Block => ({
  id,
  kind: 'media',
  title: id,
  date,
  src: '',
});

/* jsdom lays nothing out, so every element is zero wide and a board draws no
   tiles at all. Giving it a width is what lets this check which month a tile
   actually landed under. */
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 1000 });
});

const handlers = {
  onOpen: vi.fn(),
  onRemove: vi.fn(),
  onCycleSize: vi.fn(),
  onChange: vi.fn(),
  onRefuse: vi.fn(),
};

const draw = (
  blocks: Block[],
  empty?: React.ReactNode,
  home?: Map<string, string>,
  styleFor?: (monthKey: string) => Record<string, string>,
) =>
  render(
    <MonthSections blocks={blocks} home={home} styleFor={styleFor} empty={empty} {...handlers} />,
  );

describe('the journal read by month', () => {
  it('gives each month a heading of its own', () => {
    draw([film('a', '2020-05-02'), film('b', '2020-06-11')]);
    expect(screen.getByRole('heading', { name: /May 2020/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /June 2020/ })).toBeInTheDocument();
  });

  it('runs forwards, so scrolling down is scrolling through time', () => {
    draw([film('later', '2026-03-20'), film('earlier', '2019-11-02')]);
    const headings = screen.getAllByRole('heading').map((h) => h.textContent);
    expect(headings[0]).toMatch(/November 2019/);
    expect(headings[1]).toMatch(/March 2026/);
  });

  it('says how many things are in each month', () => {
    draw([film('a', '2020-05-02'), film('b', '2020-05-09'), film('c', '2020-06-11')]);
    expect(screen.getByRole('heading', { name: /May 2020/ }).textContent).toMatch(/2$/);
    expect(screen.getByRole('heading', { name: /June 2020/ }).textContent).toMatch(/1$/);
  });

  it('puts each thing under its own month', () => {
    draw([film('may-one', '2020-05-02'), film('june-one', '2020-06-11')]);

    const may = screen.getByRole('heading', { name: /May 2020/ }).parentElement!;
    expect(within(may).getByText('may-one')).toBeInTheDocument();
    expect(within(may).queryByText('june-one')).not.toBeInTheDocument();
  });

  /* Each month is its own board, so its tiles pack against each other and stop.
     One long board would let a month bleed into the gap before the next. */
  it('draws a board for each month rather than one for all of them', () => {
    const { container } = draw([film('a', '2020-05-02'), film('b', '2020-06-11')]);
    expect(container.querySelectorAll('.board')).toHaveLength(2);
  });

  it('keeps undated things, at the end, under their own heading', () => {
    draw([film('loose', null), film('dated', '2020-05-02')]);
    const headings = screen.getAllByRole('heading').map((h) => h.textContent);
    expect(headings.at(-1)).toMatch(/No date/);
  });

  it('falls back to the empty state when there is nothing at all', () => {
    draw([], <p>Nothing in the journal yet</p>);
    expect(screen.getByText('Nothing in the journal yet')).toBeInTheDocument();
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });
});

/* A photo has no date unless you set one, but it was dropped into a month and
   that is where it should be read. Before this it fell to the bottom of the
   journal into a "No date" heap, miles from the month it lives in. */
describe('things filed in a month without a date of their own', () => {
  it('draws them under the month they were filed in', () => {
    draw(
      [film('hollow-knight', null), film('dated', '2020-02-14')],
      undefined,
      new Map([['hollow-knight', '2020-02']]),
    );

    const february = screen.getByRole('heading', { name: /February 2020/ }).parentElement!;
    expect(within(february).getByText('hollow-knight')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /No date/ })).not.toBeInTheDocument();
  });

  it('counts them in that month', () => {
    draw([film('a', null), film('b', null)], undefined, new Map([
      ['a', '2020-02'],
      ['b', '2020-02'],
    ]));
    expect(screen.getByRole('heading', { name: /February 2020/ }).textContent).toMatch(/2$/);
  });
});

/* A heading has to carry over a wall of artwork, which the first attempt at
   26px in a single weight did not. */
describe('the heading over each month', () => {
  it('is set large and heavy enough to read as a divider', () => {
    draw([film('a', '2020-05-02')]);
    const heading = screen.getByRole('heading', { name: /May 2020/ });
    const size = Number(heading.className.match(/text-\[(\d+)px\]/)?.[1]);
    expect(size).toBeGreaterThanOrEqual(34);
    expect(heading.className).toMatch(/font-(semibold|bold)/);
  });
});

/* Colours belong to the year, so the paper does too: 2019 in green, 2020 in
   blue, one unbroken band each, the gaps between a year's months included. */
describe('a year, in its own colours', () => {
  const palettes: Record<string, Record<string, string>> = {
    '2019': { '--bg': '#9acd32', '--ink': '#102000' },
    '2020': { '--bg': '#1e90ff', '--ink': '#001030' },
  };
  const styleFor = (monthKey: string) => palettes[monthKey.slice(0, 4)] ?? {};

  const band = (year: string) => document.querySelector(`[data-year="${year}"]`) as HTMLElement;

  it('paints each year in the colours that year was given', () => {
    draw([film('a', '2019-03-02'), film('b', '2020-04-11')], undefined, undefined, styleFor);
    expect(band('2019').style.getPropertyValue('--bg')).toBe('#9acd32');
    expect(band('2020').style.getPropertyValue('--bg')).toBe('#1e90ff');
  });

  it('takes its text colour from the year as well', () => {
    draw([film('a', '2019-03-02')], undefined, undefined, styleFor);
    expect(band('2019').style.getPropertyValue('--ink')).toBe('#102000');
    expect(band('2019').style.color).toBe('var(--ink)');
    expect(band('2019').style.background).toBe('var(--bg)');
  });

  /* Twelve separately painted months would read as twelve changes of paper
     rather than one year you are scrolling through. */
  it('runs one band behind every month of the same year', () => {
    draw(
      [film('jan', '2019-01-02'), film('dec', '2019-12-20'), film('next', '2020-01-04')],
      undefined,
      undefined,
      styleFor,
    );
    expect(document.querySelectorAll('[data-year]')).toHaveLength(2);
    expect(within(band('2019')).getAllByRole('heading').map((h) => h.textContent)).toEqual([
      expect.stringMatching(/January 2019/),
      expect.stringMatching(/December 2019/),
    ]);
  });

  it('leaves an uncoloured year on the default paper', () => {
    draw([film('a', '2024-03-02')], undefined, undefined, styleFor);
    expect(band('2024').style.getPropertyValue('--bg')).toBe('');
    expect(band('2024').style.background).toBe('var(--bg)');
  });
});
