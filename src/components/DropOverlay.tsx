'use client';

/** While files are over the window: what will happen if you let go. */
export function DropOverlay({ over }: { over: boolean }) {
  if (!over) return null;

  return (
    <div className="pointer-events-none fixed inset-3 z-[200] flex items-end justify-center rounded-[20px] border-2 border-dashed border-accent bg-[color-mix(in_srgb,var(--accent)_7%,transparent)] pb-6 font-serif text-[22px] text-accent">
      drop to add
    </div>
  );
}
