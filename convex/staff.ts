/**
 * What staff see about THEMSELVES. CONFIDENTIAL BOUNDARY.
 *
 * How pay is calculated is a company secret. These queries return
 * purpose-built summaries only: dates, amounts, statuses and short labels.
 * They must never return salary-term documents, the pay mode, day rates,
 * formulas or cycle lengths, and never say how absences are valued per day
 * (a line like "Absent × 2: −₹1,875" is fine).
 *
 * Pay periods' first and last dates ARE shown (owner's decision, Nov 2026:
 * the Home calendar shades each period by whether it's paid). They were
 * already apparent from the payday dates. Only dates are given, as
 * `period.from` / `period.to`, never the mode, length or how it's derived.
 * convex/tests/confidentiality.test.ts calls every query in this file and
 * checks the payloads.
 *
 * Identity always comes from the session (staffQuery → ctx.self); no
 * function here takes a staff id.
 */
import { v } from "convex/values";
import { isoDate, parseIsoDate, realDatesOfMonth } from "./lib/companyCalendar";
import { appError } from "./lib/errors";
import { staffQuery } from "./lib/functions";
import {
  ATTENDANCE_STATUSES,
  type AttendanceStatus,
  type Payday,
  type Schedule,
} from "./lib/payroll";
import { payoutDetails } from "./lib/payout";
import { attendanceOf, scheduleFor, worksOn } from "./lib/staffData";
import { monthOf, todayInIndia } from "./lib/time";

type Line = { label: string; amount: number };
type StaffStatusLabel = "upcoming" | "due" | "partially_paid" | "paid";

const MODE_LABELS: Record<string, string> = {
  cash: "Cash",
  upi: "UPI",
  bank: "Bank transfer",
  opening: "Paid before the app",
};

function adjustmentLines(adjustments: Payday["adjustments"]): Line[] {
  return adjustments.map((a) => {
    const label =
      a.type === "bonus"
        ? "Bonus"
        : a.type === "deduction"
          ? "Deduction"
          : "Advance recovered";
    return {
      label: a.note ? `${label}: ${a.note}` : label,
      amount: a.type === "bonus" ? a.amount : -a.amount,
    };
  });
}

function paymentRows(payments: Payday["payments"]) {
  return [...payments]
    .sort((a, b) => a.paidOn.localeCompare(b.paidOn))
    .map((p) => ({
      paidOn: p.paidOn,
      amount: p.amount,
      method: MODE_LABELS[p.mode] ?? "Other",
      note: p.note ?? null,
    }));
}

/** One payday as staff see it: when, how much, whether paid, and plain line items. */
function paydayView(p: Payday, n: number) {
  const lines: Line[] = [
    {
      label: p.isFinal ? "Earnings (final days)" : "Earnings",
      amount: p.fullEarning,
    },
  ];
  if (p.tally.counts.absent > 0)
    lines.push({
      label: `Absent × ${p.tally.counts.absent}`,
      amount: -p.absentDeduction,
    });
  if (p.tally.counts.half_day > 0)
    lines.push({
      label: `Half-day × ${p.tally.counts.half_day}`,
      amount: -p.halfDayDeduction,
    });
  lines.push(...adjustmentLines(p.adjustments));
  return {
    id: `payday-${n}`,
    title: p.isFinal ? "Final pay" : "Salary",
    date: p.dueDate,
    amount: p.net,
    paid: p.paid,
    remaining: Math.max(p.net - p.paid, 0),
    status: p.status as StaffStatusLabel,
    lines,
    payments: paymentRows(p.payments),
  };
}

function settlementView(schedule: Schedule, today: string) {
  const s = schedule.settlement!;
  const lines: Line[] = [];
  if (s.reserveIncluded)
    lines.push({ label: "Joining Reserve", amount: s.reserveAmount });
  lines.push(...adjustmentLines(s.unsettledAdjustments));
  const status: StaffStatusLabel =
    s.extrasOutstanding <= 0
      ? "paid"
      : s.extrasPaid > 0
        ? "partially_paid"
        : s.dueDate > today
          ? "upcoming"
          : "due";
  return {
    id: "final-settlement",
    title: "Final settlement",
    date: s.dueDate,
    amount: s.extrasNet,
    paid: s.extrasPaid,
    remaining: Math.max(s.extrasOutstanding, 0),
    status,
    lines,
    payments: paymentRows(s.payments),
  };
}

function reserveView(schedule: Schedule, forfeitReason: string | undefined) {
  return {
    label: "Joining Reserve (paid when you leave)",
    amount:
      schedule.reserve.status === "forfeited" ? 0 : schedule.reserve.amount,
    status: schedule.reserve.status,
    note:
      schedule.reserve.status === "forfeited" ? (forfeitReason ?? null) : null,
  };
}

/** Home: next payday, what's owed now, and the Joining Reserve. */
export const home = staffQuery({
  args: {},
  handler: async (ctx) => {
    const staff = ctx.self.staff;
    const today = todayInIndia();
    const schedule = await scheduleFor(ctx, staff, today);
    const settlement = schedule.settlement;
    return {
      name: staff.name,
      status: staff.status,
      lastWorkingDay: staff.lastWorkingDay ?? null,
      today,
      next:
        staff.status === "active" && schedule.next
          ? { date: schedule.next.dueDate, amount: schedule.next.net }
          : null,
      pending: Math.max(schedule.pending, 0),
      reserve: reserveView(schedule, staff.reserveForfeitReason),
      finalSettlement:
        settlement && staff.status === "active"
          ? {
              date: settlement.dueDate,
              amount: Math.max(settlement.totalOutstanding, 0),
            }
          : null,
    };
  },
});

type PeriodState = "paid" | "pending" | "current" | "upcoming";

