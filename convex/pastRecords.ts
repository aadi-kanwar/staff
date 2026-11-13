/**
 * Admin: past payments, for the record only. One record is what was paid
 * for a period before (or outside) the app, as a single breakdown: salary,
 * plus any bonus, minus any deduction. Records never count towards what's
 * owed, the ledger, payroll or report totals; they're shown on the staff
 * member's calendars and in their payment history.
 */
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { writeAudit } from "./lib/audit";
import { appError } from "./lib/errors";
import { adminMutation } from "./lib/functions";
import { isoDateSchema, noteSchema } from "./lib/inputRules";
import { loadStaff } from "./lib/staffData";
import { vPaymentMode } from "./lib/validators";

/** A staff member's past records, oldest first, with their totals. */
export async function pastRecordsOf(
  ctx: Pick<QueryCtx, "db">,
  staffId: Id<"staff">,
) {
  const rows = await ctx.db
    .query("pastRecords")
    .withIndex("by_staff", (q) => q.eq("staffId", staffId))
    .collect();
  return rows
    .map(recordView)
    .sort((a, b) => a.from.localeCompare(b.from) || a.createdAt - b.createdAt);
}

/**
 * Made from an entry saved with the earlier "Record a past entry" (not
 * created with "Record a past payment"). Converted rows keep the original
 * entry's time, so they were saved well after `createdAt`; newer conversions
 * are marked with `source`.
 */
export function isConverted(r: Doc<"pastRecords">): boolean {
  return r.source === "converted" || r._creationTime - r.createdAt > 60_000;
}

export function recordView(r: Doc<"pastRecords">) {
  return {
    recordId: r._id,
    /** Converted from an earlier entry: listed for the admin, not shown on calendars or to staff. */
    converted: isConverted(r),
    from: r.from,
    to: r.to,
    salary: r.salary,
    bonus: r.bonus,
    deduction: r.deduction,
    total: r.salary + r.bonus - r.deduction,
    paidOn: r.paidOn ?? null,
    mode: r.mode ?? null,
    note: r.note ?? null,
    createdAt: r.createdAt,
  };
}

const rupees = (n: number | undefined) =>
  n === undefined || !Number.isFinite(n) ? 0 : Math.max(Math.round(n), 0);

/** Records a past payment: the dates it was for, salary, bonus and deduction, when and how it was paid. */
export const add = adminMutation({
  args: {
    staffId: v.id("staff"),
    from: v.string(),
    to: v.string(),
    salary: v.number(),
    bonus: v.optional(v.number()),
    deduction: v.optional(v.number()),
    paidOn: v.optional(v.string()),
    mode: v.optional(vPaymentMode),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (
      !isoDateSchema.safeParse(args.from).success ||
      !isoDateSchema.safeParse(args.to).success
    ) {
      throw appError(
        "INVALID_DATE",
        "Choose the first and last day of the period.",
      );
    }
    const [from, to] =
      args.from <= args.to ? [args.from, args.to] : [args.to, args.from];
    const salary = rupees(args.salary);
    const bonus = rupees(args.bonus);
    const deduction = rupees(args.deduction);
    if (salary + bonus + deduction === 0)
      throw appError("INVALID_INPUT", "Enter an amount.");
    const note = args.note?.trim() ? noteSchema.safeParse(args.note) : null;
    if (note && !note.success)
      throw appError("INVALID_INPUT", note.error.issues[0]?.message);
    const paidOn =
      args.paidOn && isoDateSchema.safeParse(args.paidOn).success
        ? args.paidOn
        : undefined;
    const staff = await loadStaff(ctx, ctx.admin, args.staffId);
    const recordId = await ctx.db.insert("pastRecords", {
      staffId: staff._id,
      from,
      to,
      salary,
      bonus,
      deduction,
      paidOn,
      mode: args.mode,
      note: note?.data || undefined,
      createdBy: ctx.admin.userId,
      createdAt: Date.now(),
    });
    await writeAudit(ctx, {
      organizationId: staff.organizationId,
      actorUserId: ctx.admin.userId,
      action: "past_record.added",
      entityType: "pastRecords",
      entityId: recordId,
      staffId: staff._id,
      metadata: { from, to, salary, bonus, deduction, paidOn },
    });
    return recordId;
  },
});

export const remove = adminMutation({
  args: { recordId: v.id("pastRecords") },
  handler: async (ctx, { recordId }) => {
    const record = await ctx.db.get(recordId);
    if (record === null) throw appError("NOT_FOUND");
    const staff = await loadStaff(ctx, ctx.admin, record.staffId);
    await ctx.db.delete(recordId);
    await writeAudit(ctx, {
      organizationId: staff.organizationId,
      actorUserId: ctx.admin.userId,
      action: "past_record.removed",
      entityType: "pastRecords",
      entityId: recordId,
      staffId: staff._id,
      metadata: recordView(record),
    });
    return null;
  },
});
