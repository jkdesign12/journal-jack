/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useState } from 'react';
import userEvent from '@testing-library/user-event';
import { WIDGETS, WidgetBody, makeWidget } from './Widget';
import type { Block } from '@/lib/journal/types';

/* Covers FEATURES 12.1–12.7: the seven widgets. */

/* A widget writes straight onto its block and asks the app to redraw. In the
   app that is the store; here it has to be something, or a controlled input
   would reset itself on every keystroke and only the last one would stick. */
function Harness({ block, stats, onChange }: { block: Block; stats?: Parameters<typeof WidgetBody>[0]['stats']; onChange: () => void }) {
  const [, redraw] = useState(0);
  return (
    <WidgetBody
      block={block}
      stats={stats}
      onChange={() => {
        onChange();
        redraw((n) => n + 1);
      }}
    />
  );
}

function setup(block: Block, stats?: Parameters<typeof WidgetBody>[0]['stats']) {
  const onChange = vi.fn();
  render(<Harness block={block} stats={stats} onChange={onChange} />);
  return { user: userEvent.setup(), block, onChange };
}

describe('the widgets on offer', () => {
  it('is the same seven the original had', () => {
    expect(WIDGETS.map((w) => w.kind)).toEqual([
      'note',
      'heading',
      'quote',
      'checklist',
      'palette',
      'stats',
      'link',
    ]);
  });

  it('makes each one with something sensible already in it', () => {
    expect(makeWidget('heading').text).toBe('a good month');
    expect(makeWidget('checklist').items).toEqual([{ t: '', done: false }]);
    expect(makeWidget('palette').colors).toHaveLength(4);
    expect(makeWidget('note').id).not.toBe(makeWidget('note').id);
  });
});

describe('a sticky note', () => {
  it('takes what you type', async () => {
    const { user, block, onChange } = setup({ id: 'n', kind: 'note', text: '' });
    await user.type(screen.getByPlaceholderText('a note…'), 'went swimming');
    expect(block.text).toBe('went swimming');
    expect(onChange).toHaveBeenCalled();
  });
});

describe('big text and a quote', () => {
  it('edits the heading in place', async () => {
    const { user, block } = setup({ id: 'h', kind: 'heading', text: 'a good month' });
    await user.clear(screen.getByDisplayValue('a good month'));
    await user.type(screen.getByRole('textbox'), 'a quiet month');
    expect(block.text).toBe('a quiet month');
  });

  it('edits a quote in place', async () => {
    const { user, block } = setup({ id: 'q', kind: 'quote', text: '' });
    await user.type(screen.getByPlaceholderText('something worth keeping'), 'hello');
    expect(block.text).toBe('hello');
  });
});

describe('a checklist', () => {
  const list = (): Block => ({
    id: 'c',
    kind: 'checklist',
    title: 'To do',
    items: [
      { t: 'wash up', done: false },
      { t: 'call back', done: true },
    ],
  });

  it('shows each line and which are done', () => {
    setup(list());
    expect(screen.getByDisplayValue('wash up')).toBeInTheDocument();
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes[0]).not.toBeChecked();
    expect(boxes[1]).toBeChecked();
  });

  it('ticks a line off', async () => {
    const { user, block } = setup(list());
    await user.click(screen.getAllByRole('checkbox')[0]);
    expect(block.items![0].done).toBe(true);
  });

  it('adds the next line on Enter', async () => {
    const { user, block } = setup(list());
    await user.click(screen.getByDisplayValue('wash up'));
    await user.keyboard('{Enter}');
    expect(block.items).toHaveLength(3);
    expect(block.items![1]).toEqual({ t: '', done: false });
  });

  it('removes an empty line on backspace', async () => {
    const { user, block } = setup({
      id: 'c',
      kind: 'checklist',
      items: [{ t: 'one', done: false }, { t: '', done: false }],
    });
    const empty = screen.getAllByRole('textbox').at(-1)!;
    await user.click(empty);
    await user.keyboard('{Backspace}');
    expect(block.items).toHaveLength(1);
  });

  it('will not leave you with no lines at all', async () => {
    const { user, block } = setup({ id: 'c', kind: 'checklist', items: [{ t: '', done: false }] });
    await user.click(screen.getAllByRole('textbox').at(-1)!);
    await user.keyboard('{Backspace}');
    expect(block.items).toHaveLength(1);
  });
});

describe('a colour palette', () => {
  it('shows each colour and lets you change one', async () => {
    const block: Block = { id: 'p', kind: 'palette', title: 'Palette', colors: ['#111111', '#222222'] };
    const onChange = vi.fn();
    const { container } = render(<WidgetBody block={block} onChange={onChange} />);

    const inputs = container.querySelectorAll('input[type=color]');
    expect(inputs).toHaveLength(2);

    await userEvent.setup().click(inputs[0]);
    expect(block.colors).toHaveLength(2);
  });
});

describe('month stats', () => {
  it('counts what the month holds', () => {
    setup({ id: 's', kind: 'stats' }, { items: 12, films: 4, records: 6, photos: 2 });
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('films')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('6')).toBeInTheDocument();
  });

  it('shows zeroes rather than nothing for an empty month', () => {
    setup({ id: 's', kind: 'stats' });
    expect(screen.getAllByText('0')).toHaveLength(4);
  });
});

describe('a link card', () => {
  it('takes a name and an address, and offers to open it', async () => {
    const { user, block } = setup({ id: 'l', kind: 'link', title: '', url: '' });
    await user.type(screen.getByPlaceholderText('What is it'), 'the recipe');
    await user.type(screen.getByPlaceholderText('https://…'), 'https://example.com');

    expect(block.title).toBe('the recipe');
    expect(screen.getByRole('link', { name: 'Open ↗' })).toHaveAttribute('href', 'https://example.com');
  });

  it('offers nothing to open until there is an address', () => {
    setup({ id: 'l', kind: 'link', title: 'x', url: '' });
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
