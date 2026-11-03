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
