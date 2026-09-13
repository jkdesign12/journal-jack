/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MonthPicker } from './MonthPicker';
import { defaultView, type ViewState } from '@/lib/client/view';
import type { JournalDoc } from '@/lib/journal/types';

/* Covers FEATURES 7.3–7.5: jumping to a month, and opening everything at once. */

const doc: JournalDoc = {
  months: {
    '2026-02': { blocks: [{ id: 'a', kind: 'photo' }] },
    '2026-09': { blocks: [{ id: 'b', kind: 'photo' }, { id: 'c', kind: 'photo' }] },
    '2026-04': { blocks: [] },
  },
};

function setup(over: Partial<ViewState> = {}) {
  const handlers = { onPick: vi.fn(), onAll: vi.fn(), onClose: vi.fn() };
  render(
    <MonthPicker doc={doc} view={{ ...defaultView(), cursor: '2026-09', ...over }} {...handlers} />,
  );
  return { user: userEvent.setup(), ...handlers };
}

describe('the month picker', () => {
  it('offers all twelve months of the year on the cursor', () => {
    setup();
    expect(screen.getByText('2026')).toBeInTheDocument();
    for (const m of ['Jan', 'Feb •', 'Mar', 'Dec']) {
      expect(screen.getByRole('button', { name: m })).toBeInTheDocument();
    }
  });

  /* A dot means there is something in that month, which is what makes the grid
     worth looking at rather than just clicking through. */
  it('dots the months that hold something', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Feb •' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apr' })).toBeInTheDocument(); // empty month
  });

  it('marks the month you are on', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Sep •' }).className).toMatch(/bg-accent/);
  });

  it('marks nothing while the all view is on', () => {
    setup({ all: true });
    expect(screen.getByRole('button', { name: 'Sep •' }).className).not.toMatch(/bg-accent/);
  });

  it('pages through years', async () => {
    const { user } = setup();
    await user.click(screen.getByLabelText('Previous year'));
    expect(screen.getByText('2025')).toBeInTheDocument();
    await user.click(screen.getByLabelText('Next year'));
    await user.click(screen.getByLabelText('Next year'));
    expect(screen.getByText('2027')).toBeInTheDocument();
  });

  it('jumps to the month you pick', async () => {
    const { user, onPick } = setup();
    await user.click(screen.getByRole('button', { name: 'Feb •' }));
    expect(onPick).toHaveBeenCalledWith('2026-02');
  });

  it('counts everything in the journal on the All button', () => {
    setup();
    expect(screen.getByRole('button', { name: 'All · 3 items' })).toBeInTheDocument();
  });

  it('opens the all view', async () => {
    const { user, onAll } = setup();
    await user.click(screen.getByRole('button', { name: /^All/ }));
    expect(onAll).toHaveBeenCalledOnce();
  });

  it('shows which view is on', () => {
    setup({ all: true });
    expect(screen.getByRole('button', { name: /^All/ }).className).toMatch(/border-accent/);
  });
});
