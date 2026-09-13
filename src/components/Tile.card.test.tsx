/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tile } from './Tile';
import { guessRatio } from '@/lib/journal/layout';
import type { Block } from '@/lib/journal/types';
import type { Item } from '@/lib/journal/layout';

/* Covers FEATURES 6.5, 6.6, 7.1, 7.3–7.6, 7.12 — the parts of a tile that are
   about what it does when there is no picture, or the picture is not here yet. */

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
  source: 'letterboxd',
  ...over,
});

const draw = (b: Block, props: Partial<Parameters<typeof Tile>[0]> = {}) =>
  render(<Tile block={b} item={item()} metrics={metrics} onOpen={vi.fn()} {...props} />);

describe('an import that arrived without a poster', () => {
  /* A Letterboxd CSV carries titles, years and ratings but no images. Those get
     a typeset card rather than a broken tile — one letter tells you nothing. */
  /* Scoped to the card on purpose: the hover caption carries the same words,
     so a loose query passes whether or not the card was ever drawn. */
  it('prints the title, the year and the rating on a card', async () => {
    const { container } = draw(block({ src: '', rating: 4.5 }));
    const card = await waitFor(() => {
      const found = container.querySelector('.poster') as HTMLElement;
      expect(found).toBeTruthy();
      return found;
    });

    expect(within(card).getByText('Perfect Blue')).toBeInTheDocument();
    expect(within(card).getByText('1997')).toBeInTheDocument();
    expect(within(card).getByText('★★★★½')).toBeInTheDocument();
  });

  it('colours the card from the title, so it is the same one every time', async () => {
    const { container } = draw(block({ src: '' }));
    await waitFor(() => expect(container.querySelector('.poster')).toBeTruthy());
    const card = container.querySelector('.poster') as HTMLElement;
    expect(card.style.getPropertyValue('--h')).not.toBe('');
  });

  it('marks itself so the hover caption can take over from its own text', async () => {
    const { container } = draw(block({ src: '' }));
    await waitFor(() => expect(container.querySelector('.is-card')).toBeTruthy());
  });

  /* A poster URL that 404s should read as a card, not an empty tile. */
  it('falls back to the card when the image fails to load', async () => {
    const { container } = draw(block({ src: 'https://example.test/gone.jpg' }));
    fireEvent.error(screen.getByRole('img'));
    await waitFor(() => expect(container.querySelector('.poster')).toBeTruthy());
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('asks for images without a referrer, so a CDN does not refuse the hotlink', () => {
    draw(block({ src: 'https://upload.wikimedia.org/a.jpg' }));
    expect(screen.getByRole('img')).toHaveAttribute('referrerpolicy', 'no-referrer');
  });
});

describe('a file that cannot be found', () => {
  /* Saying which of the two reasons it is saves guessing: the file is on
     another device and was never uploaded, or you are signed out. */
  it('says to sign in when nobody is signed in', async () => {
    draw(block({ kind: 'photo', blobId: 'missing', title: 'IMG_3385', src: '' }));
    expect(await screen.findByText('IMG_3385')).toBeInTheDocument();
    expect(screen.getByText(/sign in to load it/)).toBeInTheDocument();
  });

  it('says which device has it when you are signed in', async () => {
    const { Account } = await import('@/lib/client/account');
    Account.user = { id: 'u1', email: 'a@b.co' };

    draw(block({ kind: 'photo', blobId: 'missing', title: 'IMG_3385', src: '' }));
    expect(await screen.findByText(/not uploaded from the device that has it/)).toBeInTheDocument();

    Account.user = null;
  });

  it('says nothing about a device for a tile that never had a file', async () => {
    draw(block({ kind: 'photo', title: 'IMG_0001', src: '' }));
    expect(screen.queryByText(/not uploaded/)).not.toBeInTheDocument();
  });
});

describe('selecting a tile', () => {
  it('marks the one you clicked, and only that one', async () => {
    const onSelect = vi.fn();
    draw(block(), { onSelect, selected: false });
    await userEvent.setup().click(screen.getByText('Perfect Blue'));
    expect(onSelect).toHaveBeenCalledWith('b1');
  });

  it('keeps its outline while selected', () => {
    const { container } = draw(block(), { selected: true });
    expect(container.querySelector('.is-sel')).toBeTruthy();
  });

  it('shows its tools while selected, not only on hover', () => {
    const { container } = draw(block(), { selected: true, onRemove: vi.fn(), onCycleSize: vi.fn() });
    const tools = container.querySelector('.tools') as HTMLElement;
    expect(tools.className).not.toMatch(/\breveal\b/);
  });
});

describe('the shape a tile takes before its picture arrives', () => {
  it('guesses a poster for a film, a square for a record', () => {
    expect(guessRatio({ kind: 'media', source: 'letterboxd' })).toBeCloseTo(1.5);
    expect(guessRatio({ kind: 'media', source: 'musicboard' })).toBe(1);
    expect(guessRatio({ kind: 'photo' })).toBe(1);
  });

  it('guesses a shape for each kind of widget', () => {
    expect(guessRatio({ kind: 'heading' })).toBeLessThan(0.5);
    expect(guessRatio({ kind: 'checklist' })).toBeGreaterThan(1);
  });

  it('prefers a measured ratio over a guess', () => {
    expect(guessRatio({ kind: 'media', source: 'letterboxd', ratio: 0.8 })).toBe(0.8);
  });

  /* The file itself decides the tile's shape, and remembering it means later
     renders are the right size before the image comes back. */
  it('remembers the picture’s real proportions once it loads', async () => {
    const b = block({ src: 'https://example.test/poster.jpg' });
    const onMeasured = vi.fn();
    draw(b, { onMeasured });

    const img = screen.getByRole('img') as HTMLImageElement;
    Object.defineProperty(img, 'naturalWidth', { value: 400 });
    Object.defineProperty(img, 'naturalHeight', { value: 600 });
    fireEvent.load(img);

    expect(onMeasured).toHaveBeenCalledWith('b1', 1.5);
  });
});
