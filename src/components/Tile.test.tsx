/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tile } from './Tile';
import type { Block } from '@/lib/journal/types';
import type { Item } from '@/lib/journal/layout';

/* Covers FEATURES 5.1–5.6: what a tile shows, and what it keeps back until you
   ask for it. */

vi.mock('@/lib/client/media', () => ({
  srcFor: async (b: Block) => b.src ?? null,
  forgetBlobUrl: () => {},
}));

const item = (over: Partial<Item> = {}): Item => ({ id: 'b1', gx: 0, gy: 0, w: 4, h: 4, ...over });

const metrics = { px: (n: number) => n * 40, pitch: 44 };

const block = (over: Partial<Block> = {}): Block => ({
  id: 'b1',
  kind: 'media',
  title: 'Perfect Blue',
  subtitle: '1997',
  ...over,
});

function setup(b: Block) {
  const onOpen = vi.fn();
  render(<Tile block={b} item={item()} metrics={metrics} onOpen={onOpen} />);
  return { user: userEvent.setup(), onOpen };
}

describe('a tile', () => {
  it('shows the title and subtitle', () => {
    setup(block());
    expect(screen.getByText('Perfect Blue')).toBeInTheDocument();
    expect(screen.getByText('1997')).toBeInTheDocument();
  });

  it('falls back to a coloured letter when there is no artwork', () => {
    setup(block({ src: '' }));
    expect(screen.getByText('P')).toBeInTheDocument();
  });

  it('labels itself with its tags, not its source, when it has any', () => {
    setup(block({ tags: ['Movie', 'Rewatch'], source: 'letterboxd' }));
    expect(screen.getByText('Movie · Rewatch')).toBeInTheDocument();
    expect(screen.queryByText('letterboxd')).not.toBeInTheDocument();
  });

  it('falls back to the source when nothing is tagged', () => {
    setup(block({ tags: [], source: 'letterboxd' }));
    expect(screen.getByText('letterboxd')).toBeInTheDocument();
  });

  it('shows the day and the rating', () => {
    setup(block({ day: 14, rating: 4 }));
    expect(screen.getByText('14')).toBeInTheDocument();
    expect(screen.getByText(/★/)).toBeInTheDocument();
  });

  it('says nothing about a rating that was never given', () => {
    setup(block({ rating: null }));
    expect(screen.queryByText(/★/)).not.toBeInTheDocument();
  });

  /* FEATURES 5.2: nothing sits on the artwork uninvited. The class carries the
     rule; the stylesheet decides whether hover or press reveals it. */
  it('keeps everything but the picture out of the way until asked', () => {
    const { container } = render(
      <Tile
        block={block({ day: 3, rating: 5, tags: ['Movie'] })}
        item={item()}
        metrics={metrics}
        onOpen={() => {}}
        onRemove={() => {}}
        onCycleSize={() => {}}
      />,
    );

    // the tag label, the day, the rating, the caption, and the row of tools
    const revealed = [...container.querySelectorAll('.reveal')];
    expect(revealed).toHaveLength(5);

    // and the artwork itself is never inside one of them
    for (const node of revealed) {
      expect(node.querySelector('img, video')).toBeNull();
    }
  });

  it('opens the details on a double click', async () => {
    const { user, onOpen } = setup(block());
    await user.dblClick(screen.getByText('Perfect Blue'));
    expect(onOpen).toHaveBeenCalledWith('b1');
  });

  it('is placed and sized from the grid, not by the browser', () => {
    const { container } = render(
      <Tile block={block()} item={item({ gx: 4, gy: 2, w: 8, h: 6 })} metrics={metrics} onOpen={() => {}} />,
    );
    const tile = container.querySelector('.tile') as HTMLElement;
    expect(tile.style.left).toBe('176px'); // 4 * pitch
    expect(tile.style.top).toBe('88px'); // 2 * pitch
    expect(tile.style.width).toBe('320px'); // px(8)
    expect(tile.style.height).toBe('240px'); // px(6)
  });
});

/* Covers FEATURES 4.11 and 5.6: what you can do to a tile without opening it. */
describe('a tile’s own controls', () => {
  it('offers resize, details and remove', () => {
    render(
      <Tile
        block={block()}
        item={item()}
        metrics={metrics}
        onOpen={vi.fn()}
        onRemove={vi.fn()}
        onCycleSize={vi.fn()}
      />,
    );
    expect(screen.getByTitle('Resize')).toBeInTheDocument();
    expect(screen.getByTitle('Details')).toBeInTheDocument();
    expect(screen.getByTitle('Remove')).toBeInTheDocument();
  });

  it('calls each of them, without also picking the tile up', async () => {
    const onOpen = vi.fn();
    const onRemove = vi.fn();
    const onCycleSize = vi.fn();
    const onPointerDown = vi.fn();

    render(
      <Tile
        block={block()}
        item={item()}
        metrics={metrics}
        onOpen={onOpen}
        onRemove={onRemove}
        onCycleSize={onCycleSize}
        onPointerDown={onPointerDown}
      />,
    );

    const user = userEvent.setup();
    await user.click(screen.getByTitle('Resize'));
    await user.click(screen.getByTitle('Details'));
    await user.click(screen.getByTitle('Remove'));

    expect(onCycleSize).toHaveBeenCalledWith('b1');
    expect(onOpen).toHaveBeenCalledWith('b1');
    expect(onRemove).toHaveBeenCalledWith('b1');
  });

  it('has a grip in each corner for resizing by hand', () => {
    const { container } = render(
      <Tile block={block()} item={item()} metrics={metrics} onOpen={vi.fn()} onResizeFrom={vi.fn()} />,
    );
    const corners = [...container.querySelectorAll('[data-corner]')].map((n) =>
      n.getAttribute('data-corner'),
    );
    expect(corners).toEqual(['nw', 'ne', 'sw', 'se']);
  });

  it('starts a resize from the corner you grabbed', () => {
    const onResizeFrom = vi.fn();
    const { container } = render(
      <Tile block={block()} item={item()} metrics={metrics} onOpen={vi.fn()} onResizeFrom={onResizeFrom} />,
    );

    const se = container.querySelector('[data-corner="se"]') as HTMLElement;
    se.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(onResizeFrom.mock.calls[0][1]).toBe('se');
  });

  it('shows a rating with its half star', () => {
    render(<Tile block={block({ rating: 4.5 })} item={item()} metrics={metrics} onOpen={vi.fn()} />);
    expect(screen.getByText('★★★★½')).toBeInTheDocument();
  });

  it('draws a widget’s own body rather than artwork', () => {
    render(
      <Tile
        block={{ id: 'w', kind: 'note', text: 'hello' }}
        item={item()}
        metrics={metrics}
        onOpen={vi.fn()}
        body={<span>a sticky note</span>}
      />,
    );
    expect(screen.getByText('a sticky note')).toBeInTheDocument();
  });
});
