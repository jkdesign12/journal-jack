/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import { Tile } from './Tile';
import type { Block } from '@/lib/journal/types';
import type { Item } from '@/lib/journal/layout';

/* Covers FEATURES 7.13: the three things you do to a tile, and knowing which
   one you are about to press. */

vi.mock('@/lib/client/media', () => ({
  srcFor: async (b: Block) => b.src ?? null,
  forgetBlobUrl: () => {},
}));

const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8');

const item: Item = { id: 'b1', gx: 0, gy: 0, w: 4, h: 4 };
const metrics = { px: (n: number) => n * 40, pitch: 44 };
const block: Block = { id: 'b1', kind: 'media', title: 'Nausicaä', src: 'https://a.test/n.jpg' };

const draw = () =>
  render(
    <Tile
      block={block}
      item={item}
      metrics={metrics}
      onOpen={vi.fn()}
      onRemove={vi.fn()}
      onCycleSize={vi.fn()}
    />,
  );

describe("a tile's tools", () => {
  it('are all three of them', () => {
    draw();
    for (const name of ['Resize', 'Details', 'Remove']) {
      expect(screen.getByTitle(name)).toBeInTheDocument();
    }
  });

  /* Three identical dark squares give you no idea which one you are about to
     press. Each lights up in the accent red — the same colour the day chip
     uses — so the one under the pointer is obvious. */
  it('each light up in the accent colour under the pointer', () => {
    draw();
    for (const name of ['Resize', 'Details', 'Remove']) {
      const tool = screen.getByTitle(name);
      expect(tool.className).toMatch(/hover:bg-accent/);
      expect(tool.className).toMatch(/hover:text-/);
    }
  });

  it('is the same red the day chip is drawn in', () => {
    render(
      <Tile
        block={{ ...block, day: 19 }}
        item={item}
        metrics={metrics}
        onOpen={vi.fn()}
        onRemove={vi.fn()}
        onCycleSize={vi.fn()}
      />,
    );
    const day = document.querySelector('.daytag') as HTMLElement;
    const tool = screen.getByTitle('Remove');

    expect(day.className).toMatch(/bg-accent/);
    expect(tool.className).toMatch(/hover:bg-accent/);
  });
});

/* Tailwind answers `hover:` only where `(hover: hover)` matches. A laptop with
   a touchscreen says `hover: none`, and every hover style in the app — these
   tools, the buttons, the menu rows, the month arrows — goes dead there. The
   variant is redefined so it asks about the pointer, not the device. */
describe('hover styles, on a machine that also has a touchscreen', () => {
  it('redefines the hover variant so it is not gated by the device', () => {
    expect(css).toMatch(/@custom-variant\s+hover\s*\(&:hover\)/);
  });

  it('says why, so nobody puts the default back', () => {
    const at = css.indexOf('@custom-variant');
    const reason = css.slice(Math.max(0, at - 600), at);
    expect(reason).toMatch(/hover: none|touchscreen/i);
  });
});
