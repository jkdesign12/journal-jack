/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Inspector } from './Inspector';
import { store } from '@/lib/client/store';
import type { Block } from '@/lib/journal/types';

/* Covers FEATURES 11.1–11.6 and 8.1–8.3: editing a tile. */

vi.mock('@/lib/client/media', () => ({
  srcFor: async () => null,
  forgetBlobUrl: () => {},
}));

const block = (over: Partial<Block> = {}): Block => ({
  id: 'b1',
  kind: 'media',
  title: 'Perfect Blue',
  subtitle: '1997',
  source: 'letterboxd',
  tags: ['Movie'],
  date: '2026-09-02',
  day: 2,
  ...over,
});

function setup(b: Block) {
  const handlers = { onClose: vi.fn(), onChange: vi.fn(), onRemove: vi.fn(), onMoved: vi.fn() };
  render(<Inspector block={b} {...handlers} />);
  return { user: userEvent.setup(), block: b, ...handlers };
}

beforeEach(() => {
  store.doc = { months: { '2026-09': { blocks: [] } } };
  store.view = { ...store.view, cursor: '2026-09' };
});

describe('the details panel', () => {
  it('offers every field the original had', () => {
    setup(block());
    for (const label of ['Title', 'Subtitle', 'Tags', 'Date', 'Rating (0–5)', 'Poster URL', 'Note', 'Size']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('writes a new title straight onto the block', async () => {
    const { user, block: b, onChange } = setup(block());
    await user.type(screen.getByDisplayValue('Perfect Blue'), '!');
    expect(b.title).toBe('Perfect Blue!');
    expect(onChange).toHaveBeenCalled();
  });

  it('shows each tag as a chip you can take off', async () => {
    const { user, block: b } = setup(block({ tags: ['Movie', 'Rewatch'] }));
    expect(screen.getByText('Movie')).toBeInTheDocument();
    await user.click(screen.getByTitle('Remove Movie'));
    expect(b.tags).toEqual(['Rewatch']);
  });

  it('adds a tag on Enter', async () => {
    const { user, block: b } = setup(block());
    const box = screen.getByPlaceholderText('Add another…');
    await user.type(box, 'Rewatch{Enter}');
    expect(b.tags).toEqual(['Movie', 'Rewatch']);
  });

  it('adds several at once from a comma', async () => {
    const { user, block: b } = setup(block({ tags: [] }));
    await user.type(screen.getByPlaceholderText('Movie, Book, Game…'), 'cinema, favourite{Enter}');
    expect(b.tags).toEqual(['cinema', 'favourite']);
  });

  it('takes the last chip off on backspace in an empty box', async () => {
    const { user, block: b } = setup(block({ tags: ['Movie', 'Rewatch'] }));
    await user.click(screen.getByPlaceholderText('Add another…'));
    await user.keyboard('{Backspace}');
    expect(b.tags).toEqual(['Movie']);
  });

  it('refuses a tag it already has', async () => {
    const { user, block: b } = setup(block({ tags: ['Movie'] }));
    await user.type(screen.getByPlaceholderText('Add another…'), 'movie{Enter}');
    expect(b.tags).toEqual(['Movie']);
  });

  it('changes a rating', async () => {
    const { user, block: b } = setup(block({ rating: null }));
    await user.type(screen.getByRole('spinbutton'), '4');
    expect(b.rating).toBe(4);
  });

  it('takes a poster URL by hand when a lookup picked wrong', async () => {
    const { user, block: b } = setup(block());
    const field = screen.getByPlaceholderText('https://…/poster.jpg');
    await user.type(field, 'https://example.com/right.jpg');
    await user.tab();
    expect(b.src).toBe('https://example.com/right.jpg');
  });

  it('links back to where it came from', () => {
    setup(block({ url: 'https://letterboxd.com/film/perfect-blue/' }));
    const link = screen.getByRole('link', { name: /Open on letterboxd/ });
    expect(link).toHaveAttribute('href', 'https://letterboxd.com/film/perfect-blue/');
  });

  it('deletes the block', async () => {
    const { user, onRemove } = setup(block());
    await user.click(screen.getByRole('button', { name: 'Delete block' }));
    expect(onRemove).toHaveBeenCalledWith('b1');
  });

  it('closes on Escape', async () => {
    const { user, onClose } = setup(block());
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  /* FEATURES 11.2: dating a block is also filing it. */
  it('moves a block dated into another month, and says where it went', async () => {
    const b = block({ date: '2026-09-02' });
    store.doc.months['2026-09'].blocks.push(b);

    const { onMoved } = setup(b);
    // a date field is picked, not typed: one change carrying the whole date
    fireEvent.change(screen.getByDisplayValue('2026-09-02'), { target: { value: '2026-06-11' } });

    expect(store.doc.months['2026-06'].blocks).toContain(b);
    expect(store.doc.months['2026-09'].blocks).not.toContain(b);
    expect(onMoved).toHaveBeenCalledWith('Moved to June 2026');
  });

  it('clears a date without moving anything', async () => {
    const b = block();
    store.doc.months['2026-09'].blocks.push(b);
    const { user } = setup(b);
    await user.click(screen.getByRole('button', { name: 'No date' }));
    expect(b.date).toBeNull();
    expect(b.day).toBeNull();
  });
});
