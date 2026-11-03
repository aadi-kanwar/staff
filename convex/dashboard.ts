/** Admin: the dashboard. */
import { addRealDays } from "./lib/companyCalendar";
import { adminQuery } from "./lib/functions";
import { allSchedules, openPaydays } from "./lib/adminViews";
import { worksOn } from "./lib/staffData";
import { todayInIndia } from "./lib/time";

export const summary = adminQuery({
  args: {},
  handler: async (ctx) => {
    const today = todayInIndia();
    const entries = await allSchedules(ctx, today);
    const working = entries.filter(({ staff }) => staff.status === "active" && worksOn(staff, today));
    let marked = 0;
    for (const { staff } of working) {
      const mark = await ctx.db
        .query("attendance")
        .withIndex("by_staff_date", (q) => q.eq("staffId", staff._id).eq("date", today))
        .unique();
      if (mark !== null) marked += 1;
    }
    const open = openPaydays(entries, today, 7);
    const weekEnd = addRealDays(today, 7);
    return {
      today,
      attendance: { working: working.length, marked },
      dueSoon: open.filter((r) => r.dueDate >= today && r.dueDate <= weekEnd && !r.overdue),
      overdue: open.filter((r) => r.overdue),
      totalOwed: entries.reduce((a, { schedule }) => a + schedule.pending, 0),
      reservesHeld: entries
        .filter(({ staff }) => staff.status === "active" && staff.reserveStatus === "held")
        .reduce((a, { schedule }) => a + schedule.reserve.amount, 0),
      activeStaff: entries.filter(({ staff }) => staff.status === "active").length,
      settlementsWaiting: entries
        .filter(({ staff }) => staff.status === "active" && staff.lastWorkingDay !== undefined && staff.lastWorkingDay <= today)
        .map(({ staff, schedule }) => ({
          staffId: staff._id,
          name: staff.name,
          lastWorkingDay: staff.lastWorkingDay!,
          total: schedule.settlement?.totalOutstanding ?? 0,
        })),
    };
  },
});
