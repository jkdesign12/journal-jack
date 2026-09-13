'use client';

import { useEffect, useRef } from 'react';

export type MenuAction =
  | 'colours'
  | 'theme'
  | 'export'
  | 'import'
  | 'sync'
  | 'files'
  | 'posters'
  | 'dedupe'
  | 'sample'
  | 'clear';

const ITEMS: Array<{ act: MenuAction; label: string; danger?: boolean }> = [
  { act: 'colours', label: 'Colours for this year…' },
  { act: 'theme', label: 'Toggle light / dark' },
  { act: 'export', label: 'Export journal (.json)' },
  { act: 'import', label: 'Import journal…' },
  { act: 'sync', label: 'Sync with account (merge)' },
  { act: 'files', label: 'Upload missing files' },
  { act: 'posters', label: 'Find missing posters' },
  { act: 'dedupe', label: 'Merge duplicate imports' },
  { act: 'sample', label: 'Load a sample month' },
  { act: 'clear', label: 'Erase this month', danger: true },
];

export function Menu({ onPick, onClose }: { onPick: (act: MenuAction) => void; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      <div className="fixed inset-0 z-50" onClick={onClose} aria-hidden />
      <div
        ref={box}
        role="menu"
        className="fixed right-4 top-16 z-[80] flex w-[min(260px,92vw)] flex-col rounded-2xl border border-line bg-panel p-1.5 shadow-[var(--shadow)]"
      >
        {ITEMS.map((item) => (
          <button
            key={item.act}
            role="menuitem"
            className={
              'rounded-[9px] px-3 py-2.5 text-left text-[13px] hover:bg-bg-2 ' +
              'max-[640px]:py-3.5 max-[640px]:text-[15px] ' +
              (item.danger ? 'text-[#e2725b]' : '')
            }
            onClick={() => onPick(item.act)}
          >
            {item.label}
          </button>
        ))}
      </div>
    </>
  );
}

export { ITEMS as MENU_ITEMS };
