/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Calendar } from './Calendar';
import type { Block } from '@/lib/journal/types';

/* Covers FEATURES 6.1–6.9: the month as days. */

vi.mock('@/lib/client/media', () => ({
  srcFor: async (b: Block) => b.src ?? null,
  forgetBlobUrl: () => {},
}));

const photo = (id: string, day: number | null): Block => ({
  id,
  kind: 'photo',
  title: id,
  day,
  date: day ? `2026-09-${String(day).padStart(2, '0')}` : null,
});

/** The square for a day, found by its number rather than by counting cells —
 *  the month starts with blanks, and counting them is how a test lies. */
const dayCell = (day: number) =>
  screen.getByText(String(day).padStart(2, '0')).parentElement as HTMLElement;

function setup(blocks: Block[]) {
  const handlers = { onOpen: vi.fn(), onDropOn: vi.fn(), onFilesOn: vi.fn() };
  const view = render(<Calendar cursor="2026-09" blocks={blocks} {...handlers} />);
  return { user: userEvent.setup(), ...handlers, ...view };
}

describe('the calendar', () => {
  it('draws every day of the month', () => {
    setup([]);
    expect(screen.getByText('01')).toBeInTheDocument();
    expect(screen.getByText('30')).toBeInTheDocument(); // September has 30
    expect(screen.queryByText('31')).not.toBeInTheDocument();
  });

  it('knows how long February is in a leap year', () => {
    render(<Calendar cursor="2024-02" blocks={[]} onOpen={vi.fn()} onDropOn={vi.fn()} onFilesOn={vi.fn()} />);
    expect(screen.getByText('29')).toBeInTheDocument();
  });

  it('puts each thing on its own day', () => {
    setup([photo('a', 5), photo('b', 12)]);
    expect(within(dayCell(5)).getByTitle('a')).toBeInTheDocument();
    expect(within(dayCell(12)).getByTitle('b')).toBeInTheDocument();
    expect(within(dayCell(5)).queryByTitle('b')).not.toBeInTheDocument();
  });

  it('stops at six thumbnails and counts the rest', () => {
    setup(Array.from({ length: 9 }, (_, i) => photo('p' + i, 7)));
    expect(screen.getByText('+3 more')).toBeInTheDocument();
  });

  it('shows a sticky note’s text on its day', () => {
    setup([{ id: 'n', kind: 'note', day: 3, text: 'went swimming' }]);
    expect(screen.getByText('went swimming')).toBeInTheDocument();
  });

  it('collects undated things in a tray', () => {
    setup([photo('loose', null)]);
    expect(screen.getByText(/Unscheduled/)).toBeInTheDocument();
    expect(screen.getByTitle('loose')).toBeInTheDocument();
  });

  it('says so when everything is dated', () => {
    setup([photo('a', 2)]);
    expect(screen.getByText(/Everything is dated/)).toBeInTheDocument();
  });

  it('dates a thumbnail dropped onto a day', () => {
    const { onDropOn } = setup([photo('loose', null)]);

    const transfer = {
      getData: (t: string) => (t === 'text/journal-block' ? 'loose' : ''),
      files: [] as unknown as FileList,
    };
    // fireEvent is the only way to carry a dataTransfer through jsdom
    const event = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: transfer });
    dayCell(3).dispatchEvent(event);

    expect(onDropOn).toHaveBeenCalledWith('loose', 3);
  });

  it('adds files dropped onto a day to that day', () => {
    const { onFilesOn } = setup([]);

    const file = new File(['x'], 'a.jpg', { type: 'image/jpeg' });
    const event = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', {
      value: { getData: () => '', files: [file] },
    });
    dayCell(4).dispatchEvent(event);

    expect(onFilesOn).toHaveBeenCalled();
    expect(onFilesOn.mock.calls[0][1]).toBe(4);
  });

  it('opens the details when a thumbnail is clicked', async () => {
    const { user, onOpen } = setup([photo('a', 5)]);
    await user.click(screen.getByTitle('a'));
    expect(onOpen).toHaveBeenCalledWith('a');
  });
});
