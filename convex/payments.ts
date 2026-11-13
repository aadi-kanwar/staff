/** Admin: payments against paydays. Partial payments are allowed; overpaying isn't. */
import { v } from "convex/values";
import { formatInTimeZone } from "date-fns-tz";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { notifyPayment } from "./notifications";
import { writeAudit } from "./lib/audit";
import { appError } from "./lib/errors";
import { adminMutation, adminQuery, type AdminViewer } from "./lib/functions";
import { amountSchema, isoDateSchema, noteSchema } from "./lib/inputRules";
import { pastKey, type Schedule } from "./lib/payroll";
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

/** Which kind of past entry: money paid, or a bonus / deduction that applied to that period. */
const vPastKind = v.union(
  v.literal("payment"),
  v.literal("bonus"),
  v.literal("deduction"),
);

/**
 * The paydays a past entry for `from`–`to` belongs to: those whose work
 * period lies mostly (at least half its days) inside the dates; if none, any
 * that overlap them. Oldest first. May be empty (dates with no pay period).
 */
function coveredPaydays(schedule: Schedule, from: string, to: string) {
  const overlap = schedule.paydays
    .map((p) => {
      const start = p.cycleStartDate > from ? p.cycleStartDate : from;
      const end = p.cycleEndDate < to ? p.cycleEndDate : to;
      return { p, days: end < start ? 0 : realDays(start, end) };
    })
    .filter((x) => x.days > 0);
  const mostly = overlap.filter(
    (x) => x.days * 2 >= realDays(x.p.cycleStartDate, x.p.cycleEndDate),
  );
  return (mostly.length > 0 ? mostly : overlap).map((x) => x.p);
}

/** How a past payment of `amount` is spread: each covered payday up to what's owed, oldest first; the rest stays unlinked. */
function planPast(
  schedule: Schedule,
  from: string,
  to: string,
  amount: number,
) {
  let left = amount;
  const covered = coveredPaydays(schedule, from, to).map((p) => {
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
  return { covered, unlinked: Math.max(left, 0) };
}

/** "1 Feb – 10 Feb 2026", for the automatic notes staff see. */
function span(from: string, to: string) {
  const f = (d: string, pattern: string) =>
    formatInTimeZone(new Date(`${d}T12:00:00Z`), "UTC", pattern);
  return `${f(from, "d MMM")} – ${f(to, "d MMM yyyy")}`;
}

/** Dates as given, in order (a reversed range is simply swapped). */
function period(from: string, to: string) {
  if (
    !isoDateSchema.safeParse(from).success ||
    !isoDateSchema.safeParse(to).success
  ) {
    throw appError(
      "INVALID_DATE",
      "Choose the first and last day of the period.",
    );
  }
  return from <= to ? { from, to } : { from: to, to: from };
}

/** Preview for "Record a past entry": the pay periods the dates cover and how a payment is spread. */
export const planPastPayment = adminQuery({
  args: {
    staffId: v.id("staff"),
    from: v.string(),
    to: v.string(),
    amount: v.number(),
  },
  handler: async (ctx, args) => {
    const { from, to } = period(args.from, args.to);
    const staff = await loadStaff(ctx, ctx.admin, args.staffId);
    const schedule = await scheduleFor(ctx, staff, todayInIndia(), 24);
    return planPast(
      schedule,
      from,
      to,
      Math.max(Math.floor(args.amount) || 0, 0),
    );
  },
});

/**
 * Records something that happened before (outside the app) for a period:
 *  - a payment: spread over that period's paydays, oldest first; anything
 *    beyond what they owe (or all of it, if the dates have no pay period) is
 *    kept as a past payment for those dates;
 *  - a bonus or deduction: added to the first pay period in those dates (or
 *    kept as a past entry if there's none). A bonus can be marked as already
 *    paid, which records the payment too.
 * Always recorded: no check that the dates cover a pay period or that the
 * amount fits what's owed.
 */
export const recordPast = adminMutation({
  args: {
    staffId: v.id("staff"),
    kind: v.optional(vPastKind),
    from: v.string(),
    to: v.string(),
    amount: v.number(),
    paidOn: v.optional(v.string()),
    mode: v.optional(vPaymentMode),
    alreadyPaid: v.optional(v.boolean()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const kind = args.kind ?? "payment";
    const { from, to } = period(args.from, args.to);
    const amount = amountSchema.safeParse(args.amount);
    if (!amount.success)
      throw appError("INVALID_INPUT", amount.error.issues[0]?.message);
    const paidOn =
      args.paidOn && isoDateSchema.safeParse(args.paidOn).success
        ? args.paidOn
        : to;
    const mode = args.mode ?? "cash";
    const note = args.note?.trim() ? noteSchema.safeParse(args.note) : null;
    if (note && !note.success)
      throw appError("INVALID_INPUT", note.error.issues[0]?.message);
    const staff = await loadStaff(ctx, ctx.admin, args.staffId);
    if (staff.status !== "active")
      throw appError(
        "CONFLICT",
        "This person has left. Their payments can't be changed.",
      );
    const schedule = await scheduleFor(ctx, staff, todayInIndia(), 24);
    const now = Date.now();
    const unlinkedKey = pastKey(staff._id);
    const audit = (
      entityType: string,
      entityId: string,
      metadata: Record<string, unknown>,
    ) =>
      writeAudit(ctx, {
        organizationId: staff.organizationId,
        actorUserId: ctx.admin.userId,
        action:
          entityType === "payments" ? "payment.recorded" : "adjustment.added",
        entityType,
        entityId,
        staffId: staff._id,
        metadata: { past: true, period: { from, to }, ...metadata },
      });
    const pay = async (
      paydayKey: string,
      value: number,
      defaultNote: string,
    ) => {
      const id = await ctx.db.insert("payments", {
        staffId: staff._id,
        paydayKey,
        amount: value,
        paidOn,
        mode,
        note: note?.data || defaultNote,
        periodFrom: from,
        periodTo: to,
        recordedBy: ctx.admin.userId,
        recordedAt: now,
      });
      await audit("payments", id, { paydayKey, amount: value, paidOn, mode });
    };

    if (kind === "payment") {
      const plan = planPast(schedule, from, to, amount.data);
      let linked = 0;
      for (const p of plan.covered) {
        if (p.apply <= 0) continue;
        await pay(
          p.key,
          p.apply,
          `Past payment for ${span(p.cycleStartDate, p.cycleEndDate)}`,
        );
        linked += 1;
      }
      if (plan.unlinked > 0)
        await pay(
          unlinkedKey,
          plan.unlinked,
          `Past payment for ${span(from, to)}`,
        );
      return { paydays: linked, unlinked: plan.unlinked };
    }

    const target = coveredPaydays(schedule, from, to)[0] ?? null;
    const paydayKey = target?.key ?? unlinkedKey;
    const adjustmentId = await ctx.db.insert("adjustments", {
      staffId: staff._id,
      type: kind,
      amount: amount.data,
      note: note?.data || `Past ${kind} for ${span(from, to)}`,
      date: to,
      paydayKey,
      periodFrom: from,
      periodTo: to,
      createdBy: ctx.admin.userId,
      createdAt: now,
    });
    await audit("adjustments", adjustmentId, {
      type: kind,
      amount: amount.data,
      paydayKey,
    });
    if (kind === "bonus" && args.alreadyPaid)
      await pay(
        paydayKey,
        amount.data,
        `Past bonus paid, for ${span(from, to)}`,
      );
    return { paydays: target ? 1 : 0, unlinked: target ? 0 : amount.data };
  },
});
