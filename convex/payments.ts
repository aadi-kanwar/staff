/** Admin: payments against paydays. Partial payments are allowed; overpaying isn't. */
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { notifyPayment } from "./notifications";
import { writeAudit } from "./lib/audit";
import { appError } from "./lib/errors";
import { adminMutation, adminQuery, type AdminViewer } from "./lib/functions";
import { amountSchema, isoDateSchema, noteSchema } from "./lib/inputRules";
import type { Schedule } from "./lib/payroll";
import { loadStaff, scheduleFor } from "./lib/staffData";
import { todayInIndia } from "./lib/time";
import { vPaymentMode } from "./lib/validators";

const vItem = v.object({
  staffId: v.id("staff"),
  paydayKey: v.string(),
  amount: v.number(),
  paidOn: v.string(),
  mode: vPaymentMode,
  note: v.optional(v.string()),
});
type Item = typeof vItem.type;

/** What's still owed on `key`, or throws if it isn't one of this person's paydays. */
function outstandingOf(schedule: Schedule, key: string): number {
  if (schedule.settlement?.key === key)
    return schedule.settlement.extrasOutstanding;
  const payday = schedule.paydays.find((p) => p.key === key);
  if (payday === undefined)
    throw appError("NOT_FOUND", "That payday wasn't found.");
  return payday.outstanding;
}

async function recordAll(
  ctx: Pick<MutationCtx, "db" | "scheduler">,
  admin: AdminViewer,
  items: Item[],
) {
  const actor = admin.userId;
  if (items.length === 0 || items.length > 200)
    throw appError("INVALID_INPUT", "Choose between 1 and 200 payments.");
  const today = todayInIndia();
  const schedules = new Map<
    Id<"staff">,
    { staff: Doc<"staff">; schedule: Schedule }
  >();
  const used = new Map<string, number>();
  const ids: Id<"payments">[] = [];
  for (const item of items) {
    const amount = amountSchema.safeParse(item.amount);
    if (!amount.success)
      throw appError("INVALID_INPUT", amount.error.issues[0]?.message);
    if (!isoDateSchema.safeParse(item.paidOn).success)
      throw appError("INVALID_DATE");
    if (item.paidOn > today)
      throw appError(
        "INVALID_DATE",
        "The payment date can't be in the future.",
      );
    const note = item.note?.trim() ? noteSchema.safeParse(item.note) : null;
    if (note && !note.success)
      throw appError("INVALID_INPUT", note.error.issues[0]?.message);
    let entry = schedules.get(item.staffId);
    if (!entry) {
      const staff = await loadStaff(ctx, admin, item.staffId);
      entry = { staff, schedule: await scheduleFor(ctx, staff, today) };
      schedules.set(item.staffId, entry);
    }
    const left =
      outstandingOf(entry.schedule, item.paydayKey) -
      (used.get(item.paydayKey) ?? 0);
    if (amount.data > left) {
      throw appError(
        "INVALID_INPUT",
        left <= 0
          ? `Nothing is owed on that payday for ${entry.staff.name}.`
          : `That's more than the ₹${left.toLocaleString("en-IN")} still owed to ${entry.staff.name} for that payday.`,
      );
    }
    used.set(item.paydayKey, (used.get(item.paydayKey) ?? 0) + amount.data);
    const paymentId = await ctx.db.insert("payments", {
      staffId: item.staffId,
      paydayKey: item.paydayKey,
      amount: amount.data,
      paidOn: item.paidOn,
      mode: item.mode,
      note: note?.data || undefined,
      recordedBy: actor,
      recordedAt: Date.now(),
    });
    await writeAudit(ctx, {
      organizationId: entry.staff.organizationId,
      actorUserId: actor,
      action: "payment.recorded",
      entityType: "payments",
      entityId: paymentId,
      staffId: item.staffId,
      metadata: {
        paydayKey: item.paydayKey,
        amount: amount.data,
        paidOn: item.paidOn,
        mode: item.mode,
      },
    });
    ids.push(paymentId);
    await notifyPayment(ctx, entry.staff, {
      amount: amount.data,
      paidOn: item.paidOn,
      paydayDate:
        entry.schedule.paydays.find((p) => p.key === item.paydayKey)?.dueDate ??
        null,
      remaining: left - amount.data,
    });
  }
  return ids;
}

export const record = adminMutation({
  args: vItem.fields,
  handler: async (ctx, args) => (await recordAll(ctx, ctx.admin, [args]))[0],
});

/** Several payments at once (e.g. everyone due this week). All or nothing. */
export const recordMany = adminMutation({
  args: { items: v.array(vItem) },
  handler: async (ctx, { items }) => ({
    recorded: (await recordAll(ctx, ctx.admin, items)).length,
  }),
});

/** Removes a payment entered by mistake (kept in the audit log). */
export const remove = adminMutation({
  args: { paymentId: v.id("payments") },
  handler: async (ctx, { paymentId }) => {
    const payment = await ctx.db.get(paymentId);
    if (payment === null) throw appError("NOT_FOUND");
    const staff = await loadStaff(ctx, ctx.admin, payment.staffId);
    if (staff.status !== "active")
      throw appError(
        "CONFLICT",
        "This person has left. Their payments can't be changed.",
      );
    await ctx.db.delete(paymentId);
    await writeAudit(ctx, {
      organizationId: staff.organizationId,
      actorUserId: ctx.admin.userId,
      action: "payment.removed",
      entityType: "payments",
      entityId: paymentId,
      staffId: staff._id,
      metadata: {
        paydayKey: payment.paydayKey,
        amount: payment.amount,
        paidOn: payment.paidOn,
        mode: payment.mode,
      },
    });
    return null;
  },
});

