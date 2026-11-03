import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { addRealDays } from "./companyCalendar";
import { PAY_MODE_LABELS, type Payday, type Schedule } from "./payroll";
import { allStaff, scheduleFor } from "./staffData";

/** One payday as the admin payroll screens show it (admin only: includes cycle details). */
export function paydayRow(staff: Doc<"staff">, p: Payday, today: string) {
  return {
    kind: "payday" as const,
    staffId: staff._id,
    name: staff.name,
    department: staff.department,
    key: p.key,
    dueDate: p.dueDate,
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

export function settlementRow(staff: Doc<"staff">, schedule: Schedule, today: string) {
  const s = schedule.settlement!;
  return {
    kind: "final" as const,
    staffId: staff._id,
    name: staff.name,
    department: staff.department,
    key: s.key,
    dueDate: s.dueDate,
    reserveAmount: s.reserveAmount,
    unsettledTotal: s.unsettledTotal,
    net: s.extrasNet,
    paid: s.extrasPaid,
    outstanding: s.extrasOutstanding,
    status: s.extrasOutstanding <= 0 ? ("paid" as const) : s.extrasPaid > 0 ? ("partially_paid" as const) : ("due" as const),
    overdue: s.dueDate < today && s.extrasOutstanding > 0,
  };
}

export type SettlementRow = ReturnType<typeof settlementRow>;

/** Everyone's schedules (active staff, and leavers with anything left to settle). */
export async function allSchedules(ctx: Pick<QueryCtx, "db">, today: string) {
  const result: { staff: Doc<"staff">; schedule: Schedule }[] = [];
  for (const staff of await allStaff(ctx)) {
    const schedule = await scheduleFor(ctx, staff, today, 2);
    if (staff.status === "exited") {
      const owed = schedule.paydays.some((p) => p.outstanding !== 0) || (schedule.settlement?.extrasOutstanding ?? 0) !== 0;
      if (!owed) continue;
    }
    result.push({ staff, schedule });
  }
  return result;
}

/** Paydays not fully paid that are due, or due within `days`. */
export function openPaydays(entries: { staff: Doc<"staff">; schedule: Schedule }[], today: string, days: number) {
  const until = addRealDays(today, days);
  const rows: (PaydayRow | SettlementRow)[] = [];
  for (const { staff, schedule } of entries) {
    for (const p of schedule.paydays) {
      if (p.status === "paid" || p.dueDate > until) continue;
      rows.push(paydayRow(staff, p, today));
    }
    if (schedule.settlement && schedule.settlement.extrasOutstanding !== 0) rows.push(settlementRow(staff, schedule, today));
  }
  return rows.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.name.localeCompare(b.name));
}
