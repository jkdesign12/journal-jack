'use client';

import type { Block, ChecklistItem } from '@/lib/journal/types';
import { uid } from '@/lib/journal/uid';

export interface WidgetSpec {
  kind: Block['kind'];
  label: string;
  make: () => Partial<Block>;
}

/** The things you can put on a board that are not photos or imports. */
export const WIDGETS: WidgetSpec[] = [
  { kind: 'note', label: 'Sticky note', make: () => ({ text: '', size: 'sm' }) },
  { kind: 'heading', label: 'Big text', make: () => ({ text: 'a good month', size: 'md' }) },
  { kind: 'quote', label: 'Quote', make: () => ({ text: '', size: 'md' }) },
  {
    kind: 'checklist',
    label: 'Checklist',
    make: () => ({ title: 'To do', items: [{ t: '', done: false }], size: 'sm' }),
  },
  {
    kind: 'palette',
    label: 'Colour palette',
    make: () => ({ title: 'Palette', colors: ['#e0a45e', '#c4736f', '#88a97f', '#7f97c4'], size: 'sm' }),
  },
  { kind: 'stats', label: 'Month stats', make: () => ({ size: 'sm' }) },
  { kind: 'link', label: 'Link card', make: () => ({ title: '', url: '', size: 'sm' }) },
];

export const makeWidget = (kind: Block['kind']): Block => {
  const spec = WIDGETS.find((w) => w.kind === kind)!;
  return { id: uid(), kind, ...spec.make() } as Block;
};

/** What a widget looks like on the board. Editing happens in place. */
export function WidgetBody({
  block,
  onChange,
  stats,
}: {
  block: Block;
  onChange: () => void;
  stats?: { items: number; films: number; records: number; photos: number };
}) {
  const edit = (patch: Partial<Block>) => {
    Object.assign(block, patch);
    onChange();
  };

  switch (block.kind) {
    case 'note':
      return (
        <textarea
          className="h-full w-full resize-none bg-transparent p-3 text-[12.5px] leading-relaxed outline-none"
          placeholder="a note…"
          value={block.text ?? ''}
          onChange={(e) => edit({ text: e.target.value })}
        />
      );

    case 'heading':
      return (
        <textarea
          className="h-full w-full resize-none bg-transparent p-3 font-serif text-[28px] leading-tight outline-none"
          value={block.text ?? ''}
          onChange={(e) => edit({ text: e.target.value })}
        />
      );

    case 'quote':
      return (
        <div className="flex h-full flex-col p-3">
          <span className="font-serif text-2xl leading-none text-ink-3">&ldquo;</span>
          <textarea
            className="flex-1 resize-none bg-transparent font-serif text-[16px] italic leading-snug outline-none"
            placeholder="something worth keeping"
            value={block.text ?? ''}
            onChange={(e) => edit({ text: e.target.value })}
          />
        </div>
      );

    case 'checklist': {
      const items: ChecklistItem[] = block.items ?? [];
      const write = (next: ChecklistItem[]) => edit({ items: next });
      return (
        <div className="flex h-full flex-col gap-1.5 overflow-auto p-3">
          <input
            className="bg-transparent text-[10.5px] uppercase tracking-[0.12em] text-ink-3 outline-none"
            value={block.title ?? ''}
            onChange={(e) => edit({ title: e.target.value })}
          />
          {items.map((item, i) => (
            <label key={i} className="flex items-center gap-2 text-[12.5px]">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 flex-none accent-[var(--accent)]"
                checked={item.done}
                onChange={(e) =>
                  write(items.map((x, j) => (j === i ? { ...x, done: e.target.checked } : x)))
                }
              />
              <input
                className={
                  'min-w-0 flex-1 bg-transparent outline-none ' +
                  (item.done ? 'text-ink-3 line-through' : '')
                }
                value={item.t}
                placeholder="…"
                onChange={(e) => write(items.map((x, j) => (j === i ? { ...x, t: e.target.value } : x)))}
                onKeyDown={(e) => {
                  // Enter adds the next line, which is how a list gets written
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    write([...items.slice(0, i + 1), { t: '', done: false }, ...items.slice(i + 1)]);
                  }
                  if (e.key === 'Backspace' && !item.t && items.length > 1) {
                    e.preventDefault();
                    write(items.filter((_, j) => j !== i));
                  }
                }}
              />
            </label>
          ))}
        </div>
      );
    }

    case 'palette':
      return (
        <div className="flex h-full flex-col p-3">
          <input
            className="mb-2 bg-transparent text-[10.5px] uppercase tracking-[0.12em] text-ink-3 outline-none"
            value={block.title ?? ''}
            onChange={(e) => edit({ title: e.target.value })}
          />
          <div className="flex flex-1 gap-1.5">
            {(block.colors ?? []).map((c, i) => (
              <label key={i} className="flex-1 cursor-pointer rounded-lg" style={{ background: c }}>
                <input
                  type="color"
                  className="h-full w-full cursor-pointer opacity-0"
                  value={c}
                  onChange={(e) =>
                    edit({ colors: (block.colors ?? []).map((x, j) => (j === i ? e.target.value : x)) })
                  }
                />
              </label>
            ))}
          </div>
        </div>
      );

    case 'stats':
      return (
        <div className="flex h-full flex-col justify-center gap-1 p-3 text-[12.5px]">
          <Stat n={stats?.items ?? 0} label="things this month" />
          <Stat n={stats?.films ?? 0} label="films" />
          <Stat n={stats?.records ?? 0} label="records" />
          <Stat n={stats?.photos ?? 0} label="photos" />
        </div>
      );

    case 'link':
      return (
        <div className="flex h-full flex-col gap-1.5 p-3">
          <input
            className="bg-transparent text-[13px] font-medium outline-none"
            placeholder="What is it"
            value={block.title ?? ''}
            onChange={(e) => edit({ title: e.target.value })}
          />
          <input
            className="bg-transparent text-[11.5px] text-ink-3 outline-none"
            placeholder="https://…"
            value={block.url ?? ''}
            onChange={(e) => edit({ url: e.target.value })}
          />
          {block.url ? (
            <a
              className="mt-auto text-[11.5px] text-accent"
              href={block.url}
              target="_blank"
              rel="noreferrer"
            >
              Open ↗
            </a>
          ) : null}
        </div>
      );

    default:
      return null;
  }
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <b className="font-serif text-[22px] leading-none">{n}</b>
      <span className="text-[11.5px] text-ink-3">{label}</span>
    </div>
  );
}
