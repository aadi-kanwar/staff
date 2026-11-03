/** Admin: payments against paydays. Partial payments are allowed; overpaying isn't. */
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { writeAudit } from "./lib/audit";
import { appError } from "./lib/errors";
import { adminMutation } from "./lib/functions";
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
  if (schedule.settlement?.key === key) return schedule.settlement.extrasOutstanding;
  const payday = schedule.paydays.find((p) => p.key === key);
  if (payday === undefined) throw appError("NOT_FOUND", "That payday wasn't found.");
  return payday.outstanding;
}

async function recordAll(ctx: Pick<MutationCtx, "db">, items: Item[], actor: Id<"users">) {
  if (items.length === 0 || items.length > 200) throw appError("INVALID_INPUT", "Choose between 1 and 200 payments.");
  const today = todayInIndia();
  const schedules = new Map<Id<"staff">, { staff: Doc<"staff">; schedule: Schedule }>();
  const used = new Map<string, number>();
  const ids: Id<"payments">[] = [];
  for (const item of items) {
    const amount = amountSchema.safeParse(item.amount);
    if (!amount.success) throw appError("INVALID_INPUT", amount.error.issues[0]?.message);
    if (!isoDateSchema.safeParse(item.paidOn).success) throw appError("INVALID_DATE");
    if (item.paidOn > today) throw appError("INVALID_DATE", "The payment date can't be in the future.");
    const note = item.note?.trim() ? noteSchema.safeParse(item.note) : null;
    if (note && !note.success) throw appError("INVALID_INPUT", note.error.issues[0]?.message);
    let entry = schedules.get(item.staffId);
    if (!entry) {
      const staff = await loadStaff(ctx, item.staffId);
      entry = { staff, schedule: await scheduleFor(ctx, staff, today) };
      schedules.set(item.staffId, entry);
    }
    const left = outstandingOf(entry.schedule, item.paydayKey) - (used.get(item.paydayKey) ?? 0);
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
      actorUserId: actor,
      action: "payment.recorded",
      entityType: "payments",
      entityId: paymentId,
      staffId: item.staffId,
      metadata: { paydayKey: item.paydayKey, amount: amount.data, paidOn: item.paidOn, mode: item.mode },
    });
    ids.push(paymentId);
  }
  return ids;
}

export const record = adminMutation({
  args: vItem.fields,
  handler: async (ctx, args) => (await recordAll(ctx, [args], ctx.admin.userId))[0],
});

/** Several payments at once (e.g. everyone due this week). All or nothing. */
export const recordMany = adminMutation({
  args: { items: v.array(vItem) },
  handler: async (ctx, { items }) => ({ recorded: (await recordAll(ctx, items, ctx.admin.userId)).length }),
});

/** Removes a payment entered by mistake (kept in the audit log). */
export const remove = adminMutation({
  args: { paymentId: v.id("payments") },
  handler: async (ctx, { paymentId }) => {
    const payment = await ctx.db.get(paymentId);
    if (payment === null) throw appError("NOT_FOUND");
    const staff = await loadStaff(ctx, payment.staffId);
    if (staff.status !== "active") throw appError("CONFLICT", "This person has left. Their payments can't be changed.");
    await ctx.db.delete(paymentId);
    await writeAudit(ctx, {
      actorUserId: ctx.admin.userId,
      action: "payment.removed",
      entityType: "payments",
      entityId: paymentId,
      staffId: staff._id,
      metadata: { paydayKey: payment.paydayKey, amount: payment.amount, paidOn: payment.paidOn, mode: payment.mode },
    });
    return null;
  },
});
