/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Player } from './Player';
import { Calendar } from './Calendar';
import { WidgetBody } from './Widget';
import { Banner } from './Banner';
import { DropOverlay } from './DropOverlay';
import { Empty } from './Empty';
import type { Block } from '@/lib/journal/types';

/* Covers the chrome the first pass missed: FEATURES 2.3, 8.5, 9.3, 9.7, 13.3,
   15.5, 20.4, 20.5. */

vi.mock('@/lib/client/media', () => ({ srcFor: async () => null, forgetBlobUrl: () => {} }));

describe('the banner a restricted browser needs', () => {
  it('says nothing when storage is fine', () => {
    const { container } = render(<Banner degraded={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('explains that uploads will not survive a reload', () => {
    render(<Banner degraded />);
    expect(screen.getByText(/will not persist|not survive/i)).toBeInTheDocument();
  });

  /* Opening the file directly is the usual cause, and the fix is a sentence
     long, so it is worth saying rather than leaving someone to guess. */
  it('names file:// as the usual cause when that is where it is running', () => {
    render(<Banner degraded protocol="file:" />);
    expect(screen.getByText(/file:\/\//)).toBeInTheDocument();
    expect(screen.getByText(/npm run dev|localhost/)).toBeInTheDocument();
  });
});

describe('the overlay while something is dragged over the window', () => {
  it('is out of the way until something arrives', () => {
    const { container } = render(<DropOverlay over={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('says what will happen if you let go', () => {
    render(<DropOverlay over />);
    expect(screen.getByText('drop to add')).toBeInTheDocument();
  });
});

describe('an empty board', () => {
  it('says what to do about it', () => {
    render(<Empty all={false} filtered={false} onShowAll={vi.fn()} />);
    expect(screen.getByText('Nothing here yet')).toBeInTheDocument();
    expect(screen.getByText(/Drop photos anywhere/)).toBeInTheDocument();
  });

  it('says something different for the whole journal', () => {
    render(<Empty all filtered={false} onShowAll={vi.fn()} />);
    expect(screen.getByText('Nothing in the journal yet')).toBeInTheDocument();
  });

  it('offers a way back when it is the filter hiding everything', async () => {
    const onShowAll = vi.fn();
    render(<Empty all={false} filtered onShowAll={onShowAll} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Show all tags' }));
    expect(onShowAll).toHaveBeenCalled();
  });

  it('is set in the serif, inside a dashed box', () => {
    const { container } = render(<Empty all={false} filtered={false} onShowAll={vi.fn()} />);
    const box = container.firstElementChild as HTMLElement;
    expect(box.className).toMatch(/border-dashed/);
    expect(box.querySelector('b')?.className).toMatch(/font-serif/);
  });
});

describe('the song’s volume', () => {
  const handlers = { onAutoplay: vi.fn(), onSet: vi.fn(), onClear: vi.fn(), onNote: vi.fn() };

  it('offers a slider', () => {
    render(<Player song={{ blobId: 'x', name: 'Loveless' }} autoplay={false} {...handlers} />);
    expect(screen.getByTitle('Volume')).toBeInTheDocument();
  });

  it('starts a little below the top, so it is not a shock', () => {
    render(<Player song={{ blobId: 'x', name: 'Loveless' }} autoplay={false} {...handlers} />);
    const slider = screen.getByTitle('Volume').querySelector('input') as HTMLInputElement;
    expect(Number(slider.value)).toBeGreaterThan(0.5);
    expect(Number(slider.value)).toBeLessThan(1);
  });

  it('changes how loud it is', () => {
    render(<Player song={{ blobId: 'x', name: 'Loveless' }} autoplay={false} {...handlers} />);
    const slider = screen.getByTitle('Volume').querySelector('input') as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '0.3' } });
    expect((document.querySelector('audio') as HTMLAudioElement).volume).toBeCloseTo(0.3);
  });
});

describe('a checklist', () => {
  it('offers a button to add a line, as well as the Enter key', async () => {
    const block: Block = { id: 'c', kind: 'checklist', items: [{ t: 'one', done: false }] };
    render(<WidgetBody block={block} onChange={vi.fn()} />);
    await userEvent.setup().click(screen.getByRole('button', { name: /add a line/i }));
    expect(block.items).toHaveLength(2);
  });
});

describe('the calendar’s edges', () => {
  const handlers = { onOpen: vi.fn(), onDropOn: vi.fn(), onFilesOn: vi.fn() };

  /* Days belonging to the neighbouring month are not real days here, but a
     blank gap reads as a mistake — so they are drawn, faintly. */
  it('draws the days before the first, dashed and faint', () => {
    const { container } = render(<Calendar cursor="2026-09" blocks={[]} {...handlers} />);
    const pads = container.querySelectorAll('.day-pad');
    expect(pads).toHaveLength(2); // 1 September 2026 is a Tuesday
    expect((pads[0] as HTMLElement).className).toMatch(/border-dashed/);
  });

  it('lights a day up while something is dragged over it', () => {
    const { container } = render(<Calendar cursor="2026-09" blocks={[]} {...handlers} />);
    const third = screen.getByText('03').parentElement as HTMLElement;

    fireEvent.dragOver(third);
    expect(third.className).toMatch(/drag-over/);

    fireEvent.dragLeave(third);
    expect(third.className).not.toMatch(/drag-over/);
    expect(container).toBeTruthy();
  });
});
