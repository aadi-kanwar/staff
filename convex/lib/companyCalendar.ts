/**
 * The company calendar: every month has exactly 30 days.
 *
 * All pay maths runs on "day indices" in this virtual calendar:
 *   dayIndex(y, m, d) = y*360 + (m-1)*30 + (d-1),   d = 1..30
 *
 * - The 31st of a real month does not exist here. Attendance may still be
 *   recorded on it, but pay maths ignores it (fromRealDate returns null).
 * - February always has 30 company days. Feb 29 (in non-leap years) and
 *   Feb 30 (always) are "virtual": they have no real date, count as paid
 *   days, and a payday falling on one is paid on the next real date (Mar 1).
 *   Schedules are always counted from the virtual index, never from the
 *   rolled-forward real date.
 *
 * Pure TypeScript: no Convex, no clock, no timezone. Real dates are
 * "YYYY-MM-DD" strings that are already in Asia/Kolkata.
 */

export type CompanyDate = { y: number; m: number; d: number };

export const DAYS_PER_MONTH = 30;
export const DAYS_PER_YEAR = 360;

function assertInt(name: string, value: number) {
  if (!Number.isInteger(value)) throw new Error(`${name} must be an integer, got ${value}`);
}

export function dayIndex(y: number, m: number, d: number): number {
  assertInt("y", y);
  assertInt("m", m);
  assertInt("d", d);
  if (m < 1 || m > 12) throw new Error(`Month out of range: ${m}`);
  if (d < 1 || d > DAYS_PER_MONTH) throw new Error(`Company day out of range: ${d}`);
  return y * DAYS_PER_YEAR + (m - 1) * DAYS_PER_MONTH + (d - 1);
}

/** The inverse of dayIndex. */
export function fromIndex(index: number): CompanyDate {
  assertInt("index", index);
  const y = Math.floor(index / DAYS_PER_YEAR);
  const rest = index - y * DAYS_PER_YEAR;
  const m = Math.floor(rest / DAYS_PER_MONTH) + 1;
  const d = rest - (m - 1) * DAYS_PER_MONTH + 1;
  return { y, m, d };
}

export function addDays(index: number, n: number): number {
  return index + n;
}

export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/** Days in the real (Gregorian) month. */
export function realDaysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Feb 29 in a non-leap year, and Feb 30 always: days with no real date. */
export function isVirtual(index: number): boolean {
  const { y, m, d } = fromIndex(index);
  return m === 2 && d > realDaysInMonth(y, 2);
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

export function isoDate(y: number, m: number, d: number): string {
  return `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
}

export function parseIsoDate(date: string): CompanyDate {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error(`Not a YYYY-MM-DD date: ${date}`);
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (m < 1 || m > 12 || d < 1 || d > realDaysInMonth(y, m)) throw new Error(`Not a real date: ${date}`);
  return { y, m, d };
}

/**
 * The real date ("YYYY-MM-DD") of a company day. Virtual February days roll
 * forward to the next real date, Mar 1.
 */
export function toRealDate(index: number): string {
  const { y, m, d } = fromIndex(index);
  if (isVirtual(index)) return isoDate(y, 3, 1);
  return isoDate(y, m, d);
}

/** The company day of a real date, or null for the 31st (which doesn't exist for pay). */
export function fromRealDate(date: string): number | null {
  const { y, m, d } = parseIsoDate(date);
  if (d === 31) return null;
  return dayIndex(y, m, d);
}

/** A joining date: the 31st counts as the 1st of the next month. */
export function joinIndexFromRealDate(date: string): number {
  const { y, m, d } = parseIsoDate(date);
  if (d === 31) return m === 12 ? dayIndex(y + 1, 1, 1) : dayIndex(y, m + 1, 1);
  return dayIndex(y, m, d);
}

/**
 * "Which company days have fully started by this real date": the 31st maps
 * to the 30th of its month (the 30th is already over). Used for "today".
 */
export function indexOnOrBefore(date: string): number {
  const { y, m, d } = parseIsoDate(date);
  return dayIndex(y, m, Math.min(d, DAYS_PER_MONTH));
}

/** The first company day of the month containing `index`. */
export function monthStart(index: number): number {
  const { y, m } = fromIndex(index);
  return dayIndex(y, m, 1);
}

/** The 30th of the month containing `index`. */
export function monthEnd(index: number): number {
  return monthStart(index) + DAYS_PER_MONTH - 1;
}

/** The 10th of the month after the one containing `index`. */
export function tenthOfNextMonth(index: number): number {
  return monthStart(index) + DAYS_PER_MONTH + 9;
}

/** Real calendar arithmetic on YYYY-MM-DD strings. */
export function addRealDays(date: string, days: number): string {
  const { y, m, d } = parseIsoDate(date);
  const result = new Date(Date.UTC(y, m - 1, d + days));
  return result.toISOString().slice(0, 10);
}

/** Every real date of a real month, in order. */
export function realDatesOfMonth(y: number, m: number): string[] {
  return Array.from({ length: realDaysInMonth(y, m) }, (_, i) => isoDate(y, m, i + 1));
}
