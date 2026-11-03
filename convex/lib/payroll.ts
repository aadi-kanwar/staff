/**
 * The payroll engine. Pure: it takes one person's salary terms, attendance,
 * adjustments and payments, plus "today", and computes every payday. Paydays
 * are never stored; they're derived here every time, so an attendance
 * correction or a salary revision is reflected everywhere at once.
 *
 * All maths runs on the 30-day company calendar (./companyCalendar).
 * Money is in rupees and kept exact until the final payout line of each
 * payday, which is rounded to the nearest rupee.
 *
 * CONFIDENTIAL: what this file returns includes pay modes, cycle boundaries
 * and per-day values. It must only ever reach admins. Staff get the
 * purpose-built summaries in convex/staff.ts.
 */
import {
  DAYS_PER_MONTH,
  addDays,
  fromRealDate,
  indexOnOrBefore,
  isVirtual,
  joinIndexFromRealDate,
  monthEnd,
  tenthOfNextMonth,
  toRealDate,
} from "./companyCalendar";

export const PAY_MODES = ["monthly_10th", "half_16day"] as const;
export type PayMode = (typeof PAY_MODES)[number];

/** Admin-only labels. Never shown to staff. */
export const PAY_MODE_LABELS: Record<PayMode, string> = {
  monthly_10th: "Monthly (10th)",
  half_16day: "Half-salary (16-day)",
};

export const ATTENDANCE_STATUSES = ["present", "absent", "half_day", "paid_leave", "week_off"] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export const ATTENDANCE_WEIGHTS: Record<AttendanceStatus, number> = {
  present: 1,
  half_day: 0.5,
  paid_leave: 1,
  week_off: 1,
  absent: 0,
};

export const ADJUSTMENT_TYPES = ["advance", "deduction", "bonus"] as const;
export type AdjustmentType = (typeof ADJUSTMENT_TYPES)[number];

export const RESERVE_STATUSES = ["held", "released", "forfeited"] as const;
export type ReserveStatus = (typeof RESERVE_STATUSES)[number];

export type PaydayStatus = "upcoming" | "due" | "partially_paid" | "paid";

/** The first 10 company days from joining are withheld as the Joining Reserve. */
export const RESERVE_DAYS = 10;
/** Mode A ("Half-salary (16-day)") cycle length. */
export const HALF_CYCLE_DAYS = 16;
/** How many future paydays a schedule shows by default. */
export const DEFAULT_UPCOMING = 6;

export type Terms = { effectiveFromIndex: number; monthlySalary: number; payMode: PayMode };

export type AdjustmentInput = {
  id: string;
  type: AdjustmentType;
  amount: number;
  paydayKey: string;
  note: string;
  date: string;
};

export type PaymentInput = {
  id: string;
  paydayKey: string;
  amount: number;
  paidOn: string;
  mode: string;
  note?: string;
};

export type EngineInput = {
  staffId: string;
  /** Real date (YYYY-MM-DD, Asia/Kolkata). The 31st counts as the 1st of the next month. */
  joinDate: string;
  /** Salary history; any order. The first one is the terms at joining. */
  terms: Terms[];
  /** Attendance by real date. */
  attendance: Record<string, AttendanceStatus>;
  adjustments: AdjustmentInput[];
  payments: PaymentInput[];
  /** Real date of today in Asia/Kolkata. */
  today: string;
  /** Unmarked past days from this real date on are flagged as "unmarked" (earlier: tracking hadn't begun). */
  attendanceFrom?: string;
  /** Set when the person is leaving: the last day they work. */
  lastWorkingDay?: string | null;
  reserveStatus: ReserveStatus;
  /** How many paydays after today to include (default 6). Ignored once a last working day is set. */
  upcoming?: number;
};

export type DayCounts = Record<AttendanceStatus, number> & { virtual: number; unmarked: number; uncounted: number };

export type AttendanceTally = {
  days: number;
  paidDays: number;
  counts: DayCounts;
  /** Past real dates with no attendance mark (counted as Present). */
  unmarkedDates: string[];
};

