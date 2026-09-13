'use client';

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/**
 * The one popover every panel uses: a scrim behind it, a heading with a way out,
 * Escape to close. Each panel used to carry its own copy of this, which is how
 * one of them ended up impossible to close by any of the three.
 *
 * It sits under the control that opened it, because a panel that appears
 * somewhere else makes you look for it. On a narrow screen there is nowhere
 * sensible to anchor to, so it goes to the middle instead.
 */
export function Popover({
  title,
  onClose,
  children,
  wide,
  anchor,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  /** the element this belongs under, if there is one */
  anchor?: HTMLElement | null;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useLayoutEffect(() => {
    if (!anchor || !box.current) return;
    if (window.innerWidth <= 640) return; // no room to anchor on a phone

    const place = () => {
      const a = anchor.getBoundingClientRect();
      const w = box.current!.offsetWidth;
      setAt({
        // kept on screen: never off the right edge, never tight against the left
        left: Math.max(12, Math.min(window.innerWidth - w - 12, a.left)),
        top: a.bottom + 8,
      });
    };

    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [anchor]);

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/45" onClick={onClose} aria-hidden />
      <div
        ref={box}
        role="dialog"
        aria-label={title}
        style={at ? { left: at.left, top: at.top, transform: 'none' } : undefined}
        className={
          'pops fixed left-1/2 top-20 z-[80] flex max-h-[84vh] -translate-x-1/2 flex-col gap-2.5 ' +
          'overflow-auto rounded-2xl border border-line bg-panel p-3.5 shadow-[var(--shadow)] ' +
          (wide ? 'w-[min(460px,94vw)]' : 'w-[min(340px,94vw)]')
        }
      >
        <div className="flex items-center justify-between font-serif text-[19px] max-[640px]:text-[21px]">
          <span>{title}</span>
          <button
            className="flex h-8 w-8 items-center justify-center rounded-[9px] text-ink-2 hover:bg-bg-2 hover:text-ink max-[640px]:h-[46px] max-[640px]:w-[46px]"
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
