/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Header, NOT_YET } from './Header';
import { defaultView, type ViewState } from '@/lib/client/view';
import type { SortMode } from '@/lib/journal/sort';

/* Covers FEATURES 7.1–7.2, 7.6, 9.1 and 17: the header and everything it opens. */

const view = (over: Partial<ViewState> = {}): ViewState => ({
  ...defaultView(),
  cursor: '2026-09',
  ...over,
});

type Span = { first?: string; last?: string };

function setup(
  over: Partial<ViewState> = {},
  span: Span = { first: '2022', last: '2026' },
  state: { signedIn?: boolean; busy?: boolean; canReset?: boolean; order?: SortMode } = {},
) {
  const handlers = {
    onShift: vi.fn(),
    onView: vi.fn(),
    onSort: vi.fn(),
    onOpenMonths: vi.fn(),
    onOpenAccount: vi.fn(),
    onOpenTags: vi.fn(),
    onOpenMedia: vi.fn(),
    onOpenWidgets: vi.fn(),
    onOpenSync: vi.fn(),
    onOpenMenu: vi.fn(),
    onSync: vi.fn(),
    onResetLayout: vi.fn(),
  };

  render(
    <Header
      view={view(over)}
      order={state.order ?? ((over.sort as SortMode) ?? 'manual')}
      span={span}
      signedIn={state.signedIn ?? false}
      busy={state.busy ?? false}
      canReset={state.canReset ?? false}
      {...handlers}
    />,
  );
  return { user: userEvent.setup(), ...handlers };
}

describe('the header', () => {
  it('names the month you are looking at', () => {
    setup();
    expect(screen.getByText('September')).toBeInTheDocument();
    expect(screen.getByText('2026')).toBeInTheDocument();
  });

  it('says Everything, and the span it covers, in the all view', () => {
    setup({ all: true });
    expect(screen.getByText('Everything')).toBeInTheDocument();
    expect(screen.getByText('2022–2026')).toBeInTheDocument();
  });

  it('shows a single year rather than a range when that is all there is', () => {
    setup({ all: true }, { first: '2026', last: '2026' });
    expect(screen.getByText('2026')).toBeInTheDocument();
  });

  it('says nothing about a span for an empty journal', () => {
    setup({ all: true }, { first: undefined, last: undefined });
    expect(screen.getByText('Everything')).toBeInTheDocument();
  });

  it('steps a month in each direction', async () => {
    const { user, onShift } = setup();
    await user.click(screen.getByLabelText('Previous month'));
    await user.click(screen.getByLabelText('Next month'));
    expect(onShift.mock.calls).toEqual([[-1], [1]]);
  });

  it('opens the month picker when the month is clicked', async () => {
    const { user, onOpenMonths } = setup();
    await user.click(screen.getByText('September'));
    expect(onOpenMonths).toHaveBeenCalledOnce();
  });

  it('switches between the grid and the calendar', async () => {
    const { user, onView } = setup();
    await user.click(screen.getByRole('button', { name: 'calendar' }));
    expect(onView).toHaveBeenCalledWith('calendar');
  });

  it('marks which view is showing', () => {
    setup({ view: 'calendar' });
    expect(screen.getByRole('button', { name: 'calendar' }).className).toMatch(/bg-panel/);
    expect(screen.getByRole('button', { name: 'grid' }).className).not.toMatch(/bg-panel/);
  });

  it('offers every order, named the way they read', () => {
    setup();
    const orders = screen.getByTitle('Order') as HTMLSelectElement;
    const labels = [...orders.options].map((o) => o.textContent);
    expect(labels).toContain('Custom order');
    expect(labels).toContain('Newest first');
    // the one that groups by tag says so, rather than saying "source"
    expect(labels).toContain('By tag');
  });

  it('changes the order', async () => {
    const { user, onSort } = setup();
    await user.selectOptions(screen.getByTitle('Order'), 'title');
    expect(onSort).toHaveBeenCalledWith('title');
  });
});

