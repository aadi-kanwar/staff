/** Admin: due and upcoming paydays across all staff. */
import { v } from "convex/values";
import { adminQuery } from "./lib/functions";
import { allSchedules, openPaydays } from "./lib/adminViews";
import { todayInIndia } from "./lib/time";

export const overview = adminQuery({
  args: { days: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const today = todayInIndia();
    const days = Math.min(Math.max(args.days ?? 31, 0), 120);
    const rows = openPaydays(
      await allSchedules(ctx, ctx.admin, today),
      today,
      days,
    );
    return {
      today,
      days,
      rows,
      dueNow: rows
        .filter((r) => r.dueDate <= today)
        .reduce((a, r) => a + r.outstanding, 0),
    };
  },
});
