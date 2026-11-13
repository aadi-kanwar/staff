/**
 * Staff: asking for a change to where their salary is paid (UPI / bank).
 * The request waits on their record until an admin approves or rejects it
 * (people.approvePayout / rejectPayout); admins are notified on their phones.
 */
import { internal } from "./_generated/api";
import { writeAudit } from "./lib/audit";
import { selfMutation } from "./lib/functions";
import { checkPayout, vPayoutInput } from "./lib/payout";

export const submit = selfMutation({
  args: { details: vPayoutInput },
  handler: async (ctx, args) => {
    const staff = ctx.self.staff;
    const details = checkPayout(args.details, true);
    await ctx.db.patch(staff._id, {
      payoutRequest: { ...details, submittedAt: Date.now() },
    });
    await writeAudit(ctx, {
      organizationId: staff.organizationId,
      actorUserId: ctx.self.userId,
      action: "staff.payout_requested",
      entityType: "staff",
      entityId: staff._id,
      staffId: staff._id,
    });
    await ctx.scheduler.runAfter(
      0,
      internal.notifications.notifyPayoutRequest,
      { staffId: staff._id },
    );
    return null;
  },
});

/** Takes back a request that hasn't been approved yet. */
export const withdraw = selfMutation({
  args: {},
  handler: async (ctx) => {
    if (ctx.self.staff.payoutRequest)
      await ctx.db.patch(ctx.self.staff._id, { payoutRequest: undefined });
    return null;
  },
});