export type Payday = {
  key: string;
  /** The payday on the company calendar (may be virtual; the key is built from it). */
  paydayIndex: number;
  /** When it's actually due: the real date of the payday, or the day after the last working day for leavers. */
  dueDate: string;
  cycleStartIndex: number;
  cycleEndIndex: number;
  cycleStartDate: string;
  cycleEndDate: string;
  payMode: PayMode;
  monthlySalary: number;
  /** Value of one paid day in this cycle (exact, unrounded). */
  dayRate: number;
  /** True for the leaver's last, cut-short cycle. */
  isFinal: boolean;
  tally: AttendanceTally;
  /** What the cycle pays with full attendance (exact). */
  fullEarning: number;
  /** Attendance-adjusted earning (exact). */
  earning: number;
  absentDeduction: number;
  halfDayDeduction: number;
  bonus: number;
  deduction: number;
  advance: number;
  adjustments: AdjustmentInput[];
  payments: PaymentInput[];
  /** earning + bonus − deduction − advance, rounded to the rupee. */
  net: number;
  paid: number;
  outstanding: number;
  status: PaydayStatus;
};

export type Reserve = {
  startIndex: number;
  endIndex: number;
  startDate: string;
  endDate: string;
  monthlySalary: number;
  tally: AttendanceTally;
  /** monthlySalary × 10/30 minus absent and half days at monthlySalary/30 (exact). */
  exactAmount: number;
  amount: number;
  status: ReserveStatus;
};

export type FinalSettlement = {
  key: string;
  dueDate: string;
  lastWorkingDay: string;
  reserveAmount: number;
  reserveIncluded: boolean;
  unsettledAdjustments: AdjustmentInput[];
  unsettledTotal: number;
  /** Reserve + unsettled adjustments, rounded. Paid against `key`. */
  extrasNet: number;
  extrasPaid: number;
  extrasOutstanding: number;
  /** Earnings of the cut-short last cycle (exact; it's also one of the paydays). */
  finalCycleEarning: number;
  /** What's still owed on every payday (including the final cycle). */
  paydaysOutstanding: number;
  /** Everything still to pay to close the account. */
  totalOutstanding: number;
  payments: PaymentInput[];
};

export type Schedule = {
  joinIndex: number;
  earningStartIndex: number;
  todayIndex: number;
  paydays: Payday[];
  reserve: Reserve;
  /** Company owes now: Σ outstanding of cycle paydays due on or before today. Excludes the reserve. */
  pending: number;
  /** The first payday due after today (projected, assuming Present for the remaining days). */
  next: Payday | null;
  /** Adjustments that point at no payday in this schedule (e.g. too far ahead, or after an exit). */
  unsettledAdjustments: AdjustmentInput[];
  /** Present once a last working day is set. */
  settlement: FinalSettlement | null;
};

export const paydayKey = (staffId: string, paydayIndex: number) => `${staffId}:${paydayIndex}`;
export const finalKey = (staffId: string) => `${staffId}:final`;

/** Value of one paid day: Mode A pays half the salary per 16 days, Mode B the salary per 30 days. */
export function dayRateFor(payMode: PayMode, monthlySalary: number): number {
  return payMode === "half_16day" ? monthlySalary / 2 / HALF_CYCLE_DAYS : monthlySalary / DAYS_PER_MONTH;
}

/** Exact earning for `paidDays` (one division, so halves stay exact). */
function earningFor(payMode: PayMode, monthlySalary: number, paidDays: number): number {
  const divisor = payMode === "half_16day" ? 2 * HALF_CYCLE_DAYS : DAYS_PER_MONTH;
  return (monthlySalary * paidDays) / divisor;
}

export function sortTerms(terms: Terms[]): Terms[] {
  return [...terms].sort((a, b) => a.effectiveFromIndex - b.effectiveFromIndex);
}

