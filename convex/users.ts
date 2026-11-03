import { getAuthSessionId, invalidateSessions, modifyAccountCredentials, retrieveAccount } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { PHONE_PASSWORD_PROVIDER } from "./auth";
import { writeAudit } from "./lib/audit";
import { appError } from "./lib/errors";
import { internalMutation, signedInAction, viewerQuery } from "./lib/functions";
import { passwordProblem } from "./lib/inputRules";

/**
 * What the app needs to decide which screen to show. Returns null when
 * signed out. Only ever describes the caller, and never anything about pay.
 */
export const me = viewerQuery({
  args: {},
  handler: async (ctx) => {
    if (ctx.viewer === null) return null;
    const { userId, user } = ctx.viewer;
    const staff =
      user.role === "staff"
        ? await ctx.db
            .query("staff")
            .withIndex("by_user", (q) => q.eq("userId", userId))
            .unique()
        : null;
    return {
      name: staff?.name ?? user.name ?? null,
      phone: user.phone ?? null,
      role: user.role ?? null,
      mustChangePassword: user.mustChangePassword === true,
      staffStatus: staff?.status ?? null,
    };
  },
});

/**
 * Sets a new password. Needs the current one, except right after an admin
 * created the account or reset it (the temporary password was just used to
 * sign in). Signs out the person's other devices.
 */
export const changePassword = signedInAction({
  args: { currentPassword: v.optional(v.string()), newPassword: v.string() },
  handler: async (ctx, args) => {
    const { userId, phone, mustChangePassword } = ctx.viewer;
    if (!phone) throw appError("INVALID_INPUT", "Your account has no mobile number.");
    if (!mustChangePassword) {
      try {
        await retrieveAccount(ctx, {
          provider: PHONE_PASSWORD_PROVIDER,
          account: { id: phone, secret: args.currentPassword ?? "" },
        });
      } catch {
        throw appError("INVALID_INPUT", "Your current password isn't right.");
      }
    }
    const problem = passwordProblem(args.newPassword, phone);
    if (problem !== null) throw appError("WEAK_PASSWORD", problem);
    if (args.newPassword === args.currentPassword) {
      throw appError("WEAK_PASSWORD", "Choose a password different from the current one.");
    }
    await modifyAccountCredentials(ctx, {
      provider: PHONE_PASSWORD_PROVIDER,
      account: { id: phone, secret: args.newPassword },
    });
    const sessionId = await getAuthSessionId(ctx);
    await invalidateSessions(ctx, { userId, except: sessionId ? [sessionId] : [] });
    await ctx.runMutation(internal.users.recordPasswordChanged, { userId });
    return null;
  },
});

export const recordPasswordChanged = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    if (user?.mustChangePassword) await ctx.db.patch(userId, { mustChangePassword: false });
    await writeAudit(ctx, {
      actorUserId: userId,
      action: "user.password_changed",
      entityType: "users",
      entityId: userId,
    });
    return null;
  },
});
