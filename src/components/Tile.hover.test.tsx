/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render } from '@testing-library/react';
import { Tile } from './Tile';
import type { Block } from '@/lib/journal/types';
import type { Item } from '@/lib/journal/layout';

/* Covers FEATURES 7.10 and 7.11: what a tile reveals, when, and in what order
   it is painted. Both of these regressed at once and were visible in the same
   screenshot, so they are pinned together. */

vi.mock('@/lib/client/media', () => ({
  srcFor: async (b: Block) => b.src ?? null,
  forgetBlobUrl: () => {},
}));

const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8');

/** The rules that apply to `sel`, with the media query each one sits inside. */
function rulesFor(sel: string): Array<{ media: string | null; body: string }> {
  const out: Array<{ media: string | null; body: string }> = [];
  const pattern = new RegExp(sel.replace(/[.:()\-]/g, '\\$&') + '[^{]*\\{([^}]*)\\}', 'g');

  for (const match of css.matchAll(pattern)) {
    const before = css.slice(0, match.index);
    // the innermost @media still open at this point, if there is one
    let depth = 0;
    let media: string | null = null;
    const blocks = [...before.matchAll(/@media([^{]*)\{|\{|\}/g)];
    const stack: string[] = [];
    for (const b of blocks) {
      if (b[0].startsWith('@media')) {
        stack.push(b[1].trim());
        depth++;
      } else if (b[0] === '{') depth++;
      else {
        depth--;
        if (stack.length && depth < stack.length) stack.pop();
      }
    }
    media = stack.length ? stack[stack.length - 1] : null;
    out.push({ media, body: match[1] });
  }
  return out;
}

describe('what a tile reveals, and when', () => {
  /* The bug: this rule sat inside `@media (hover: hover)`. A laptop with a
     touchscreen reports `hover: none`, so hovering did nothing and you had to
     press and hold — which is not how anyone reads a board with a mouse. */
  it('hides the details by default, on every device', () => {
    const hidden = rulesFor('.tile .reveal');
    expect(hidden.length).toBeGreaterThan(0);
    for (const rule of hidden) {
      expect(rule.media, 'the hidden state must not depend on the pointer').toBeNull();
    }
  });

  it('brings them back on hover, without asking what kind of pointer it is', () => {
    const shown = rulesFor('.tile:hover .reveal');
    expect(shown.length).toBeGreaterThan(0);
    for (const rule of shown) {
      expect(rule.media, 'hover must work wherever there is a pointer').toBeNull();
    }
  });

  /* A touch screen has no hover, so pressing has to do it as well — as an
     addition, never as the only way. */
  it('brings them back on a press too', () => {
    expect(rulesFor('.tile:active .reveal').length).toBeGreaterThan(0);
  });

  it('brings them back when something inside takes focus, for a keyboard', () => {
    expect(rulesFor('.tile:focus-within .reveal').length).toBeGreaterThan(0);
  });
});

describe('what the caption gradient is allowed to cover', () => {
  const item: Item = { id: 'b1', gx: 0, gy: 0, w: 4, h: 4 };
  const metrics = { px: (n: number) => n * 40, pitch: 44 };

  const block: Block = {
    id: 'b1',
    kind: 'media',
    title: 'Dune: Part Two',
    subtitle: '2024',
    note: 'Lisan Al-Gaib?',
    day: 1,
    rating: 3.5,
    tags: ['Movie'],
    src: 'https://example.test/dune.jpg',
  };

  const z = (el: Element | null) => {
    const found = (el?.className ?? '').toString().match(/z-\[(\d+)\]/);
    return found ? Number(found[1]) : 0;
  };

  /* The gradient is a backdrop. It sits under every piece of text, never over
     it — the day chip and the rating live outside the caption element, so
     without this they are painted over by it. */
  it('paints the gradient below the chips that sit on top of it', () => {
    const { container } = render(
      <Tile block={block} item={item} metrics={metrics} onOpen={vi.fn()} />,
    );

    const caption = container.querySelector('.cap');
    const badge = container.querySelector('.badge');
    const day = container.querySelector('.daytag');
    const rating = container.querySelector('.rating');

    expect(caption).toBeTruthy();
    for (const chip of [badge, day, rating]) {
      expect(chip).toBeTruthy();
      expect(z(chip)).toBeGreaterThan(z(caption));
    }
  });

  it('keeps the caption above the picture, so its own words stay readable', () => {
    const { container } = render(
      <Tile block={block} item={item} metrics={metrics} onOpen={vi.fn()} />,
    );
    expect(z(container.querySelector('.cap'))).toBeGreaterThan(0);
  });
});
