/**
 * Admin: attendance. Every change is written to the append-only
 * attendanceLog (staff, date, old → new, who, when); history is never
 * overwritten.
 */
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
  addRealDays,
  fromRealDate,
  isoDate,
  parseIsoDate,
  realDatesOfMonth,
} from "./lib/companyCalendar";
import { appError } from "./lib/errors";
import { adminMutation, adminQuery, type AdminViewer } from "./lib/functions";
import { isoDateSchema } from "./lib/inputRules";
import { ATTENDANCE_STATUSES, type AttendanceStatus } from "./lib/payroll";
import { allStaff, loadStaff, worksOn } from "./lib/staffData";
import { todayInIndia } from "./lib/time";
import { vAttendanceStatus } from "./lib/validators";

/** Property names for rows, or null when only one property is shown (no need to repeat it). */
export function propertyNames(
  admin: Pick<AdminViewer, "property" | "properties">,
) {
  const names = new Map(admin.properties.map((p) => [p._id as string, p.name]));
  return (propertyId: Id<"properties">) =>
    admin.property !== null ? null : (names.get(propertyId) ?? null);
}

/** Marks can be entered up to this many days ahead (e.g. planned leave). */
const MAX_DAYS_AHEAD = 31;

function checkDate(date: string): string {
  if (!isoDateSchema.safeParse(date).success) throw appError("INVALID_DATE");
  if (date > addRealDays(todayInIndia(), MAX_DAYS_AHEAD)) {
    throw appError(
      "INVALID_DATE",
      `Attendance can be marked at most ${MAX_DAYS_AHEAD} days ahead.`,
    );
  }
  return date;
}

async function markOf(
  ctx: Pick<QueryCtx, "db">,
  staffId: Id<"staff">,
  date: string,
) {
  return await ctx.db
    .query("attendance")
    .withIndex("by_staff_date", (q) =>
      q.eq("staffId", staffId).eq("date", date),
    )
    .unique();
}

/** Sets one mark and logs the change. Returns true if anything changed. */
export async function setMark(
  ctx: Pick<MutationCtx, "db">,
  staff: Doc<"staff">,
  date: string,
  status: AttendanceStatus,
  actor: Id<"users">,
): Promise<boolean> {
  if (!worksOn(staff, date)) {
    throw appError("INVALID_DATE", `${staff.name} wasn't working on ${date}.`);
  }
  if (staff.status === "exited")
    throw appError(
      "CONFLICT",
      `${staff.name} has left; their attendance can't be changed.`,
    );
  const existing = await markOf(ctx, staff._id, date);
  if (existing?.status === status) return false;
  const now = Date.now();
  if (existing === null) {
    await ctx.db.insert("attendance", {
      staffId: staff._id,
      date,
      status,
      markedBy: actor,
      updatedAt: now,
    });
  } else {
    await ctx.db.patch(existing._id, {
      status,
      markedBy: actor,
      updatedAt: now,
    });
  }
  await ctx.db.insert("attendanceLog", {
    organizationId: staff.organizationId,
    staffId: staff._id,
    date,
    oldStatus: existing?.status ?? null,
    newStatus: status,
    changedBy: actor,
    changedAt: now,
  });
  return true;
}

/** The daily grid: everyone working on `date`, with their mark (null = not marked yet). */
export const day = adminQuery({
  args: { date: v.string() },
  handler: async (ctx, args) => {
    const date = checkDate(args.date);
    const staff = (await allStaff(ctx, ctx.admin)).filter(
      (s) => s.status === "active" && worksOn(s, date),
    );
    const propertyName = propertyNames(ctx.admin);
    const rows = await Promise.all(
      staff.map(async (s) => {
        const mark = await markOf(ctx, s._id, date);
        return {
          staffId: s._id,
          name: s.name,
          department: s.department,
          propertyName: propertyName(s.propertyId),
          status: mark?.status ?? null,
        };
      }),
    );
    return {
      date,
      today: todayInIndia(),
      /** The 31st is recorded but not counted for pay. */
      countsForPay: fromRealDate(date) !== null,
      rows,
      marked: rows.filter((r) => r.status !== null).length,
    };
  },
});

