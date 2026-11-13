import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

export type AuditAction =
  | "setup.first_admin_created"
  | "dev.seeded"
  | "staff.created"
  | "staff.updated"
  | "staff.password_reset"
  | "user.password_changed"
  | "salary.revised"
  | "salary.mode_changed"
  | "salary.revision_cancelled"
  | "payment.recorded"
  | "payment.removed"
  | "adjustment.added"
  | "adjustment.removed"
  | "exit.last_day_set"
  | "exit.cancelled"
  | "exit.settled"
  | "reserve.forfeited"
  | "reserve.restored"
  | "organization.created"
  | "organization.renamed"
  | "property.added"
  | "property.renamed"
  | "report.exported"
  | "migration.assigned_existing_data"
  | "staff.marking_changed"
  | "staff.deleted"
  | "salary.corrected"
  | "admin.added"
  | "admin.removed"
  | "admin.password_reset"
  | "sso.signed_in"
  | "sso.access_revoked"
  | "staff.payout_updated"
  | "staff.payout_requested"
  | "staff.payout_approved"
  | "staff.payout_rejected";

/**
 * Appends one entry to the admin audit log. Never put passwords, tokens or
 * other secrets in `metadata`.
 */
export async function writeAudit(
  ctx: Pick<MutationCtx, "db">,
  entry: {
    /** The organisation the action belongs to (undefined only for setup outside any organisation). */
    organizationId: Id<"organizations"> | undefined;
    actorUserId: Id<"users"> | undefined;
    action: AuditAction;
    entityType: string;
    entityId: string;
    staffId?: Id<"staff">;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await ctx.db.insert("auditLog", { ...entry, createdAt: Date.now() });
}
