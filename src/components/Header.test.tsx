/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Header, NOT_YET } from './Header';
import { defaultView, type ViewState } from '@/lib/client/view';

const view = (over: Partial<ViewState> = {}): ViewState => ({
  ...defaultView(),
  cursor: '2026-09',
  ...over,
});

function setup(over: Partial<ViewState> = {}, span = { first: '2022', last: '2026' }) {
  const handlers = {
    onShift: vi.fn(),
    onView: vi.fn(),
    onSort: vi.fn(),
    onOpenMonths: vi.fn(),
  };
  render(<Header view={view(over)} span={span} {...handlers} />);
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

/* The port is not finished, and the header is where that shows. These hold the
   unfinished buttons to admitting it: wire one up and leave it disabled, and
   this fails. It is meant to. */
describe('the parts that are not ported yet', () => {
  it.each(NOT_YET)('%s says it does not work rather than pretending', (label) => {
    setup();
    const el = screen.getByRole('button', { name: label });
    expect(el).toBeDisabled();
    expect(el).toHaveAttribute('title', expect.stringMatching(/not ported yet/));
  });

  it('cannot be clicked into doing nothing', async () => {
    const { user } = setup();
    const signIn = screen.getByRole('button', { name: 'Sign in' });
    await user.click(signIn);
    // nothing to assert about a result: the point is that the click is refused
    expect(signIn).toBeDisabled();
  });

  it('names exactly what is still missing, so the list cannot rot quietly', () => {
    expect(NOT_YET).toEqual(['＋ Media', 'Widget', 'Sync', 'Sign in']);
  });
});