const emptyCounts = (): DayCounts => ({
  present: 0,
  absent: 0,
  half_day: 0,
  paid_leave: 0,
  week_off: 0,
  virtual: 0,
  unmarked: 0,
  uncounted: 0,
});

/** Paid days in [start, end] (company days). */
export function tallyAttendance(
  startIndex: number,
  endIndex: number,
  attendance: Record<string, AttendanceStatus>,
  today: string,
  attendanceFrom?: string,
): AttendanceTally {
  const counts = emptyCounts();
  const unmarkedDates: string[] = [];
  let paidDays = 0;
  for (let i = startIndex; i <= endIndex; i += 1) {
    if (isVirtual(i)) {
      counts.virtual += 1;
      paidDays += 1;
      continue;
    }
    const date = toRealDate(i);
    const status = attendance[date];
    if (status === undefined) {
      // Unmarked: counted as Present. Flagged only for past days once tracking began.
      paidDays += 1;
      if (date < today && (attendanceFrom === undefined || date >= attendanceFrom)) {
        counts.unmarked += 1;
        unmarkedDates.push(date);
      } else {
        counts.uncounted += 1;
      }
      continue;
    }
    counts[status] += 1;
    paidDays += ATTENDANCE_WEIGHTS[status];
  }
  return { days: endIndex - startIndex + 1, paidDays, counts, unmarkedDates };
}

type Cycle = {
  startIndex: number;
  endIndex: number;
  paydayIndex: number;
  dueIndex: number;
  payMode: PayMode;
  monthlySalary: number;
  isFinal: boolean;
};

/**
 * The cycles of a schedule. Each salary-terms row starts a segment at its
 * effective date (never before earning starts at join + 10):
 *  - Mode A: 16-day cycles from the segment start, each paid on its 16th (last) day.
 *  - Mode B: from the segment start to the 30th (the first one pro-rated),
 *    then whole company months, each paid on the 10th of the next month.
 * A last working day cuts the cycle it falls in short; that cycle and every
 * later-dated payday fall due the day after the last working day.
 */
function buildCycles(
  terms: Terms[],
  earningStartIndex: number,
  lastIndex: number | null,
  todayIndex: number,
  upcoming: number,
): Cycle[] {
  const sorted = sortTerms(terms);
  const cycles: Cycle[] = [];
  let future = 0;
  const enough = () => lastIndex === null && future >= upcoming;
  for (let t = 0; t < sorted.length && !enough(); t += 1) {
    const term = sorted[t];
    const segStart = Math.max(term.effectiveFromIndex, earningStartIndex);
    const nextStart = t + 1 < sorted.length ? sorted[t + 1].effectiveFromIndex : Number.POSITIVE_INFINITY;
    let segEnd = nextStart - 1;
    if (lastIndex !== null) segEnd = Math.min(segEnd, lastIndex);
    let start = segStart;
    while (start <= segEnd && !enough()) {
      const naturalEnd = term.payMode === "half_16day" ? start + HALF_CYCLE_DAYS - 1 : monthEnd(start);
      const end = Math.min(naturalEnd, segEnd);
      // Mode A is paid on the cycle's 16th (last) day itself.
      const paydayIndex = term.payMode === "half_16day" ? naturalEnd : tenthOfNextMonth(start);
      const isFinal = lastIndex !== null && end === lastIndex;
      const dueIndex = lastIndex !== null ? Math.min(paydayIndex, lastIndex + 1) : paydayIndex;
      cycles.push({
        startIndex: start,
        endIndex: end,
        paydayIndex,
        dueIndex,
        payMode: term.payMode,
        monthlySalary: term.monthlySalary,
        isFinal,
      });
      if (dueIndex > todayIndex) future += 1;
      start = naturalEnd + 1;
    }
  }
  return cycles;
}

