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

const draw = (blocks: Block[], empty?: React.ReactNode) =>
  render(<MonthSections blocks={blocks} empty={empty} {...handlers} />);

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
