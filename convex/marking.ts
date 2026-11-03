/**
 * Attendance marking by a staff member an admin has given the permission
 * (staff.canMarkAttendance). They mark the OTHER working staff of their own
 * property, for today and the past few days; never themselves, never another
 * property, and they see nothing about pay. Every change goes to the same
 * append-only attendanceLog as an admin's, under the marker's name.
 */
import { v } from "convex/values";
import { setMark } from "./attendance";
import { addRealDays, fromRealDate } from "./lib/companyCalendar";
import { appError } from "./lib/errors";
import { markerMutation, markerQuery } from "./lib/functions";
import { isoDateSchema } from "./lib/inputRules";
import { worksOn } from "./lib/staffData";
import { todayInIndia } from "./lib/time";
import { vAttendanceStatus } from "./lib/validators";
import type { Doc } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";

/** How many days back a marker can still change. Older corrections go to an admin. */
export const MARKING_DAYS_BACK = 7;

function checkDate(date: string): string {
  if (!isoDateSchema.safeParse(date).success) throw appError("INVALID_DATE");
  const today = todayInIndia();
  if (date > today)
    throw appError(
      "INVALID_DATE",
      "Attendance can't be marked ahead of the day.",
    );
  if (date < addRealDays(today, -MARKING_DAYS_BACK)) {
    throw appError(
      "INVALID_DATE",
      `You can mark the last ${MARKING_DAYS_BACK} days only. Ask an admin for older changes.`,
    );
  }
  return date;
}

/** The other staff of the marker's property working on `date`, by name. */
async function colleagues(
  ctx: Pick<QueryCtx, "db">,
  self: Doc<"staff">,
  date: string,
) {
  const rows = await ctx.db
    .query("staff")
    .withIndex("by_property", (q) => q.eq("propertyId", self.propertyId))
    .collect();
  return rows
    .filter(
      (s) => s._id !== self._id && s.status === "active" && worksOn(s, date),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The marking grid for one day: name, department and mark only. */
export const day = markerQuery({
  args: { date: v.string() },
  handler: async (ctx, args) => {
    const date = checkDate(args.date);
    const today = todayInIndia();
    const property = await ctx.db.get(ctx.self.staff.propertyId);
    const rows = await Promise.all(
      (await colleagues(ctx, ctx.self.staff, date)).map(async (s) => {
        const mark = await ctx.db
          .query("attendance")
          .withIndex("by_staff_date", (q) =>
            q.eq("staffId", s._id).eq("date", date),
          )
          .unique();
        return {
          staffId: s._id,
          name: s.name,
          department: s.department,
          status: mark?.status ?? null,
        };
      }),
    );
    return {
      date,
      today,
      earliest: addRealDays(today, -MARKING_DAYS_BACK),
      propertyName: property?.name ?? "",
      /** The 31st is recorded but not counted for pay. */
      countsForPay: fromRealDate(date) !== null,
      rows,
      marked: rows.filter((r) => r.status !== null).length,
    };
  },
});

/** Saves the grid. Only the marker's working colleagues; unchanged marks are skipped. */
export const saveDay = markerMutation({
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
    const allowed = new Map(
      (await colleagues(ctx, ctx.self.staff, date)).map((s) => [
        s._id as string,
        s,
      ]),
    );
    let changed = 0;
    for (const entry of args.entries) {
      const staff = allowed.get(entry.staffId);
      if (!staff)
        throw appError(
          "FORBIDDEN",
          "You can only mark the other staff of your property.",
        );
      if (await setMark(ctx, staff, date, entry.status, ctx.self.userId))
        changed += 1;
    }
    return { changed };
  },
});