describe('the controls that open things', () => {
  it('opens media, widgets, tags, sync and the menu', async () => {
    const { user, onOpenMedia, onOpenWidgets, onOpenTags, onOpenSync, onOpenMenu } = setup();

    await user.click(screen.getByRole('button', { name: '＋ Media' }));
    await user.click(screen.getByRole('button', { name: 'Widget' }));
    await user.click(screen.getByRole('button', { name: 'Tags' }));
    await user.click(screen.getByRole('button', { name: 'Sync' }));
    await user.click(screen.getByLabelText('More'));

    expect(onOpenMedia).toHaveBeenCalledOnce();
    expect(onOpenWidgets).toHaveBeenCalledOnce();
    expect(onOpenTags).toHaveBeenCalledOnce();
    expect(onOpenSync).toHaveBeenCalledOnce();
    expect(onOpenMenu).toHaveBeenCalledOnce();
  });

  it('says how many tags are switched off', () => {
    setup({ hiddenTags: ['Movie', 'Music'] });
    const tags = screen.getByRole('button', { name: 'Tags · 2 off' });
    expect(tags.className).toMatch(/border-accent/);
  });

  /* Only worth offering where there is a hand-made layout to undo: in a sorted
     view or the all view, positions are not being kept anyway. */
  it('offers to reset the layout only where that means something', async () => {
    expect(screen.queryByRole('button', { name: 'Reset layout' })).not.toBeInTheDocument();

    const { user, onResetLayout } = setup({}, undefined, { canReset: true });
    await user.click(screen.getByRole('button', { name: 'Reset layout' }));
    expect(onResetLayout).toHaveBeenCalledOnce();
  });
});

describe('the account', () => {
  it('offers a way in when nobody is signed in', async () => {
    const { user, onOpenAccount } = setup();
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(onOpenAccount).toHaveBeenCalledOnce();
  });

  it('says Account once you are in', () => {
    setup({}, undefined, { signedIn: true });
    expect(screen.getByRole('button', { name: 'Account' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument();
  });

  it('offers to sync only once there is an account to sync with', () => {
    setup();
    expect(screen.queryByRole('button', { name: 'Sync now' })).not.toBeInTheDocument();

    setup({}, undefined, { signedIn: true });
    expect(screen.getByRole('button', { name: 'Sync now' })).toBeInTheDocument();
  });

  it('syncs when asked', async () => {
    const { user, onSync } = setup({}, undefined, { signedIn: true });
    await user.click(screen.getByRole('button', { name: 'Sync now' }));
    expect(onSync).toHaveBeenCalledOnce();
  });

  it('will not start a second sync on top of the first', () => {
    setup({}, undefined, { signedIn: true, busy: true });
    expect(screen.getByRole('button', { name: 'Syncing…' })).toBeDisabled();
  });
});

/* This list held the buttons that were drawn but dead. It is empty now, and
   this test is what keeps it honest: put something back on it without wiring
   it up, and say so here. */
describe('the parts that are not ported yet', () => {
  it('is nothing — every control does something', () => {
    expect(NOT_YET).toEqual([]);
  });
});

/* Grouping by month is only offered where it means something, and the dropdown
   has to say what is actually happening rather than what is stored. */
describe('grouping by month', () => {
  it('is offered in the everything view', () => {
    setup({ all: true });
    const orders = screen.getByTitle('Order') as HTMLSelectElement;
    expect([...orders.options].map((o) => o.textContent)).toContain('By month');
  });

  it('is not offered inside a single month, where it would be one heading', () => {
    setup({ all: false });
    const orders = screen.getByTitle('Order') as HTMLSelectElement;
    expect([...orders.options].map((o) => o.textContent)).not.toContain('By month');
  });

  /* Leaving the everything view falls back to newest first. The dropdown used
     to keep showing "Custom order" while the board was doing something else. */
  it('shows the order in force, not the one that is stored', () => {
    setup({ all: false, sort: 'month' }, undefined, { order: '-date' });
    const orders = screen.getByTitle('Order') as HTMLSelectElement;
    expect(orders.value).toBe('-date');
  });
});
