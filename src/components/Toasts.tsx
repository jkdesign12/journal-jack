'use client';

import { useEffect, useState } from 'react';

export interface Toast {
  id: number;
  text: string;
  bad?: boolean;
}

let nextId = 1;
const listeners = new Set<(t: Toast) => void>();

/** Say something, briefly. Anywhere in the app can call this. */
export function toast(text: string, bad?: boolean): void {
  const t = { id: nextId++, text, bad };
  for (const fn of listeners) fn(t);
}

export function Toasts() {
  const [items, setItems] = useState<Toast[]>([]);

  useEffect(() => {
    const add = (t: Toast) => {
      setItems((list) => [...list, t]);
      // long enough to read a sentence, short enough not to sit in the way
      setTimeout(() => setItems((list) => list.filter((x) => x.id !== t.id)), 4200);
    };
    listeners.add(add);
    return () => {
      listeners.delete(add);
    };
  }, []);

  if (!items.length) return null;

  return (
    <div className="pointer-events-none fixed bottom-5 left-1/2 z-[90] flex w-[min(520px,92vw)] -translate-x-1/2 flex-col gap-2">
      {items.map((t) => (
        <div
          key={t.id}
          role="status"
          className={
            'rounded-xl border px-3.5 py-2.5 text-[12.5px] shadow-[var(--shadow)] backdrop-blur-md ' +
            (t.bad
              ? 'border-[#e2725b]/60 bg-[#3a1f1a]/95 text-[#ffd9d0]'
              : 'border-line bg-panel/95 text-ink')
          }
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}