function paydayStatus(dueDate: string, today: string, net: number, paid: number): PaydayStatus {
  const outstanding = net - paid;
  if (dueDate > today) {
    if (paid > 0) return outstanding <= 0 ? "paid" : "partially_paid";
    return "upcoming";
  }
  if (outstanding <= 0) return "paid";
  return paid > 0 ? "partially_paid" : "due";
}

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
const sumOf = <T>(rows: T[], pick: (row: T) => number) => sum(rows.map(pick));

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const list = map.get(k);
    if (list) list.push(row);
    else map.set(k, [row]);
  }
  return map;
}

/** Signed effect of adjustments on a payout: bonuses add; deductions and advances subtract. */
export function adjustmentEffect(adjustments: AdjustmentInput[]): number {
  return sumOf(adjustments, (a) => (a.type === "bonus" ? a.amount : -a.amount));
}

export function computeReserve(input: Pick<EngineInput, "joinDate" | "terms" | "attendance" | "today" | "attendanceFrom" | "reserveStatus">): Reserve {
  const joinIndex = joinIndexFromRealDate(input.joinDate);
  const atJoin = sortTerms(input.terms)[0];
  if (atJoin === undefined) throw new Error("No salary terms.");
  const startIndex = joinIndex;
  const endIndex = addDays(joinIndex, RESERVE_DAYS - 1);
  const tally = tallyAttendance(startIndex, endIndex, input.attendance, input.today, input.attendanceFrom);
  // Fixed at joining: the salary at joining, never revised.
  const exactAmount = (atJoin.monthlySalary * tally.paidDays) / DAYS_PER_MONTH;
  return {
    startIndex,
    endIndex,
    startDate: toRealDate(startIndex),
    endDate: toRealDate(endIndex),
    monthlySalary: atJoin.monthlySalary,
    tally,
    exactAmount,
    amount: Math.round(exactAmount),
    status: input.reserveStatus,
  };
}

