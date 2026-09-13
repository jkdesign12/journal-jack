/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MENU_ITEMS, Menu } from './Menu';

/* Covers FEATURES 17.1–17.10: everything behind the ⋯ button. */

function setup() {
  const onPick = vi.fn();
  const onClose = vi.fn();
  render(<Menu onPick={onPick} onClose={onClose} />);
  return { user: userEvent.setup(), onPick, onClose };
}

describe('the menu', () => {
  it('offers every item the original had, in the same order', () => {
    setup();
    expect(screen.getAllByRole('menuitem').map((b) => b.textContent)).toEqual([
      'Colours for this year…',
      'Toggle light / dark',
      'Export journal (.json)',
      'Import journal…',
      'Sync with account (merge)',
      'Upload missing files',
      'Find missing posters',
      'Merge duplicate imports',
      'Load a sample month',
      'Erase this month',
    ]);
  });

  it('marks the one that destroys something', () => {
    setup();
    const erase = screen.getByRole('menuitem', { name: 'Erase this month' });
    expect(erase.className).toMatch(/e2725b/);
  });

  it('says which item was picked', async () => {
    const { user, onPick } = setup();
    for (const item of MENU_ITEMS) {
      await user.click(screen.getByRole('menuitem', { name: item.label }));
    }
    expect(onPick.mock.calls.map((c) => c[0])).toEqual(MENU_ITEMS.map((i) => i.act));
  });

  it('closes on Escape', async () => {
    const { user, onClose } = setup();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });
});
