/** Short, sortable-ish, and unique enough that a tombstone can never collide
 *  with a block made later. */
export const uid = (): string =>
  Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
