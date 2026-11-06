import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { writeAudit } from "./lib/audit";
import { internalMutation, viewerQuery } from "./lib/functions";
import { SSO_SESSION_MS, SSO_USED_TICKET_RETENTION_MS } from "./lib/ssoTicket";

/**
 * Admin Hub single sign-on: what happens once a ticket's signature has been
 * checked (see convex/lib/ssoTicket.ts and the `hub-sso` provider in
 * convex/auth.ts).
 *
 * The master admin signs in as an `admin` of the organisation. In this app an
 * account is either an admin or a staff member, never both, so a number that
 * belongs to a staff member is refused rather than changed: their own
 * attendance and pay screens are never taken away. Switched-off accounts stay
 * switched off. No other account or record is changed.
 */
export const acceptTicket = internalMutation({
  args: { jti: v.string(), hubAdminId: v.string(), phone: v.string(), name: v.string() },
  returns: v.union(v.null(), v.object({ userId: v.id("users"), sessionId: v.id("authSessions") })),
  handler: async (ctx, { jti, hubAdminId, phone, name }) => {
    const now = Date.now();

    // 1. One use per ticket. Recorded first, so even a refused ticket is spent.
    if (!(await spendJti(ctx, jti, now))) return null;

    // 2. The organisation: the app runs a single one.
    const organization = await ctx.db
      .query("organizations")
      .filter((q) => q.eq(q.field("status"), "active"))
      .order("asc")
      .first();
    if (organization === null) return null;

    // 3. Never touch a staff member's account.
    const staffRecord = await ctx.db
      .query("staff")
      .withIndex("by_phone", (q) => q.eq("phone", phone))
      .first();
    if (staffRecord !== null) return null;

    // 4. The account with this number (made an admin if it isn't one yet), or a new one.
    const existing = await ctx.db
      .query("users")
      .withIndex("phone", (q) => q.eq("phone", phone))
      .first();
    let user: Doc<"users">;
    let accountCreated = false;
    let roleGranted = false;
    if (existing === null) {
      const userId = await ctx.db.insert("users", {
        phone,
        name,
        role: "admin",
        organizationId: organization._id,
      });
      user = (await ctx.db.get(userId))!;
      accountCreated = true;
      roleGranted = true;
    } else {
      user = existing;
      if (user.disabled === true || user.role === "staff") return null;
      if (user.organizationId !== undefined && user.organizationId !== organization._id) return null;
      const changes: Partial<Doc<"users">> = {};
      if (user.role === undefined) {
        changes.role = "admin";
        roleGranted = true;
        if (user.name === undefined) changes.name = name;
      }
      if (user.organizationId === undefined) changes.organizationId = organization._id;
      if (Object.keys(changes).length > 0) await ctx.db.patch(user._id, changes);
    }
    const userId: Id<"users"> = user._id;

    // 5. Mark the account, open a 12-hour login, and record it.
    if (user.ssoManaged !== true) await ctx.db.patch(userId, { ssoManaged: true });
    const sessionId = await ctx.db.insert("authSessions", { userId, expirationTime: now + SSO_SESSION_MS });
    await writeAudit(ctx, {
      organizationId: organization._id,
      actorUserId: userId,
      action: "sso.signed_in",
      entityType: "users",
      entityId: userId,
      metadata: { hubAdminId, accountCreated, roleGranted },
    });
    return { userId, sessionId };
  },
});

/**
 * One use per ticket or revoke request: false if this `jti` was seen before
 * (and records it otherwise).
 */
async function spendJti(ctx: MutationCtx, jti: string, now: number): Promise<boolean> {
  const used = await ctx.db
    .query("ssoUsedTickets")
    .withIndex("by_jti", (q) => q.eq("jti", jti))
    .first();
  if (used !== null) return false;
  await ctx.db.insert("ssoUsedTickets", { jti, usedAt: now });
  return true;
}

/**
 * True for a login opened through the Admin Hub: those are made to last
 * exactly 12 hours (normal logins last far longer).
 */
const isHubSession = (session: Doc<"authSessions">) =>
  Math.abs(session.expirationTime - session._creationTime - SSO_SESSION_MS) <= 60_000;

/**
 * The hub's "Revoke in all apps" for one phone number: ends that account's
 * Admin Hub logins at once, and takes away the admin role if (and only if)
 * the hub gave it. An admin who already had their own account in this app
 * keeps it and can still sign in with their password.
 */
export const revokeAccess = internalMutation({
  args: { jti: v.string(), phone: v.string() },
  returns: v.union(v.null(), v.object({ sessionsEnded: v.number(), adminRemoved: v.boolean() })),
  handler: async (ctx, { jti, phone }) => {
    const now = Date.now();
    if (!(await spendJti(ctx, jti, now))) return null;

    let sessionsEnded = 0;
    let adminRemoved = false;
    const users = await ctx.db.query("users").withIndex("phone", (q) => q.eq("phone", phone)).collect();
    for (const user of users) {
      if (user.ssoManaged !== true) continue;

      for (const session of await ctx.db.query("authSessions").withIndex("userId", (q) => q.eq("userId", user._id)).collect()) {
        if (!isHubSession(session)) continue;
        const tokens = await ctx.db
          .query("authRefreshTokens")
          .withIndex("sessionIdAndParentRefreshTokenId", (q) => q.eq("sessionId", session._id))
          .collect();
        for (const token of tokens) await ctx.db.delete(token._id);
        await ctx.db.delete(session._id);
        sessionsEnded += 1;
      }

      const organizationId =
        user.organizationId ??
        (await ctx.db.query("organizations").filter((q) => q.eq(q.field("status"), "active")).order("asc").first())?._id;
      const grantedByHub =
        organizationId !== undefined &&
        (
          await ctx.db
            .query("auditLog")
            .withIndex("by_org_createdAt", (q) => q.eq("organizationId", organizationId))
            .filter((q) => q.and(q.eq(q.field("action"), "sso.signed_in"), q.eq(q.field("entityId"), user._id)))
            .collect()
        ).some((entry) => (entry.metadata as { roleGranted?: unknown } | undefined)?.roleGranted === true);
      const removeAdmin = grantedByHub && user.role === "admin";
      // Without a role the account can't be used at all (see access.canSignIn).
      await ctx.db.patch(user._id, removeAdmin ? { ssoManaged: false, role: undefined } : { ssoManaged: false });
      if (removeAdmin) adminRemoved = true;
      await writeAudit(ctx, {
        organizationId,
        actorUserId: undefined,
        action: "sso.access_revoked",
        entityType: "users",
        entityId: user._id,
        metadata: { sessionsEnded, adminRemoved: removeAdmin },
      });
    }
    return { sessionsEnded, adminRemoved };
  },
});

/** Scheduled: forgets used tickets older than 10 minutes (they expired long before). */
export const deleteOldTickets = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const cutoff = Date.now() - SSO_USED_TICKET_RETENTION_MS;
    const old = await ctx.db
      .query("ssoUsedTickets")
      .withIndex("by_usedAt", (q) => q.lt("usedAt", cutoff))
      .take(500);
    for (const row of old) await ctx.db.delete(row._id);
    return null;
  },
});

/** The Admin Hub's address, for the "open it again from the Admin Hub" button. Not secret. */
export const hubOrigin = viewerQuery({
  args: {},
  returns: v.union(v.string(), v.null()),
  handler: async () => process.env.HUB_ORIGIN ?? null,
});
