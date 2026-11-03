/** Admin: advances, deductions and bonuses, each settling against one payday. */
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { writeAudit } from "./lib/audit";
import { appError } from "./lib/errors";
import { adminMutation } from "./lib/functions";
import { amountSchema, isoDateSchema, noteSchema } from "./lib/inputRules";
import type { Schedule } from "./lib/payroll";
import { loadStaff, scheduleFor } from "./lib/staffData";
import { todayInIndia } from "./lib/time";
import { vAdjustmentType } from "./lib/validators";

/** Paydays (and the final settlement) that still accept adjustments: not fully paid. */
function openTarget(schedule: Schedule, key: string): boolean {
  if (schedule.settlement?.key === key) return true;
  const payday = schedule.paydays.find((p) => p.key === key);
  return payday !== undefined && payday.status !== "paid";
}

function requireActive(staff: Doc<"staff">) {
  if (staff.status !== "active") throw appError("CONFLICT", "This person has left. Their record can't be changed.");
}

export const add = adminMutation({
  args: {
    staffId: v.id("staff"),
    type: vAdjustmentType,
    amount: v.number(),
    note: v.string(),
    date: v.string(),
    paydayKey: v.string(),
  },
  handler: async (ctx, args) => {
    const staff = await loadStaff(ctx, args.staffId);
    requireActive(staff);
    const amount = amountSchema.safeParse(args.amount);
    if (!amount.success) throw appError("INVALID_INPUT", amount.error.issues[0]?.message);
    const note = noteSchema.min(1, "Add a note; staff will see it.").safeParse(args.note);
    if (!note.success) throw appError("INVALID_INPUT", note.error.issues[0]?.message);
    if (!isoDateSchema.safeParse(args.date).success) throw appError("INVALID_DATE");
    const schedule = await scheduleFor(ctx, staff, todayInIndia());
    if (!openTarget(schedule, args.paydayKey)) {
      throw appError("INVALID_INPUT", "Choose a payday that isn't fully paid yet.");
    }
    const adjustmentId = await ctx.db.insert("adjustments", {
      staffId: staff._id,
      type: args.type,
      amount: amount.data,
      note: note.data,
      date: args.date,
      paydayKey: args.paydayKey,
      createdBy: ctx.admin.userId,
      createdAt: Date.now(),
    });
    await writeAudit(ctx, {
      actorUserId: ctx.admin.userId,
      action: "adjustment.added",
      entityType: "adjustments",
      entityId: adjustmentId,
      staffId: staff._id,
      metadata: { type: args.type, amount: amount.data, paydayKey: args.paydayKey, note: note.data },
    });
    return adjustmentId;
  },
});

export const remove = adminMutation({
  args: { adjustmentId: v.id("adjustments") },
  handler: async (ctx, { adjustmentId }) => {
    const adjustment = await ctx.db.get(adjustmentId);
    if (adjustment === null) throw appError("NOT_FOUND");
    const staff = await loadStaff(ctx, adjustment.staffId);
    requireActive(staff);
    const schedule = await scheduleFor(ctx, staff, todayInIndia());
    const payday = schedule.paydays.find((p) => p.key === adjustment.paydayKey);
    if (payday?.status === "paid") throw appError("CONFLICT", "That payday is already paid, so the adjustment can't be removed.");
    await ctx.db.delete(adjustmentId);
    await writeAudit(ctx, {
      actorUserId: ctx.admin.userId,
      action: "adjustment.removed",
      entityType: "adjustments",
      entityId: adjustmentId,
      staffId: staff._id,
      metadata: { type: adjustment.type, amount: adjustment.amount, paydayKey: adjustment.paydayKey, note: adjustment.note },
    });
    return null;
  },
});