/** Everything about one person's pay. */
export function computeSchedule(input: EngineInput): Schedule {
  if (input.terms.length === 0) throw new Error("No salary terms.");
  const joinIndex = joinIndexFromRealDate(input.joinDate);
  const earningStartIndex = addDays(joinIndex, RESERVE_DAYS);
  const todayIndex = indexOnOrBefore(input.today);
  const lastIndex = input.lastWorkingDay ? indexOnOrBefore(input.lastWorkingDay) : null;
  const cycles = buildCycles(
    input.terms,
    earningStartIndex,
    lastIndex,
    todayIndex,
    input.upcoming ?? DEFAULT_UPCOMING,
  );

  const adjustmentsByKey = groupBy(input.adjustments, (a) => a.paydayKey);
  const paymentsByKey = groupBy(input.payments, (p) => p.paydayKey);

  const paydays: Payday[] = cycles.map((cycle) => {
    const key = paydayKey(input.staffId, cycle.paydayIndex);
    const tally = tallyAttendance(cycle.startIndex, cycle.endIndex, input.attendance, input.today, input.attendanceFrom);
    const fullEarning = earningFor(cycle.payMode, cycle.monthlySalary, tally.days);
    const earning = earningFor(cycle.payMode, cycle.monthlySalary, tally.paidDays);
    const adjustments = adjustmentsByKey.get(key) ?? [];
    const payments = paymentsByKey.get(key) ?? [];
    const bonus = sumOf(adjustments.filter((a) => a.type === "bonus"), (a) => a.amount);
    const deduction = sumOf(adjustments.filter((a) => a.type === "deduction"), (a) => a.amount);
    const advance = sumOf(adjustments.filter((a) => a.type === "advance"), (a) => a.amount);
    const net = Math.round(earning + bonus - deduction - advance);
    const paid = sumOf(payments, (p) => p.amount);
    const dueDate = toRealDate(cycle.dueIndex);
    return {
      key,
      paydayIndex: cycle.paydayIndex,
      dueDate,
      cycleStartIndex: cycle.startIndex,
      cycleEndIndex: cycle.endIndex,
      cycleStartDate: toRealDate(cycle.startIndex),
      cycleEndDate: toRealDate(cycle.endIndex),
      payMode: cycle.payMode,
      monthlySalary: cycle.monthlySalary,
      dayRate: dayRateFor(cycle.payMode, cycle.monthlySalary),
      isFinal: cycle.isFinal,
      tally,
      fullEarning,
      earning,
      absentDeduction: earningFor(cycle.payMode, cycle.monthlySalary, tally.counts.absent),
      halfDayDeduction: earningFor(cycle.payMode, cycle.monthlySalary, tally.counts.half_day * 0.5),
      bonus,
      deduction,
      advance,
      adjustments,
      payments,
      net,
      paid,
      outstanding: net - paid,
      status: paydayStatus(dueDate, input.today, net, paid),
    };
  });

  const keys = new Set(paydays.map((p) => p.key));
  const fKey = finalKey(input.staffId);
  const unsettledAdjustments = input.adjustments.filter((a) => !keys.has(a.paydayKey));
  const reserve = computeReserve(input);
  const pending = sumOf(
    paydays.filter((p) => p.dueDate <= input.today),
    (p) => p.outstanding,
  );
  const next = paydays.find((p) => p.dueDate > input.today) ?? null;

  let settlement: FinalSettlement | null = null;
  if (lastIndex !== null && input.lastWorkingDay) {
    const reserveIncluded = input.reserveStatus !== "forfeited";
    const reserveExact = reserveIncluded ? reserve.exactAmount : 0;
    const unsettledTotal = adjustmentEffect(unsettledAdjustments);
    const extrasNet = Math.round(reserveExact + unsettledTotal);
    const payments = paymentsByKey.get(fKey) ?? [];
    const extrasPaid = sumOf(payments, (p) => p.amount);
    const paydaysOutstanding = sumOf(paydays, (p) => p.outstanding);
    const finalCycle = paydays.find((p) => p.isFinal);
    settlement = {
      key: fKey,
      dueDate: toRealDate(lastIndex + 1),
      lastWorkingDay: input.lastWorkingDay,
      reserveAmount: reserveIncluded ? reserve.amount : 0,
      reserveIncluded,
      unsettledAdjustments,
      unsettledTotal,
      extrasNet,
      extrasPaid,
      extrasOutstanding: extrasNet - extrasPaid,
      finalCycleEarning: finalCycle?.earning ?? 0,
      paydaysOutstanding,
      totalOutstanding: paydaysOutstanding + extrasNet - extrasPaid,
      payments,
    };
  }

  return {
    joinIndex,
    earningStartIndex,
    todayIndex,
    paydays,
    reserve,
    pending,
    next,
    unsettledAdjustments,
    settlement,
  };
}

/**
 * The dates a salary revision or mode change may take effect: the first
 * day of a cycle (for Mode A, the day after a payday; for Mode B, the 1st of a month),
 * from today on and after the latest terms. Returns company-day indices.
 */
export function revisionStarts(
  input: Pick<EngineInput, "joinDate" | "terms" | "today">,
  count = 6,
): number[] {
  const joinIndex = joinIndexFromRealDate(input.joinDate);
  const earningStartIndex = addDays(joinIndex, RESERVE_DAYS);
  const todayIndex = indexOnOrBefore(input.today);
  const latest = sortTerms(input.terms).at(-1)!;
  const cycles = buildCycles(input.terms, earningStartIndex, null, todayIndex, count + 2);
  const starts = cycles.map((c) => c.startIndex);
  // The cycle after the last generated one also starts on its payday / next month.
  const last = cycles.at(-1);
  if (last) starts.push(last.endIndex + 1);
  return [...new Set(starts)]
    .filter((s) => s >= todayIndex && s > latest.effectiveFromIndex)
    .slice(0, count);
}

/** True when `index` is a valid start for new terms (see revisionStarts). */
export function isValidRevisionStart(input: Pick<EngineInput, "joinDate" | "terms" | "today">, index: number): boolean {
  return revisionStarts(input, 60).includes(index);
}

/** Converts a real date to a company day for comparisons; null for the 31st. */
export { fromRealDate };
