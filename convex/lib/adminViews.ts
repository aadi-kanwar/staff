import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { addRealDays } from "./companyCalendar";
import { payoutSummary } from "./payout";
import { PAY_MODE_LABELS, type Payday, type Schedule } from "./payroll";
import { allStaff, scheduleFor } from "./staffData";

/** One payday as the admin payroll screens show it (admin only: includes cycle details). */
export function paydayRow(staff: Doc<"staff">, p: Payday, today: string) {
  return {
    kind: "payday" as const,
    staffId: staff._id,
    name: staff.name,
    department: staff.department,
    propertyId: staff.propertyId,
    /** Where to send the money (UPI / bank), if known. */
    payTo: payoutSummary(staff.payout),
    key: p.key,
    dueDate: p.dueDate,
    /** The latest payment against it, if any. */
    lastPaidOn: lastPaidOn(p.payments),
    payModeLabel: PAY_MODE_LABELS[p.payMode],
    cycleStartDate: p.cycleStartDate,
    cycleEndDate: p.cycleEndDate,
    isFinal: p.isFinal,
    cycleDays: p.tally.days,
    paidDays: p.tally.paidDays,
    counts: p.tally.counts,
    unmarkedDates: p.tally.unmarkedDates,
    fullEarning: p.fullEarning,
    earning: p.earning,
    absentDeduction: p.absentDeduction,
    halfDayDeduction: p.halfDayDeduction,
    bonus: p.bonus,
    deduction: p.deduction,
    advance: p.advance,
    net: p.net,
    paid: p.paid,
    outstanding: p.outstanding,
    status: p.status,
    overdue: p.dueDate < today && p.outstanding > 0,
  };
}

export type PaydayRow = ReturnType<typeof paydayRow>;

const lastPaidOn = (payments: { paidOn: string }[]) =>
  payments.reduce<string | null>(
    (latest, p) => (latest === null || p.paidOn > latest ? p.paidOn : latest),
    null,
  );

export function settlementRow(
  staff: Doc<"staff">,
  schedule: Schedule,
  today: string,
) {
  const s = schedule.settlement!;
  return {
    kind: "final" as const,
    staffId: staff._id,
    name: staff.name,
    department: staff.department,
    propertyId: staff.propertyId,
    /** Where to send the money (UPI / bank), if known. */
    payTo: payoutSummary(staff.payout),
    key: s.key,
    dueDate: s.dueDate,
    lastPaidOn: lastPaidOn(s.payments),
    reserveAmount: s.reserveAmount,
    unsettledTotal: s.unsettledTotal,
    net: s.extrasNet,
    paid: s.extrasPaid,
    outstanding: s.extrasOutstanding,
    status:
      s.extrasOutstanding <= 0
        ? ("paid" as const)
        : s.extrasPaid > 0
          ? ("partially_paid" as const)
          : ("due" as const),
    overdue: s.dueDate < today && s.extrasOutstanding > 0,
  };
}

export type SettlementRow = ReturnType<typeof settlementRow>;

/** Everyone's schedules (active staff, and leavers with anything left to settle). */
export async function allSchedules(
  ctx: Pick<QueryCtx, "db">,
  admin: Parameters<typeof allStaff>[1],
  today: string,
) {
  const result: { staff: Doc<"staff">; schedule: Schedule }[] = [];
  for (const staff of await allStaff(ctx, admin)) {
    const schedule = await scheduleFor(ctx, staff, today, 2);
    if (staff.status === "exited") {
      const owed =
        schedule.paydays.some((p) => p.outstanding !== 0) ||
        (schedule.settlement?.extrasOutstanding ?? 0) !== 0;
      if (!owed) continue;
    }
    result.push({ staff, schedule });
  }
  return result;
}

/** Paydays not fully paid that are due, or due within `days`. */
export function openPaydays(
  entries: { staff: Doc<"staff">; schedule: Schedule }[],
  today: string,
  days: number,
) {
  const until = addRealDays(today, days);
  const rows: (PaydayRow | SettlementRow)[] = [];
  for (const { staff, schedule } of entries) {
    for (const p of schedule.paydays) {
      if (p.status === "paid" || p.dueDate > until) continue;
      rows.push(paydayRow(staff, p, today));
    }
    if (schedule.settlement && schedule.settlement.extrasOutstanding !== 0)
      rows.push(settlementRow(staff, schedule, today));
  }
  return rows.sort(
    (a, b) =>
      a.dueDate.localeCompare(b.dueDate) || a.name.localeCompare(b.name),
  );
}

/** First and last day of the real calendar month containing `date` ("YYYY-MM-DD"). */
export function monthBounds(date: string): { start: string; end: string } {
  const [y, m] = date.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return {
    start: `${date.slice(0, 7)}-01`,
    end: `${date.slice(0, 7)}-${String(last).padStart(2, "0")}`,
  };
}

const daysBetween = (a: string, b: string) =>
  Math.round(
    (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000,
  );

/**
 * Every payday (and final settlement) due between `from` and `to`, paid or
 * not, for the staff a screen covers (including people who have left);
 * what's owed now whatever its date; and this calendar month's totals:
 * due (net payable), still pending, and paid (payments made this month).
 */
export async function paydaysBetween(
  ctx: Pick<QueryCtx, "db">,
  admin: Parameters<typeof allStaff>[1],
  today: string,
  from: string,
  to: string,
) {
  const month = monthBounds(today);
  const reach = [to, month.end].sort().at(-1)!;
  // Enough future paydays to reach the end of the range (16-day cycles are the shortest).
  const upcoming = Math.min(
    Math.max(Math.ceil(daysBetween(today, reach) / 15) + 2, 2),
    60,
  );
  const rows: (PaydayRow | SettlementRow)[] = [];
  const owedNow: (PaydayRow | SettlementRow)[] = [];
  const figures = { due: 0, pending: 0, paid: 0, tickets: 0, paidTickets: 0 };
  const inMonth = (d: string) => d >= month.start && d <= month.end;
  for (const staff of await allStaff(ctx, admin)) {
    const schedule = await scheduleFor(ctx, staff, today, upcoming);
    const lines: (PaydayRow | SettlementRow)[] = schedule.paydays.map((p) =>
      paydayRow(staff, p, today),
    );
    if (schedule.settlement && schedule.settlement.extrasNet !== 0)
      lines.push(settlementRow(staff, schedule, today));
    for (const row of lines) {
      if (row.dueDate >= from && row.dueDate <= to) rows.push(row);
      if (row.dueDate <= today && row.outstanding > 0) owedNow.push(row);
      if (inMonth(row.dueDate)) {
        figures.due += row.net;
        figures.pending += Math.max(row.outstanding, 0);
        figures.tickets += 1;
        if (row.outstanding <= 0) figures.paidTickets += 1;
      }
    }
    const payments = [
      ...schedule.paydays.flatMap((p) => p.payments),
      ...(schedule.settlement?.payments ?? []),
    ];
    for (const pay of payments)
      if (pay.mode !== "opening" && inMonth(pay.paidOn))
        figures.paid += pay.amount;
  }
  const byDate = (a: PaydayRow | SettlementRow, b: PaydayRow | SettlementRow) =>
    a.dueDate.localeCompare(b.dueDate) || a.name.localeCompare(b.name);
  return {
    month: { ...month, ...figures },
    rows: rows.sort(byDate),
    owedNow: owedNow.sort(byDate),
  };
}
