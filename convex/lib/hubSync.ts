import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { writeAudit } from "./audit";
import type { HubPerson, HubPropertyRef } from "./ssoTicket";

/**
 * Livoza Hub: the hub owns people, their profile types and properties. This
 * file makes the Staff app match what the hub says ("make it so"), for a
 * sign-in ticket or a sync. Running it twice changes nothing more.
 *
 * Roles the hub gives here (its tools.config.ts): admin and staff.
 * - admin: an admin of the organisation.
 * - staff: a staff account. Pay details (salary, department, joining date)
 *   belong to this app, so a staff member the hub adds has an account but no
 *   staff record until an admin adds them here with the same number; until
 *   then they see "your admin is setting you up". A staff record is moved
 *   to the hub's property if theirs isn't one of the hub's.
 * - no role, or switched off in the hub: the account is switched off and its
 *   logins end. Attendance and pay records are kept.
 */

type Db = Pick<MutationCtx, "db">;

export const APP_ROLES = ["admin", "staff"] as const;
export type AppRole = (typeof APP_ROLES)[number];

export function asAppRole(role: string | null): AppRole | null {
  return (APP_ROLES as readonly string[]).includes(role ?? "") ? (role as AppRole) : null;
}

/** The app's organisation: the oldest active one (made if there's none yet). */
export async function theOrganization(ctx: Db, name = "Livoza"): Promise<Doc<"organizations">> {
  const existing = await ctx.db
    .query("organizations")
    .filter((q) => q.eq(q.field("status"), "active"))
    .order("asc")
    .first();
  if (existing !== null) return existing;
  const id = await ctx.db.insert("organizations", { name, status: "active", createdAt: Date.now() });
  return (await ctx.db.get(id))!;
}

/**
 * The property for a hub property: already linked, or the row the hub's
 * import matched (`toolPropertyId`), or an unlinked one with the same name,
 * or a new one. Keeps its name the same as the hub's.
 */
export async function ensureHubProperty(
  ctx: Db,
  ref: HubPropertyRef,
  options: { toolPropertyId?: string | null; organizationName?: string } = {},
): Promise<Doc<"properties">> {
  let property = await ctx.db
    .query("properties")
    .withIndex("by_hubPropertyId", (q) => q.eq("hubPropertyId", ref.id))
    .first();
  if (property === null && options.toolPropertyId) {
    const id = ctx.db.normalizeId("properties", options.toolPropertyId);
    const row = id ? await ctx.db.get(id) : null;
    if (row !== null && row.hubPropertyId === undefined) property = row;
  }
  const organizationId = property?.organizationId ?? (await theOrganization(ctx, options.organizationName))._id;
  const siblings = await ctx.db
    .query("properties")
    .withIndex("by_org_status", (q) => q.eq("organizationId", organizationId).eq("status", "active"))
    .collect();
  if (property === null) {
    property =
      siblings.find((p) => p.hubPropertyId === undefined && p.name.trim().toLowerCase() === ref.name.trim().toLowerCase()) ??
      null;
  }
  if (property === null) {
    const id = await ctx.db.insert("properties", {
      organizationId,
      name: ref.name,
      status: "active",
      createdAt: Date.now(),
      hubPropertyId: ref.id,
    });
    property = (await ctx.db.get(id))!;
  }
  const patch: Partial<Doc<"properties">> = {};
  if (property.hubPropertyId !== ref.id) patch.hubPropertyId = ref.id;
  if (
    ref.name.length > 0 &&
    property.name !== ref.name &&
    !siblings.some((p) => p._id !== property!._id && p.name.toLowerCase() === ref.name.toLowerCase())
  ) {
    patch.name = ref.name;
  }
  if (Object.keys(patch).length > 0) {
    await ctx.db.patch(property._id, patch);
    if (patch.hubPropertyId) {
      await writeAudit(ctx, {
        organizationId,
        actorUserId: undefined,
        action: "hub.property_linked",
        entityType: "properties",
        entityId: property._id,
        metadata: { hubPropertyId: ref.id },
      });
    }
  }
  return (await ctx.db.get(property._id))!;
}

/** The account for a hub person: by hub id, then by phone. */
async function findUser(ctx: Db, person: Pick<HubPerson, "hubUserId" | "phone">): Promise<Doc<"users"> | null> {
  const byHub = await ctx.db
    .query("users")
    .withIndex("by_hubUserId", (q) => q.eq("hubUserId", person.hubUserId))
    .first();
  if (byHub !== null) return byHub;
  return await ctx.db
    .query("users")
    .withIndex("phone", (q) => q.eq("phone", person.phone))
    .first();
}