/** How a pay period looks on the calendar. */
function periodState(p: Payday, today: string): PeriodState {
  if (p.outstanding <= 0 && (p.paid > 0 || p.dueDate <= today)) return "paid";
  if (p.dueDate <= today) return "pending";
  return p.cycleStartDate <= today ? "current" : "upcoming";
}

/**
 * Home calendar: every pay period from joining to the next few ahead, each
 * with its dates, payday, amount and whether it's paid, plus the Joining
 * Reserve days. Same amounts and line items as `payments`.
 */
export const payCalendar = staffQuery({
  args: {},
  handler: async (ctx) => {
    const staff = ctx.self.staff;
    const today = todayInIndia();
    const schedule = await scheduleFor(ctx, staff, today, 3);
    const periods = schedule.paydays.map((p, i) => ({
      ...paydayView(p, i + 1),
      period: { from: p.cycleStartDate, to: p.cycleEndDate },
      state: periodState(p, today),
    }));
    const settlement = schedule.settlement
      ? settlementView(schedule, today)
      : null;
    // Absent and half days, so the calendar shows them (staff already see
    // their own marks on the Attendance screen).
    const marks = await attendanceOf(ctx, staff._id);
    const absences = marks
      .filter((m) => m.status === "absent" || m.status === "half_day")
      .map((m) => ({ date: m.date, kind: m.status as "absent" | "half_day" }))
      .sort((a, b) => a.date.localeCompare(b.date));
    return {
      today,
      absences,
      joinDate: staff.joinDate,
      lastWorkingDay: staff.lastWorkingDay ?? null,
      status: staff.status,
      reserve: {
        ...reserveView(schedule, staff.reserveForfeitReason),
        period: {
          from: schedule.reserve.startDate,
          to: schedule.reserve.endDate,
        },
      },
      periods,
      settlement,
      pending: Math.max(schedule.pending, 0),
    };
  },
});

/**
 * Payments: every payday so far (and the next one). Anything still owed
 * whose date has come comes first (oldest first), then upcoming ones
 * (soonest first), then the rest of the past (newest first).
 */
export const payments = staffQuery({
  args: {},
  handler: async (ctx) => {
    const staff = ctx.self.staff;
    const today = todayInIndia();
    const schedule = await scheduleFor(ctx, staff, today, 1);
    const shown = schedule.paydays.filter(
      (p) => p.dueDate <= today || p === schedule.next,
    );
    const rows = shown.map((p, i) => paydayView(p, i + 1));
    if (schedule.settlement) rows.push(settlementView(schedule, today));
    const owed = (r: (typeof rows)[number]) =>
      r.date <= today && r.remaining > 0;
    const overdue = rows
      .filter(owed)
      .sort((x, y) => x.date.localeCompare(y.date));
    const upcoming = rows
      .filter((r) => r.date > today)
      .sort((x, y) => x.date.localeCompare(y.date));
    const past = rows.filter((r) => r.date <= today && !owed(r)).reverse();
    return {
      today,
      paydays: [...overdue, ...upcoming, ...past],
      totalPaid: rows.reduce((a, r) => a + r.paid, 0),
    };
  },
});

const emptyCounts = () =>
  Object.fromEntries(ATTENDANCE_STATUSES.map((s) => [s, 0])) as Record<
    AttendanceStatus,
    number
  >;

/** The months that have attendance (plus the current month while working), newest first. */
export const attendanceMonths = staffQuery({
  args: {},
  handler: async (ctx) => {
    const staff = ctx.self.staff;
    const marks = await ctx.db
      .query("attendance")
      .withIndex("by_staff_date", (q) => q.eq("staffId", staff._id))
      .collect();
    const months = new Set(marks.map((m) => monthOf(m.date)));
    const today = todayInIndia();
    if (staff.status === "active" && today >= staff.joinDate)
      months.add(monthOf(today));
    return [...months].sort().reverse();
  },
});

/** One month's calendar of the person's own attendance, with a count per status. */
export const attendanceMonth = staffQuery({
  args: { month: v.string() },
  handler: async (ctx, args) => {
    if (!/^\d{4}-\d{2}$/.test(args.month)) throw appError("INVALID_INPUT");
    const staff = ctx.self.staff;
    const { y, m } = parseIsoDate(`${args.month}-01`);
    const marks = await ctx.db
      .query("attendance")
      .withIndex("by_staff_date", (q) =>
        q
          .eq("staffId", staff._id)
          .gte("date", isoDate(y, m, 1))
          .lte("date", isoDate(y, m, 31)),
      )
      .collect();
    const byDate = new Map(marks.map((mark) => [mark.date, mark.status]));
    const today = todayInIndia();
    const days = realDatesOfMonth(y, m).map((date) => ({
      date,
      status: byDate.get(date) ?? null,
      working: worksOn(staff, date),
      future: date > today,
    }));
    const counts = emptyCounts();
    for (const d of days) if (d.status) counts[d.status] += 1;
    return { month: args.month, days, counts };
  },
});

/** Profile details. */
export const profile = staffQuery({
  args: {},
  handler: async (ctx) => {
    const staff = ctx.self.staff;
    const property = await ctx.db.get(staff.propertyId);
    return {
      name: staff.name,
      phone: staff.phone,
      property: property?.name ?? "",
      department: staff.department,
      joinDate: staff.joinDate,
      status: staff.status,
      lastWorkingDay: staff.lastWorkingDay ?? null,
      /** Where their salary is paid, and a change they asked for (waiting for an admin). */
      payout: payoutDetails(staff.payout),
      payoutRequest: staff.payoutRequest
        ? {
            ...payoutDetails(staff.payoutRequest)!,
            submittedAt: staff.payoutRequest.submittedAt,
          }
        : null,
    };
  },
});
