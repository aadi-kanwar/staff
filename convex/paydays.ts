/** Admin: due and upcoming paydays across all staff. */
import { v } from "convex/values";
import { adminQuery } from "./lib/functions";
import { allSchedules, openPaydays, paydaysBetween } from "./lib/adminViews";
import { appError } from "./lib/errors";
import { isoDateSchema } from "./lib/inputRules";
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

/** Longest range the Payroll screen can show at once, in days. */
export const MAX_RANGE_DAYS = 366;

/**
 * Payroll and the dashboard calendar: every payday due between `from` and
 * `to` (paid or not), what's owed now, and this month's totals.
 */
export const range = adminQuery({
  args: { from: v.string(), to: v.string() },
  handler: async (ctx, args) => {
    const from = isoDateSchema.safeParse(args.from);
    const to = isoDateSchema.safeParse(args.to);
    if (!from.success || !to.success)
      throw appError("INVALID_INPUT", "Choose a start and an end date.");
    if (to.data < from.data)
      throw appError(
        "INVALID_INPUT",
        "The end date must be on or after the start date.",
      );
    const span = (Date.parse(to.data) - Date.parse(from.data)) / 86_400_000 + 1;
    if (span > MAX_RANGE_DAYS)
      throw appError("INVALID_INPUT", `Choose at most ${MAX_RANGE_DAYS} days.`);
    const today = todayInIndia();
    return {
      today,
      from: from.data,
      to: to.data,
      ...(await paydaysBetween(ctx, ctx.admin, today, from.data, to.data)),
    };
  },
});