/** Ends every login of this account (and its refresh tokens). */
export async function endSessions(ctx: Db, userId: Id<"users">): Promise<number> {
  const sessions = await ctx.db
    .query("authSessions")
    .withIndex("userId", (q) => q.eq("userId", userId))
    .collect();
  for (const session of sessions) {
    const tokens = await ctx.db
      .query("authRefreshTokens")
      .withIndex("sessionIdAndParentRefreshTokenId", (q) => q.eq("sessionId", session._id))
      .collect();
    for (const token of tokens) await ctx.db.delete(token._id);
    await ctx.db.delete(session._id);
  }
  return sessions.length;
}

/**
 * Makes the app match the hub for one person. Returns their account, or null
 * when they have no account here and no access (nothing to do).
 */
export async function applyHubPerson(
  ctx: Db,
  person: HubPerson,
  options: { active: boolean; revoke: boolean },
): Promise<Id<"users"> | null> {
  const role = options.active ? asAppRole(person.role) : null;
  let user = await findUser(ctx, person);
  if (user === null && role === null) return null;

  const properties: Doc<"properties">[] = [];
  for (const ref of person.properties === "all" ? [] : person.properties) {
    properties.push(await ensureHubProperty(ctx, ref));
  }
  const organizationId = properties[0]?.organizationId ?? (await theOrganization(ctx))._id;

  if (user === null) {
    const id = await ctx.db.insert("users", { phone: person.phone, name: person.name });
    user = (await ctx.db.get(id))!;
  }
  const userId = user._id;
  const staffRecord = await ctx.db
    .query("staff")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();

  const changes: Partial<Doc<"users">> = {
    hubUserId: person.hubUserId,
    ssoManaged: true,
    name: person.name,
    mustChangePassword: undefined,
  };
  if (role === null) {
    changes.disabled = true;
  } else {
    changes.disabled = undefined;
    changes.role = role;
    changes.organizationId = user.organizationId ?? organizationId;
  }
  await ctx.db.patch(userId, changes);

  // A staff record follows the hub's property and name.
  if (staffRecord !== null && role === "staff") {
    const staffChanges: Partial<Doc<"staff">> = {};
    if (staffRecord.name !== person.name) staffChanges.name = person.name;
    if (properties.length > 0 && !properties.some((p) => p._id === staffRecord.propertyId)) {
      staffChanges.propertyId = properties[0]._id;
      staffChanges.organizationId = properties[0].organizationId;
    }
    if (Object.keys(staffChanges).length > 0) await ctx.db.patch(staffRecord._id, staffChanges);
  }

  let sessionsEnded = 0;
  if (options.revoke || role === null) sessionsEnded = await endSessions(ctx, userId);
  await writeAudit(ctx, {
    organizationId,
    actorUserId: undefined,
    action: "hub.person_synced",
    entityType: "users",
    entityId: userId,
    metadata: { hubUserId: person.hubUserId, role, sessionsEnded },
  });
  return userId;
}

/**
 * Everyone and every property, for the hub's one-time import: admins, and
 * staff members who are still working here. Password hashes go only to the
 * hub (which uses the same hashing).
 */
export async function exportForHub(ctx: Pick<QueryCtx, "db">) {
  const properties = (await ctx.db.query("properties").collect())
    .filter((p) => p.status === "active")
    .map((p) => ({ toolPropertyId: p._id as string, name: p.name, hubPropertyId: p.hubPropertyId ?? null }));
  const people = [];
  for (const user of await ctx.db.query("users").collect()) {
    if (!user.phone || user.disabled === true) continue;
    let hubType: "admin" | "staff" | null = null;
    let toolPropertyIds: string[] = [];
    let name = user.name ?? "";
    if (user.role === "admin") hubType = "admin";
    else if (user.role === "staff") {
      const record = await ctx.db
        .query("staff")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .unique();
      if (record === null || record.status === "exited") continue;
      hubType = "staff";
      toolPropertyIds = [record.propertyId as string];
      name = record.name;
    }
    if (hubType === null) continue;
    const account = await ctx.db
      .query("authAccounts")
      .withIndex("providerAndAccountId", (q) => q.eq("provider", "phone-password").eq("providerAccountId", user.phone!))
      .first();
    people.push({
      phone: user.phone,
      name,
      hubType,
      toolPropertyIds,
      active: true,
      passwordHash: account?.secret ?? null,
      roomNumber: null,
    });
  }
  return { properties, people };
}
