import { describe, it, expect } from 'vitest';
import {
  cleanTags,
  defaultTag,
  hiddenTagSet,
  knownTags,
  setTags,
  tagVisible,
  tagsOf,
  UNTAGGED,
} from './tags';
import type { Block } from './types';

const b = (over: Partial<Block> = {}): Block => ({ id: 'x', kind: 'media', ...over });

describe('tags an import gives itself', () => {
  it('calls Letterboxd films movies and records music', () => {
    expect(defaultTag(b({ source: 'letterboxd' }))).toBe('Movie');
    expect(defaultTag(b({ source: 'musicboard' }))).toBe('Music');
    expect(defaultTag(b({ source: 'lastfm' }))).toBe('Music');
  });

  it('reads the kind AniList gives each entry', () => {
    expect(defaultTag(b({ source: 'anilist', subtitle: 'TV' }))).toBe('Anime');
    expect(defaultTag(b({ source: 'anilist', subtitle: 'MANGA' }))).toBe('Manga');
    expect(defaultTag(b({ source: 'anilist', subtitle: 'NOVEL' }))).toBe('Manga');
    expect(defaultTag(b({ source: 'anilist', subtitle: 'MOVIE' }))).toBe('Movie');
    expect(defaultTag(b({ source: 'anilist', subtitle: 'OVA' }))).toBe('Anime');
  });

  it('guesses nothing for a photo you uploaded', () => {
    expect(defaultTag(b({ kind: 'photo' }))).toBe('');
  });
});

describe('reading and writing tags', () => {
  it('reads a list, and a single tag from an older save', () => {
    expect(tagsOf(b({ tags: ['Movie', 'Rewatch'] }))).toEqual(['Movie', 'Rewatch']);
    expect(tagsOf(b({ tag: 'Music' }))).toEqual(['Music']);
    expect(tagsOf(b({ tag: '' }))).toEqual([]);
    expect(tagsOf(b())).toEqual([]);
  });

  it('folds a retyped tag onto the spelling already in use', () => {
    expect(cleanTags(['movie'], ['Movie'])).toEqual(['Movie']);
  });

  it('drops blanks and repeats', () => {
    expect(cleanTags([' Movie ', '', 'movie', 'Book'], ['Movie'])).toEqual(['Movie', 'Book']);
  });

  it('leaves the single-tag field behind once rewritten', () => {
    const block = b({ tag: 'Music' });
    setTags(block, ['Music', 'Live']);
    expect(block.tags).toEqual(['Music', 'Live']);
    expect(block.tag).toBeUndefined();
  });

  it('offers what is used most first, then the standard ones', () => {
    const list = knownTags([
      b({ tags: ['Movie'] }),
      b({ tags: ['Movie'] }),
      b({ tags: ['Music'] }),
    ]);
    expect(list.slice(0, 2)).toEqual(['Movie', 'Music']);
    expect(list).toContain('Book');
    expect(list.filter((t) => t === 'Movie')).toHaveLength(1);
  });
});

describe('filtering by tag', () => {
  it('shows everything when nothing is switched off', () => {
    expect(tagVisible(b({ tags: ['Movie'] }), hiddenTagSet([]))).toBe(true);
  });

  it('hides a tile when one of its tags is switched off', () => {
    const hidden = hiddenTagSet(['Rewatch']);
    expect(tagVisible(b({ tags: ['Movie', 'Rewatch'] }), hidden)).toBe(false);
    expect(tagVisible(b({ tags: ['Movie'] }), hidden)).toBe(true);
  });

  it('hides untagged things only through their own row', () => {
    expect(tagVisible(b({ kind: 'photo' }), hiddenTagSet(['Movie']))).toBe(true);
    expect(tagVisible(b({ kind: 'photo' }), hiddenTagSet([UNTAGGED]))).toBe(false);
  });

  it('does not care about case', () => {
    expect(tagVisible(b({ tags: ['Movie'] }), hiddenTagSet(['movie']))).toBe(false);
  });
});
