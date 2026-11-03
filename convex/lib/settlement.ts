import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { writeAudit } from "./audit";
import { scheduleFor } from "./staffData";

/**
 * Pays everything still owed to a leaver (each payday, plus the reserve and
 * unsettled adjustments), releases the reserve unless forfeited, and marks
 * them as exited. Callers check permissions and dates first.
 */
export async function recordSettlement(
  ctx: Pick<MutationCtx, "db">,
  staff: Doc<"staff">,
  payment: { paidOn: string; mode: "cash" | "upi" | "bank"; note?: string },
  actor: Id<"users">,
  today: string,
): Promise<{ totalPaid: number }> {
  const schedule = await scheduleFor(ctx, staff, today);
  const settlement = schedule.settlement!;
  const now = Date.now();
  let total = 0;
  const lines = [
    ...schedule.paydays.map((p) => ({ key: p.key, outstanding: p.outstanding })),
    { key: settlement.key, outstanding: settlement.extrasOutstanding },
  ];
  for (const line of lines) {
    if (line.outstanding <= 0) continue;
    await ctx.db.insert("payments", {
      staffId: staff._id,
      paydayKey: line.key,
      amount: line.outstanding,
      paidOn: payment.paidOn,
      mode: payment.mode,
      note: payment.note ?? "Final settlement",
      recordedBy: actor,
      recordedAt: now,
    });
    total += line.outstanding;
  }
  const reserveStatus = staff.reserveStatus === "held" ? "released" : staff.reserveStatus;
  await ctx.db.patch(staff._id, { status: "exited", exitedAt: now, reserveStatus });
  await writeAudit(ctx, {
    actorUserId: actor,
    action: "exit.settled",
    entityType: "staff",
    entityId: staff._id,
    staffId: staff._id,
    metadata: {
      lastWorkingDay: staff.lastWorkingDay,
      paidOn: payment.paidOn,
      mode: payment.mode,
      totalPaid: total,
      reserveStatus,
      reserveAmount: settlement.reserveAmount,
    },
  });
  return { totalPaid: total };
}
