'use client';

import { useEffect, type ReactNode } from 'react';

/**
 * The one popover every panel uses: a scrim behind it, a heading with a way
 * out, Escape to close. Each panel used to carry its own copy of this, which is
 * how one of them ended up impossible to close by any of the three.
 */
export function Popover({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/45" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-label={title}
        className={
          'fixed left-1/2 top-20 z-[80] flex max-h-[84vh] -translate-x-1/2 flex-col gap-2.5 ' +
          'overflow-auto rounded-2xl border border-line bg-panel p-3.5 shadow-[var(--shadow)] ' +
          (wide ? 'w-[min(460px,94vw)]' : 'w-[min(340px,94vw)]')
        }
      >
        <div className="flex items-center justify-between font-serif text-[19px] max-[640px]:text-[21px]">
          <span>{title}</span>
          <button
            className="flex h-8 w-8 items-center justify-center rounded-[9px] text-ink-2 hover:bg-bg-2 hover:text-ink"
            onClick={onClose}
            title="Close"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </>
  );
}
