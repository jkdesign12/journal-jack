/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TagFilter } from './TagFilter';
import { UNTAGGED } from '@/lib/journal/tags';
import type { Block } from '@/lib/journal/types';

/* Covers FEATURES 8.9–8.13: the filter itself. */

const blocks: Block[] = [
  { id: '1', kind: 'media', tags: ['Movie'] },
  { id: '2', kind: 'media', tags: ['Movie'] },
  { id: '3', kind: 'media', tags: ['Movie', 'Rewatch'] },
  { id: '4', kind: 'media', tags: ['Music'] },
  { id: '5', kind: 'photo' },
];

function setup(hidden: string[] = []) {
  const handlers = { onChange: vi.fn(), onClose: vi.fn() };
  render(<TagFilter blocks={blocks} hidden={hidden} {...handlers} />);
  return { user: userEvent.setup(), ...handlers };
}

describe('the tag filter', () => {
  it('lists every tag, most used first, with counts', () => {
    setup();
    const rows = screen.getAllByRole('checkbox').map((c) => c.closest('label')!.textContent);
    expect(rows).toEqual(['Movie3', 'Music1', 'Rewatch1', 'Untagged1']);
  });

  it('starts with everything switched on', () => {
    setup();
    for (const box of screen.getAllByRole('checkbox')) expect(box).toBeChecked();
  });

  it('remembers only what you switched off', async () => {
    const { user, onChange } = setup();
    await user.click(screen.getByRole('checkbox', { name: /Movie/ }));
    expect(onChange).toHaveBeenCalledWith(['Movie']);
  });

  it('switches one back on without touching the rest', async () => {
    const { user, onChange } = setup(['Movie', 'Music']);
    await user.click(screen.getByRole('checkbox', { name: /Movie/ }));
    expect(onChange).toHaveBeenCalledWith(['Music']);
  });

  it('has a row for the things with no tag at all', async () => {
    const { user, onChange } = setup();
    await user.click(screen.getByRole('checkbox', { name: /Untagged/ }));
    expect(onChange).toHaveBeenCalledWith([UNTAGGED]);
  });

  it('turns everything on, or everything off, at once', async () => {
    const { user, onChange } = setup(['Movie']);
    await user.click(screen.getByRole('button', { name: 'All' }));
    expect(onChange).toHaveBeenLastCalledWith([]);

    await user.click(screen.getByRole('button', { name: 'None' }));
    expect(onChange).toHaveBeenLastCalledWith(['Movie', 'Music', 'Rewatch', UNTAGGED]);
  });

  it('explains what a tile with several tags does', () => {
    setup();
    expect(screen.getByText(/needs all of them on/)).toBeInTheDocument();
  });

  it('says so when nothing has been tagged', () => {
    render(<TagFilter blocks={[]} hidden={[]} onChange={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText(/Nothing is tagged yet/)).toBeInTheDocument();
  });
});
