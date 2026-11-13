/** Admin: the dashboard. */
import { addRealDays } from "./lib/companyCalendar";
import { adminQuery } from "./lib/functions";
import {
  allSchedules,
  monthBounds,
  openPaydays,
  paydaysBetween,
} from "./lib/adminViews";
import { allStaff, worksOn } from "./lib/staffData";
import { todayInIndia } from "./lib/time";

export const summary = adminQuery({
  args: {},
  handler: async (ctx) => {
    const today = todayInIndia();
    const entries = await allSchedules(ctx, ctx.admin, today);
    const working = entries.filter(
      ({ staff }) => staff.status === "active" && worksOn(staff, today),
    );
    let marked = 0;
    for (const { staff } of working) {
      const mark = await ctx.db
        .query("attendance")
        .withIndex("by_staff_date", (q) =>
          q.eq("staffId", staff._id).eq("date", today),
        )
        .unique();
      if (mark !== null) marked += 1;
    }
    const open = openPaydays(entries, today, 7);
    const weekEnd = addRealDays(today, 7);
    const thisMonth = monthBounds(today);
    const { month, rows: monthRows } = await paydaysBetween(
      ctx,
      ctx.admin,
      today,
      thisMonth.start,
      thisMonth.end,
    );
    return {
      today,
      /** This calendar month: total due, still pending, paid this month. */
      month,
      /** Every payday due this month, paid or not. */
      monthRows,
      attendance: { working: working.length, marked },
      dueSoon: open.filter(
        (r) => r.dueDate >= today && r.dueDate <= weekEnd && !r.overdue,
      ),
      overdue: open.filter((r) => r.overdue),
      totalOwed: entries.reduce((a, { schedule }) => a + schedule.pending, 0),
      reservesHeld: entries
        .filter(
          ({ staff }) =>
            staff.status === "active" && staff.reserveStatus === "held",
        )
        .reduce((a, { schedule }) => a + schedule.reserve.amount, 0),
      activeStaff: entries.filter(({ staff }) => staff.status === "active")
        .length,
      /** People who asked to change where their salary is paid. */
      payoutApprovals: (await allStaff(ctx, ctx.admin))
        .filter((s) => s.payoutRequest !== undefined)
        .map((s) => ({ staffId: s._id, name: s.name })),
      settlementsWaiting: entries
        .filter(
          ({ staff }) =>
            staff.status === "active" &&
            staff.lastWorkingDay !== undefined &&
            staff.lastWorkingDay <= today,
        )
        .map(({ staff, schedule }) => ({
          staffId: staff._id,
          name: staff.name,
          lastWorkingDay: staff.lastWorkingDay!,
          total: schedule.settlement?.totalOutstanding ?? 0,
        })),
    };
  },
});
