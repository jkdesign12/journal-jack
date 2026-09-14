import { describe, it, expect } from 'vitest';
import { repairWrongCovers } from './artwork';
import type { Block } from '@/lib/journal/types';

/* Covers FEATURES 12.5: keeping the cover you chose. */

const album = (over: Partial<Block> = {}): Block => ({
  id: 'b1',
  kind: 'media',
  source: 'musicboard',
  title: 'For You',
  subtitle: 'Selena · 12 plays',
  ...over,
});

describe('repairing covers that came from the wrong cascade', () => {
  /* An album wearing a film poster got it from the film lookup — the
     "Evangelion single with a comedy poster" case. */
  it('drops a film-CDN image off an album so it can be looked up properly', () => {
    const blocks = [album({ src: 'https://m.media-amazon.com/images/M/poster.jpg' })];
    expect(repairWrongCovers(blocks)).toBe(1);
    expect(blocks[0].src).toBe('');
  });

  /* The whole point of typing a URL in is that it is the one you want. Judging
     it by the host it came from threw away the cover every single sweep, and
     the lookup put its own back — you could retype it forever. */
  it('leaves a cover you typed in alone, wherever it is hosted', () => {
    const chosen = 'https://upload.wikimedia.org/wikipedia/en/for-you.jpg';
    const blocks = [album({ src: chosen, srcByHand: true })];
    expect(repairWrongCovers(blocks)).toBe(0);
    expect(blocks[0].src).toBe(chosen);
  });

  it('still leaves a proper album cover alone', () => {
    const blocks = [album({ src: 'https://e-cdns-images.dzcdn.net/cover.jpg' })];
    expect(repairWrongCovers(blocks)).toBe(0);
  });
});
