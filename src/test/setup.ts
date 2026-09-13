import '@testing-library/jest-dom/vitest';

/* jsdom has no ResizeObserver, and the board asks for one to know how wide it
   is. There is no layout in jsdom for it to report anyway, so this is a stub
   rather than a fake: it lets a component mount, and how a board actually packs
   is tested against the layout functions directly, where the numbers are real. */
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
