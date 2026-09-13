import { describe, it, expect } from 'vitest';
import { cursorParts, monthKey, monthShape, pad, shiftMonth } from './dates';

describe('moving between months', () => {
  it('steps forward and back', () => {
    expect(shiftMonth('2026-06', 1)).toBe('2026-07');
    expect(shiftMonth('2026-06', -1)).toBe('2026-05');
  });

  it('crosses a year boundary in both directions', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
  });

  it('keeps the two-digit form a month key needs to sort', () => {
    expect(shiftMonth('2026-09', 1)).toBe('2026-10');
    expect(shiftMonth('2026-10', -1)).toBe('2026-09');
    expect(monthKey(2026, 3)).toBe('2026-03');
    expect(pad(7)).toBe('07');
  });

  it('can step a long way without drifting', () => {
    expect(shiftMonth('2026-06', 12)).toBe('2027-06');
    expect(shiftMonth('2026-06', -18)).toBe('2024-12');
  });

  it('reads a cursor back apart', () => {
    expect(cursorParts('2022-02')).toEqual({ year: 2022, month: 2 });
  });
});

describe('the shape of a month', () => {
  it('knows how long a month is', () => {
    expect(monthShape('2026-01').days).toBe(31);
    expect(monthShape('2026-04').days).toBe(30);
  });

  it('knows February in a leap year and out of one', () => {
    expect(monthShape('2024-02').days).toBe(29);
    expect(monthShape('2026-02').days).toBe(28);
    expect(monthShape('2000-02').days).toBe(29); // divisible by 400
    expect(monthShape('1900-02').days).toBe(28); // divisible by 100 but not 400
  });

  it('says which day of the week the first falls on', () => {
    // 1 September 2026 is a Tuesday
    expect(monthShape('2026-09').firstDay).toBe(2);
  });
});