/** Saves the daily grid in one go. Unchanged marks are skipped (and not logged). */
export const saveDay = adminMutation({
  args: {
    date: v.string(),
    entries: v.array(
      v.object({ staffId: v.id("staff"), status: vAttendanceStatus }),
    ),
  },
  handler: async (ctx, args) => {
    const date = checkDate(args.date);
    if (args.entries.length > 500)
      throw appError("INVALID_INPUT", "Too many people at once.");
    let changed = 0;
    for (const entry of args.entries) {
      const staff = await loadStaff(ctx, ctx.admin, entry.staffId);
      if (await setMark(ctx, staff, date, entry.status, ctx.admin.userId))
        changed += 1;
    }
    return { changed };
  },
});

/** One person, one day (from the month view). */
export const setOne = adminMutation({
  args: { staffId: v.id("staff"), date: v.string(), status: vAttendanceStatus },
  handler: async (ctx, args) => {
    const date = checkDate(args.date);
    const staff = await loadStaff(ctx, ctx.admin, args.staffId);
    return {
      changed: await setMark(ctx, staff, date, args.status, ctx.admin.userId),
    };
  },
});

/** One person's real calendar month ("YYYY-MM"), with unmarked past days flagged. */
export const month = adminQuery({
  args: { staffId: v.id("staff"), month: v.string() },
  handler: async (ctx, args) => {
    if (!/^\d{4}-\d{2}$/.test(args.month)) throw appError("INVALID_INPUT");
    const staff = await loadStaff(ctx, ctx.admin, args.staffId);
    const { y, m } = parseIsoDate(`${args.month}-01`);
    const today = todayInIndia();
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
    const days = realDatesOfMonth(y, m).map((date) => {
      const status = byDate.get(date) ?? null;
      const working = worksOn(staff, date);
      return {
        date,
        status,
        working,
        future: date > today,
        countsForPay: fromRealDate(date) !== null,
        unmarked:
          working &&
          status === null &&
          date < today &&
          date >= staff.attendanceFrom,
      };
    });
    const counts = Object.fromEntries(
      ATTENDANCE_STATUSES.map((s) => [s, 0]),
    ) as Record<AttendanceStatus, number>;
    for (const d of days) if (d.status) counts[d.status] += 1;
    return {
      staff: {
        staffId: staff._id,
        name: staff.name,
        status: staff.status,
        joinDate: staff.joinDate,
      },
      month: args.month,
      days,
      counts,
      unmarked: days.filter((d) => d.unmarked).length,
    };
  },
});

/** Longest stretch of the log looked through to fill one page for a single property. */
const LOG_SCAN_LIMIT = 5_000;

/** The attendance audit log, newest first (optionally for one person; else for the properties in scope). */
export const log = adminQuery({
  args: { staffId: v.optional(v.id("staff")), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);
    let rows: Doc<"attendanceLog">[];
    if (args.staffId) {
      const staff = await loadStaff(ctx, ctx.admin, args.staffId);
      rows = await ctx.db
        .query("attendanceLog")
        .withIndex("by_staff_changedAt", (q) => q.eq("staffId", staff._id))
        .order("desc")
        .take(limit);
    } else {
      const inView = new Set(
        (await allStaff(ctx, ctx.admin)).map((s) => s._id),
      );
      rows = [];
      let scanned = 0;
      for await (const row of ctx.db
        .query("attendanceLog")
        .withIndex("by_org_changedAt", (q) =>
          q.eq("organizationId", ctx.admin.organization._id),
        )
        .order("desc")) {
        if (inView.has(row.staffId)) rows.push(row);
        scanned += 1;
        if (rows.length >= limit || scanned >= LOG_SCAN_LIMIT) break;
      }
    }
    const names = new Map<string, string>();
    const nameOf = async (id: Id<"staff"> | Id<"users">) => {
      if (!names.has(id)) {
        const doc = await ctx.db.get(id);
        names.set(id, doc?.name ?? "Unknown");
      }
      return names.get(id)!;
    };
    return await Promise.all(
      rows.map(async (row) => ({
        logId: row._id,
        staffId: row.staffId,
        staffName: await nameOf(row.staffId),
        date: row.date,
        oldStatus: row.oldStatus,
        newStatus: row.newStatus,
        changedByName: await nameOf(row.changedBy),
        changedAt: row.changedAt,
      })),
    );
  },
});
