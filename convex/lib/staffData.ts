import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { appError } from "./errors";
import { inScope, type AdminViewer } from "./functions";
import {
  computeSchedule,
  pastKey,
  type AttendanceStatus,
  type EngineInput,
  type Schedule,
  type Terms,
} from "./payroll";
import { todayInIndia } from "./time";

type DbCtx = Pick<QueryCtx, "db">;

export async function termsOf(
  ctx: DbCtx,
  staffId: Id<"staff">,
): Promise<Doc<"salaryTerms">[]> {
  return await ctx.db
    .query("salaryTerms")
    .withIndex("by_staff_effective", (q) => q.eq("staffId", staffId))
    .collect();
}

export async function attendanceOf(
  ctx: DbCtx,
  staffId: Id<"staff">,
): Promise<Doc<"attendance">[]> {
  return await ctx.db
    .query("attendance")
    .withIndex("by_staff_date", (q) => q.eq("staffId", staffId))
    .collect();
}

export async function adjustmentsOf(ctx: DbCtx, staffId: Id<"staff">) {
  return await ctx.db
    .query("adjustments")
    .withIndex("by_staff", (q) => q.eq("staffId", staffId))
    .collect();
}

export async function paymentsOf(ctx: DbCtx, staffId: Id<"staff">) {
  return await ctx.db
    .query("payments")
    .withIndex("by_staff", (q) => q.eq("staffId", staffId))
    .collect();
}

export const toTerms = (row: Doc<"salaryTerms">): Terms => ({
  effectiveFromIndex: row.effectiveFromIndex,
  monthlySalary: row.monthlySalary,
  payMode: row.payMode,
});

/** Everything the payroll engine needs for one person. */
export async function engineInputFor(
  ctx: DbCtx,
  staff: Doc<"staff">,
  today = todayInIndia(),
  upcoming?: number,
): Promise<EngineInput> {
  const [terms, attendance, adjustments, payments] = await Promise.all([
    termsOf(ctx, staff._id),
    attendanceOf(ctx, staff._id),
    adjustmentsOf(ctx, staff._id),
    paymentsOf(ctx, staff._id),
  ]);
  const byDate: Record<string, AttendanceStatus> = {};
  for (const row of attendance) byDate[row.date] = row.status;
  return {
    staffId: staff._id,
    joinDate: staff.joinDate,
    terms: terms.map(toTerms),
    attendance: byDate,
    adjustments: adjustments.map((a) => ({
      id: a._id,
      type: a.type,
      amount: a.amount,
      paydayKey: a.paydayKey,
      note: a.note,
      date: a.date,
    })),
    payments: payments.map((p) => ({
      id: p._id,
      paydayKey: p.paydayKey,
      amount: p.amount,
      paidOn: p.paidOn,
      mode: p.mode,
      note: p.note,
    })),
    today,
    attendanceFrom: staff.attendanceFrom,
    lastWorkingDay: staff.lastWorkingDay ?? null,
    reserveStatus: staff.reserveStatus,
    upcoming,
  };
}

export async function scheduleFor(
  ctx: DbCtx,
  staff: Doc<"staff">,
  today = todayInIndia(),
  upcoming?: number,
): Promise<Schedule> {
  return computeSchedule(await engineInputFor(ctx, staff, today, upcoming));
}

/**
 * A staff member of the admin's organisation (any of its properties, not
 * only the one chosen on screen). Anyone else's reads as NOT_FOUND.
 */
export async function loadStaff(
  ctx: DbCtx,
  admin: { organization: Pick<Doc<"organizations">, "_id"> },
  staffId: Id<"staff">,
): Promise<Doc<"staff">> {
  const staff = await ctx.db.get(staffId);
  if (staff === null || staff.organizationId !== admin.organization._id)
    throw appError("NOT_FOUND");
  return staff;
}

/** Staff of the properties a screen covers (see inScope), by name. */
export async function allStaff(
  ctx: DbCtx,
  admin: Pick<AdminViewer, "organization" | "property" | "properties">,
): Promise<Doc<"staff">[]> {
  const ids = new Set(inScope(admin).map((p) => p._id));
  const rows = await ctx.db
    .query("staff")
    .withIndex("by_org", (q) => q.eq("organizationId", admin.organization._id))
    .collect();
  return rows
    .filter((s) => ids.has(s.propertyId))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Is the person working on `date` (joined, and not past their last working day)? */
export function worksOn(staff: Doc<"staff">, date: string): boolean {
  if (date < staff.joinDate) return false;
  if (staff.lastWorkingDay !== undefined && date > staff.lastWorkingDay)
    return false;
  return (
    staff.status === "active" ||
    (staff.lastWorkingDay !== undefined && date <= staff.lastWorkingDay)
  );
}

/**
 * Past payments, bonuses and deductions recorded for dates with no pay
 * period (payments.recordPast): history the calendars, ledger and Payments
 * show, outside the paydays. Oldest first.
 */
export async function pastEntriesOf(ctx: DbCtx, staff: Doc<"staff">) {
  const key = pastKey(staff._id);
  const payments = (await paymentsOf(ctx, staff._id)).filter(
    (p) => p.paydayKey === key,
  );
  const adjustments = (await adjustmentsOf(ctx, staff._id)).filter(
    (a) => a.paydayKey === key,
  );
  return [
    ...payments.map((p) => ({
      id: p._id as string,
      kind: "payment" as const,
      from: p.periodFrom ?? p.paidOn,
      to: p.periodTo ?? p.paidOn,
      amount: p.amount,
      paidOn: p.paidOn as string | null,
      mode: p.mode as string | null,
      note: p.note ?? null,
    })),
    ...adjustments
      .filter((a) => a.type === "bonus" || a.type === "deduction")
      .map((a) => ({
        id: a._id as string,
        kind: a.type as "bonus" | "deduction",
        from: a.periodFrom ?? a.date,
        to: a.periodTo ?? a.date,
        amount: a.amount,
        paidOn: null,
        mode: null,
        note: a.note,
      })),
  ].sort((a, b) => a.from.localeCompare(b.from));
}
