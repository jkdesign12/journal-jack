export const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

export const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export const pad = (n: number): string => String(n).padStart(2, '0');

export const monthKey = (year: number, month: number): string => `${year}-${pad(month)}`;

export function cursorParts(cursor: string): { year: number; month: number } {
  const [year, month] = cursor.split('-').map(Number);
  return { year, month };
}

/** The month `delta` away from this one, wrapping years as it goes. */
export function shiftMonth(cursor: string, delta: number): string {
  const { year, month } = cursorParts(cursor);
  const d = new Date(year, month - 1 + delta, 1);
  return monthKey(d.getFullYear(), d.getMonth() + 1);
}

/** Which day of the week the first falls on, and how many days there are. */
export function monthShape(cursor: string): { firstDay: number; days: number } {
  const { year, month } = cursorParts(cursor);
  return {
    firstDay: new Date(year, month - 1, 1).getDay(),
    days: new Date(year, month, 0).getDate(),
  };
}
