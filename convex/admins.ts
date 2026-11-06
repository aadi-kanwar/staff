/**
 * Admin: the admins of an organisation (Settings → Admins). Every admin has
 * full access, the same as the first one. An admin adds another with their
 * name and mobile number and gets a temporary password to pass on; the new
 * admin must choose their own at first sign-in. You can't remove yourself,
 * and an organisation always keeps at least one admin. All of it is audited.
 */
import {
  invalidateSessions,
  modifyAccountCredentials,
} from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { PHONE_PASSWORD_PROVIDER } from "./auth";
import { createLogin, temporaryPassword } from "./lib/accounts";
import { writeAudit } from "./lib/audit";
import { appError } from "./lib/errors";
import {
  adminAction,
  adminMutation,
  adminQuery,
  internalMutation,
  internalQuery,
} from "./lib/functions";
import { displayNameSchema, normalizePhone } from "./lib/inputRules";
import { deleteLogin } from "./people";

async function adminsOf(
  ctx: Pick<QueryCtx, "db">,
  organizationId: Id<"organizations">,
): Promise<Doc<"users">[]> {
  return await ctx.db
    .query("users")
    .withIndex("by_org_role", (q) =>
      q.eq("organizationId", organizationId).eq("role", "admin"),
    )
    .collect();
}

/** Another admin of the same organisation, else NOT_FOUND. */
async function loadAdmin(
  ctx: Pick<QueryCtx, "db">,
  organizationId: Id<"organizations">,
  userId: Id<"users">,
) {
  const user = await ctx.db.get(userId);
  if (
    user === null ||
    user.role !== "admin" ||
    user.organizationId !== organizationId
  )
    throw appError("NOT_FOUND");
  return user;
}

/** Everyone who can manage the organisation, you first. */
export const list = adminQuery({
  args: {},
  handler: async (ctx) => {
    const admins = await adminsOf(ctx, ctx.admin.organization._id);
    return admins
      .map((a) => ({
        userId: a._id,
        name: a.name ?? "",
        phone: a.phone ?? "",
        isYou: a._id === ctx.admin.userId,
        mustChangePassword: a.mustChangePassword === true,
        addedAt: a._creationTime,
      }))
      .sort(
        (x, y) =>
          Number(y.isYou) - Number(x.isYou) || x.name.localeCompare(y.name),
      );
  },
});

/**
 * Adds an admin with full access to this organisation. Returns a temporary
 * password, shown once, that they must change at first sign-in.
 */
export const add = adminAction({
  args: { name: v.string(), phone: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{ userId: Id<"users">; temporaryPassword: string }> => {
    const phone = normalizePhone(args.phone);
    if (phone === null) throw appError("INVALID_PHONE");
    const name = displayNameSchema.safeParse(args.name);
    if (!name.success)
      throw appError("INVALID_INPUT", name.error.issues[0]?.message);
    await ctx.runQuery(internal.admins.checkPhoneFree, { phone });
    const password = temporaryPassword();
    let userId: Id<"users">;
    try {
      userId = await createLogin(ctx, phone, password);
    } catch {
      throw appError("CONFLICT", "That mobile number already has an account.");
    }
    try {
      await ctx.runMutation(internal.admins.makeAdmin, {
        userId,
        name: name.data,
        organizationId: ctx.admin.organizationId,
        actorUserId: ctx.admin.userId,
      });
    } catch (error) {
      await ctx.runMutation(internal.people.removeLogin, { userId });
      throw error;
    }
    return { userId, temporaryPassword: password };
  },
});

export const checkPhoneFree = internalQuery({
  args: { phone: v.string() },
  handler: async (ctx, { phone }) => {
    const login = await ctx.db
      .query("users")
      .withIndex("phone", (q) => q.eq("phone", phone))
      .first();
    const staff = await ctx.db
      .query("staff")
      .withIndex("by_phone", (q) => q.eq("phone", phone))
      .first();
    if (login !== null || staff !== null)
      throw appError("CONFLICT", "That mobile number already has an account.");
    return null;
  },
});

export const makeAdmin = internalMutation({
  args: {
    userId: v.id("users"),
    name: v.string(),
    organizationId: v.id("organizations"),
    actorUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.userId, {
      role: "admin",
      name: args.name,
      organizationId: args.organizationId,
      mustChangePassword: true,
    });
    const user = (await ctx.db.get(args.userId))!;
    await writeAudit(ctx, {
      organizationId: args.organizationId,
      actorUserId: args.actorUserId,
      action: "admin.added",
      entityType: "users",
      entityId: args.userId,
      metadata: { name: args.name, phone: user.phone },
    });
    return null;
  },
});

/** Removes another admin: their login is deleted. Not yourself, and never the last admin. */
export const remove = adminMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const organizationId = ctx.admin.organization._id;
    if (userId === ctx.admin.userId)
      throw appError(
        "CONFLICT",
        "You can't remove yourself. Ask another admin.",
      );
    const target = await loadAdmin(ctx, organizationId, userId);
    if ((await adminsOf(ctx, organizationId)).length <= 1)
      throw appError("CONFLICT", "An organisation needs at least one admin.");
    await deleteLogin(ctx, userId);
    await writeAudit(ctx, {
      organizationId,
      actorUserId: ctx.admin.userId,
      action: "admin.removed",
      entityType: "users",
      entityId: userId,
      metadata: { name: target.name, phone: target.phone },
    });
    return null;
  },
});

/** Gives another admin a temporary password (shown once) and signs them out everywhere. */
export const resetPassword = adminAction({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }): Promise<{ temporaryPassword: string }> => {
    if (userId === ctx.admin.userId)
      throw appError(
        "CONFLICT",
        "Use Change my password for your own account.",
      );
    const target = await ctx.runQuery(internal.admins.resetTarget, {
      userId,
      organizationId: ctx.admin.organizationId,
    });
    const password = temporaryPassword();
    await modifyAccountCredentials(ctx, {
      provider: PHONE_PASSWORD_PROVIDER,
      account: { id: target.phone, secret: password },
    });
    await invalidateSessions(ctx, { userId });
    await ctx.runMutation(internal.admins.recordReset, {
      userId,
      organizationId: ctx.admin.organizationId,
      actorUserId: ctx.admin.userId,
    });
    return { temporaryPassword: password };
  },
});

export const resetTarget = internalQuery({
  args: { userId: v.id("users"), organizationId: v.id("organizations") },
  returns: v.object({ phone: v.string() }),
  handler: async (ctx, { userId, organizationId }) => {
    const user = await loadAdmin(ctx, organizationId, userId);
    if (!user.phone) throw appError("NOT_FOUND");
    return { phone: user.phone };
  },
});

export const recordReset = internalMutation({
  args: {
    userId: v.id("users"),
    organizationId: v.id("organizations"),
    actorUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.userId, { mustChangePassword: true });
    await writeAudit(ctx, {
      organizationId: args.organizationId,
      actorUserId: args.actorUserId,
      action: "admin.password_reset",
      entityType: "users",
      entityId: args.userId,
    });
    return null;
  },
});
