/**
 * One-time data migrations. INTERNAL: run from the CLI only.
 *
 * assignExistingData: staff added before organisations and properties
 * existed have neither. This gives the (only) admin an organisation with one
 * property, if they have none yet, and puts every such staff member in it.
 * Safe to run again: it only touches records still missing them.
 *
 *   npx convex run migrations:assignExistingData '{"organizationName":"…","propertyName":"…"}'
 */
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { writeAudit } from "./lib/audit";
import { appError } from "./lib/errors";
import {
  adminOrganization,
  internalMutation,
  organizationProperties,
} from "./lib/functions";

export const assignExistingData = internalMutation({
  args: {
    organizationName: v.optional(v.string()),
    propertyName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const admins = await ctx.db
      .query("users")
      .withIndex("by_role", (q) => q.eq("role", "admin"))
      .collect();
    if (admins.length !== 1)
      throw appError(
        "CONFLICT",
        `Expected exactly one admin, found ${admins.length}.`,
      );
    const admin = admins[0];
    const now = Date.now();
    let organization = await adminOrganization(ctx, admin);
    let organizationId: Id<"organizations">;
    let createdOrganization = false;
    if (organization === null) {
      organizationId = await ctx.db.insert("organizations", {
        name: args.organizationName?.trim() || "My organisation",
        status: "active",
        createdBy: admin._id,
        createdAt: now,
      });
      await ctx.db.patch(admin._id, { organizationId });
      organization = (await ctx.db.get(organizationId))!;
      createdOrganization = true;
    } else {
      organizationId = organization._id;
    }
    let propertyId = (await organizationProperties(ctx, organizationId))[0]
      ?._id;
    if (propertyId === undefined) {
      propertyId = await ctx.db.insert("properties", {
        organizationId,
        name: args.propertyName?.trim() || "Main property",
        status: "active",
        createdAt: now,
      });
    }
    let moved = 0;
    for (const staff of await ctx.db.query("staff").collect()) {
      const legacy = staff as {
        organizationId?: Id<"organizations">;
        propertyId?: Id<"properties">;
      };
      if (
        legacy.organizationId !== undefined &&
        legacy.propertyId !== undefined
      )
        continue;
      await ctx.db.patch(staff._id, { organizationId, propertyId });
      await ctx.db.patch(staff.userId, { organizationId });
      moved += 1;
    }
    await writeAudit(ctx, {
      organizationId,
      actorUserId: undefined,
      action: "migration.assigned_existing_data",
      entityType: "organizations",
      entityId: organizationId,
      metadata: { createdOrganization, propertyId, staffMoved: moved },
    });
    return {
      organization: organization.name,
      createdOrganization,
      staffMoved: moved,
    };
  },
});

/**
 * Past payments, bonuses and deductions entered with the earlier "Record a
 * past entry" were payments and adjustments on paydays, so they counted in
 * the balance. Past payments are now records only (pastRecords): this turns
 * each such entry into a record and removes the payment / adjustment. A
 * bonus entered as "already paid" (a bonus plus a payment of the same
 * amount, saved together) becomes one record. Safe to run again; the
 * Vercel build runs it on every deploy.
 */
export const convertPastEntries = internalMutation({
  args: {},
  handler: async (ctx) => {
    const payments = (await ctx.db.query("payments").collect()).filter(
      (p) => p.periodFrom !== undefined,
    );
    const adjustments = (await ctx.db.query("adjustments").collect()).filter(
      (a) => a.periodFrom !== undefined,
    );
    const used = new Set<string>();
    let records = 0;
    const touched = new Map<string, Id<"organizations">>();
    for (const a of adjustments) {
      const staff = await ctx.db.get(a.staffId);
      // A bonus "already paid": the payment saved with it in the same call.
      const paid =
        a.type === "bonus"
          ? payments.find(
              (p) =>
                !used.has(p._id) &&
                p.staffId === a.staffId &&
                p.amount === a.amount &&
                p.periodFrom === a.periodFrom &&
                p.periodTo === a.periodTo &&
                p.recordedAt === a.createdAt,
            )
          : undefined;
      if (paid) used.add(paid._id);
      if (staff) {
        await ctx.db.insert("pastRecords", {
          staffId: a.staffId,
          from: a.periodFrom!,
          to: a.periodTo ?? a.periodFrom!,
          salary: 0,
          bonus: a.type === "bonus" ? a.amount : 0,
          deduction: a.type === "deduction" ? a.amount : 0,
          paidOn: paid?.paidOn,
          mode: paid?.mode,
          note: a.note,
          createdBy: a.createdBy,
          createdAt: a.createdAt,
        });
        touched.set(staff._id, staff.organizationId);
        records += 1;
      }
      if (paid) await ctx.db.delete(paid._id);
      await ctx.db.delete(a._id);
    }
    // Salary payments: one record per entry (the pieces saved in one call, for one period).
    const groups = new Map<string, typeof payments>();
    for (const p of payments) {
      if (used.has(p._id)) continue;
      const key = `${p.staffId}|${p.periodFrom}|${p.periodTo}|${p.recordedAt}`;
      groups.set(key, [...(groups.get(key) ?? []), p]);
    }
    for (const group of groups.values()) {
      const first = group[0];
      const staff = await ctx.db.get(first.staffId);
      if (staff) {
        await ctx.db.insert("pastRecords", {
          staffId: first.staffId,
          from: first.periodFrom!,
          to: first.periodTo ?? first.periodFrom!,
          salary: group.reduce((a, p) => a + p.amount, 0),
          bonus: 0,
          deduction: 0,
          paidOn: first.paidOn,
          mode: first.mode,
          note: group.length === 1 ? first.note : undefined,
          createdBy: first.recordedBy,
          createdAt: first.recordedAt,
        });
        touched.set(staff._id, staff.organizationId);
        records += 1;
      }
      for (const p of group) await ctx.db.delete(p._id);
    }
    for (const [staffId, organizationId] of touched) {
      await writeAudit(ctx, {
        organizationId,
        actorUserId: undefined,
        action: "migration.past_entries_converted",
        entityType: "staff",
        entityId: staffId,
        staffId: staffId as Id<"staff">,
      });
    }
    return { records };
  },
});