const dayMs = 86_400_000;
const realDays = (from: string, to: string) =>
  Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / dayMs,
  ) + 1;

/**
 * The paydays a past payment for `from`–`to` covers: those whose work period
 * lies mostly (at least half its days) inside the dates, oldest first, and
 * how `amount` is spread over them (each up to what's still owed on it).
 */
function planPast(
  schedule: Schedule,
  from: string,
  to: string,
  amount: number,
) {
  let left = amount;
  const covered = schedule.paydays
    .filter((p) => {
      const start = p.cycleStartDate > from ? p.cycleStartDate : from;
      const end = p.cycleEndDate < to ? p.cycleEndDate : to;
      if (end < start) return false;
      return (
        realDays(start, end) * 2 >= realDays(p.cycleStartDate, p.cycleEndDate)
      );
    })
    .map((p) => {
      const apply = Math.max(Math.min(left, p.outstanding), 0);
      left -= apply;
      return {
        key: p.key,
        dueDate: p.dueDate,
        cycleStartDate: p.cycleStartDate,
        cycleEndDate: p.cycleEndDate,
        net: p.net,
        outstanding: p.outstanding,
        apply,
      };
    });
  const owed = covered.reduce((a, p) => a + Math.max(p.outstanding, 0), 0);
  return { covered, owed, unapplied: left };
}

function checkPeriod(from: string, to: string) {
  if (
    !isoDateSchema.safeParse(from).success ||
    !isoDateSchema.safeParse(to).success
  ) {
    throw appError(
      "INVALID_DATE",
      "Choose the first and last day of the period.",
    );
  }
  if (to < from)
    throw appError(
      "INVALID_DATE",
      "The period must end on or after it starts.",
    );
}

/** Preview for "Record a past payment": which paydays the dates cover and how the amount is spread. */
export const planPastPayment = adminQuery({
  args: {
    staffId: v.id("staff"),
    from: v.string(),
    to: v.string(),
    amount: v.number(),
  },
  handler: async (ctx, args) => {
    checkPeriod(args.from, args.to);
    const staff = await loadStaff(ctx, ctx.admin, args.staffId);
    const schedule = await scheduleFor(ctx, staff, todayInIndia(), 24);
    return planPast(
      schedule,
      args.from,
      args.to,
      Math.max(Math.floor(args.amount) || 0, 0),
    );
  },
});

/**
 * Records a payment made before (outside the app) for a salary period: the
 * amount is spread over that period's paydays, oldest first. Refused if the
 * dates cover no payday or the amount is more than is owed for them.
 */
export const recordPast = adminMutation({
  args: {
    staffId: v.id("staff"),
    from: v.string(),
    to: v.string(),
    amount: v.number(),
    paidOn: v.string(),
    mode: vPaymentMode,
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    checkPeriod(args.from, args.to);
    const amount = amountSchema.safeParse(args.amount);
    if (!amount.success)
      throw appError("INVALID_INPUT", amount.error.issues[0]?.message);
    if (!isoDateSchema.safeParse(args.paidOn).success)
      throw appError("INVALID_DATE");
    const today = todayInIndia();
    if (args.paidOn > today)
      throw appError(
        "INVALID_DATE",
        "The payment date can't be in the future.",
      );
    const note = args.note?.trim() ? noteSchema.safeParse(args.note) : null;
    if (note && !note.success)
      throw appError("INVALID_INPUT", note.error.issues[0]?.message);
    const staff = await loadStaff(ctx, ctx.admin, args.staffId);
    if (staff.status !== "active")
      throw appError(
        "CONFLICT",
        "This person has left. Their payments can't be changed.",
      );
    const plan = planPast(
      await scheduleFor(ctx, staff, today, 24),
      args.from,
      args.to,
      amount.data,
    );
    if (plan.covered.length === 0)
      throw appError(
        "INVALID_INPUT",
        "Those dates don't cover any pay period.",
      );
    if (plan.unapplied > 0) {
      throw appError(
        "INVALID_INPUT",
        `That's more than the ₹${plan.owed.toLocaleString("en-IN")} still owed for those dates.`,
      );
    }
    const now = Date.now();
    let count = 0;
    for (const p of plan.covered) {
      if (p.apply <= 0) continue;
      const paymentId = await ctx.db.insert("payments", {
        staffId: staff._id,
        paydayKey: p.key,
        amount: p.apply,
        paidOn: args.paidOn,
        mode: args.mode,
        note:
          note?.data ||
          `Past payment for ${p.cycleStartDate} to ${p.cycleEndDate}`,
        periodFrom: args.from,
        periodTo: args.to,
        recordedBy: ctx.admin.userId,
        recordedAt: now,
      });
      await writeAudit(ctx, {
        organizationId: staff.organizationId,
        actorUserId: ctx.admin.userId,
        action: "payment.recorded",
        entityType: "payments",
        entityId: paymentId,
        staffId: staff._id,
        metadata: {
          past: true,
          period: { from: args.from, to: args.to },
          paydayKey: p.key,
          amount: p.apply,
          paidOn: args.paidOn,
          mode: args.mode,
        },
      });
      count += 1;
    }
    return { paydays: count };
  },
});
