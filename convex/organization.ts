/**
 * Admin: the organisation and its properties (as in MealSync). An admin
 * creates their organisation once, with its first property, then adds and
 * renames properties in Settings. Every staff member belongs to one property.
 */
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { writeAudit } from "./lib/audit";
import { appError } from "./lib/errors";
import {
  adminMutation,
  adminQuery,
  orgProperty,
  orgSetupMutation,
  orgSetupQuery,
} from "./lib/functions";

export const MAX_NAME_LENGTH = 60;
/** Upper bound on properties per organisation, to keep every screen fast. */
export const MAX_PROPERTIES = 50;

/** A tidy organisation or property name (spaces collapsed), or INVALID_INPUT. */
export function checkName(raw: string, what: string): string {
  const name = raw.trim().replace(/\s+/g, " ");
  if (name.length < 2)
    throw appError("INVALID_INPUT", `${what} needs at least 2 characters.`);
  if (name.length > MAX_NAME_LENGTH)
    throw appError(
      "INVALID_INPUT",
      `${what} can be at most ${MAX_NAME_LENGTH} characters.`,
    );
  return name;
}

async function insertProperty(
  ctx: Pick<MutationCtx, "db">,
  organizationId: Id<"organizations">,
  existing: Doc<"properties">[],
  rawName: string,
  actorUserId: Id<"users">,
): Promise<Id<"properties">> {
  const name = checkName(rawName, "The property name");
  if (existing.length >= MAX_PROPERTIES)
    throw appError(
      "INVALID_INPUT",
      `An organisation can have at most ${MAX_PROPERTIES} properties.`,
    );
  if (existing.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
    throw appError("CONFLICT", "There's already a property with that name.");
  }
  const propertyId = await ctx.db.insert("properties", {
    organizationId,
    name,
    status: "active",
    createdAt: Date.now(),
  });
  await writeAudit(ctx, {
    organizationId,
    actorUserId,
    action: "property.added",
    entityType: "properties",
    entityId: propertyId,
    metadata: { name },
  });
  return propertyId;
}

/** Whether the admin has set up their organisation yet (shown before everything else). */
export const status = orgSetupQuery({
  args: {},
  handler: async (ctx) => ({
    hasOrganization: ctx.admin.organization !== null,
  }),
});

/** Creates the admin's organisation with its first property. Works once per admin. */
export const create = orgSetupMutation({
  args: { name: v.string(), propertyName: v.string() },
  handler: async (ctx, args) => {
    if (ctx.admin.organization !== null)
      throw appError("CONFLICT", "You already have an organisation.");
    const name = checkName(args.name, "The organisation name");
    const { userId } = ctx.admin;
    const organizationId = await ctx.db.insert("organizations", {
      name,
      status: "active",
      createdBy: userId,
      createdAt: Date.now(),
    });
    await ctx.db.patch(userId, { organizationId });
    await writeAudit(ctx, {
      organizationId,
      actorUserId: userId,
      action: "organization.created",
      entityType: "organizations",
      entityId: organizationId,
      metadata: { name },
    });
    const propertyId = await insertProperty(
      ctx,
      organizationId,
      [],
      args.propertyName,
      userId,
    );
    return { organizationId, propertyId };
  },
});

/** The organisation and its properties, with how many current staff each has. */
export const get = adminQuery({
  args: {},
  handler: async (ctx) => {
    const { organization, properties } = ctx.admin;
    return {
      name: organization.name,
      properties: await Promise.all(
        properties.map(async (p) => ({
          propertyId: p._id,
          name: p.name,
          activeStaff: (
            await ctx.db
              .query("staff")
              .withIndex("by_property", (q) => q.eq("propertyId", p._id))
              .collect()
          ).filter((s) => s.status === "active").length,
        })),
      ),
    };
  },
});

export const rename = adminMutation({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const name = checkName(args.name, "The organisation name");
    const { organization, userId } = ctx.admin;
    if (name === organization.name) return null;
    await ctx.db.patch(organization._id, { name });
    await writeAudit(ctx, {
      organizationId: organization._id,
      actorUserId: userId,
      action: "organization.renamed",
      entityType: "organizations",
      entityId: organization._id,
      metadata: { before: organization.name, after: name },
    });
    return null;
  },
});

export const addProperty = adminMutation({
  args: { name: v.string() },
  handler: async (ctx, args) =>
    await insertProperty(
      ctx,
      ctx.admin.organization._id,
      ctx.admin.properties,
      args.name,
      ctx.admin.userId,
    ),
});

export const renameProperty = adminMutation({
  args: { targetPropertyId: v.id("properties"), name: v.string() },
  handler: async (ctx, args) => {
    const property = orgProperty(ctx.admin, args.targetPropertyId);
    const name = checkName(args.name, "The property name");
    if (name === property.name) return null;
    if (
      ctx.admin.properties.some(
        (p) =>
          p._id !== property._id && p.name.toLowerCase() === name.toLowerCase(),
      )
    ) {
      throw appError("CONFLICT", "There's already a property with that name.");
    }
    await ctx.db.patch(property._id, { name });
    await writeAudit(ctx, {
      organizationId: property.organizationId,
      actorUserId: ctx.admin.userId,
      action: "property.renamed",
      entityType: "properties",
      entityId: property._id,
      metadata: { before: property.name, after: name },
    });
    return null;
  },
});
