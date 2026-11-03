/**
 * The ONLY place in the backend allowed to use Convex's raw `query`,
 * `mutation`, `action` and internal builders. Every other file builds its
 * functions from the wrappers here, so no function can skip the permission
 * checks. (Enforced by ESLint and by convex/tests/enforcement.test.ts.)
 *
 * Wrappers that browsers can call:
 *   viewerQuery              - signed in or not; ctx.viewer is null when signed out
 *   signedInAction           - any signed-in account (password change)
 *   adminQuery/Mutation/Action - an admin account (ctx.admin)
 *   staffQuery               - a staff member reading THEIR OWN data (ctx.self).
 *                              There are no staff mutations: staff only read.
 *
 * Admins and staff must have changed the temporary password first.
 *
 * Internal wrappers (never callable from a browser; only from other backend
 * functions or the owner via the Convex dashboard / CLI):
 *   internalQuery, internalMutation, internalAction
 *
 * All mutation wrappers make `attendanceLog` and `auditLog` append-only:
 * patch / replace / delete on those tables throws.
 */
import { getAuthSessionId, getAuthUserId } from "@convex-dev/auth/server";
import { makeFunctionReference } from "convex/server";
import { customAction, customCtx, customMutation, customQuery } from "convex-helpers/server/customFunctions";
import { wrapDatabaseWriter } from "convex-helpers/server/rowLevelSecurity";
import type { DataModel, Doc, Id } from "../_generated/dataModel";
import {
  action as rawAction,
  internalAction as rawInternalAction,
  internalMutation as rawInternalMutation,
  internalQuery as rawInternalQuery,
  mutation as rawMutation,
  query as rawQuery,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import { appError } from "./errors";

type ReadCtx = Pick<QueryCtx, "db" | "auth">;

export type SignedInViewer = { userId: Id<"users">; user: Doc<"users"> };

/**
 * The signed-in account, or null. Identity always comes from the session,
 * never from arguments. The session must still exist: a password reset or
 * change deletes other sessions, and their tokens stop working at once.
 */
export async function getViewer(ctx: ReadCtx): Promise<SignedInViewer | null> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) return null;
  const sessionId = await getAuthSessionId(ctx);
  if (sessionId === null || (await ctx.db.get(sessionId)) === null) return null;
  const user = await ctx.db.get(userId);
  if (user === null) return null;
  return { userId, user };
}

export async function requireUser(ctx: ReadCtx): Promise<SignedInViewer> {
  const viewer = await getViewer(ctx);
  if (viewer === null) throw appError("NOT_SIGNED_IN");
  if (viewer.user.disabled) throw appError("ACCOUNT_DISABLED");
  return viewer;
}

export async function requireAdmin(ctx: ReadCtx): Promise<SignedInViewer> {
  const viewer = await requireUser(ctx);
  if (viewer.user.role !== "admin") throw appError("FORBIDDEN");
  if (viewer.user.mustChangePassword) throw appError("PASSWORD_CHANGE_REQUIRED");
  return viewer;
}

export type SelfViewer = SignedInViewer & { staff: Doc<"staff"> };

/** A staff member's own record. Exited staff keep read-only access to their history. */
export async function requireSelf(ctx: ReadCtx): Promise<SelfViewer> {
  const viewer = await requireUser(ctx);
  if (viewer.user.role !== "staff") throw appError("FORBIDDEN");
  if (viewer.user.mustChangePassword) throw appError("PASSWORD_CHANGE_REQUIRED");
  const staff = await ctx.db
    .query("staff")
    .withIndex("by_user", (q) => q.eq("userId", viewer.userId))
    .unique();
  if (staff === null) throw appError("FORBIDDEN");
  return { ...viewer, staff };
}

// ---------------------------------------------------------------------------
// Append-only tables.
// ---------------------------------------------------------------------------

const appendOnlyRules = {
  attendanceLog: { modify: async () => false },
  auditLog: { modify: async () => false },
};

/** Exported for tests; every mutation wrapper below uses it. */
export function guardedDb(ctx: MutationCtx): MutationCtx["db"] {
  return wrapDatabaseWriter<MutationCtx, DataModel>(ctx, ctx.db, appendOnlyRules);
}

// ---------------------------------------------------------------------------
// Public wrappers (callable from the browser).
// ---------------------------------------------------------------------------

export const viewerQuery = customQuery(
  rawQuery,
  customCtx(async (ctx) => ({ viewer: await getViewer(ctx) })),
);

export const adminQuery = customQuery(
  rawQuery,
  customCtx(async (ctx) => ({ admin: await requireAdmin(ctx) })),
);

export const adminMutation = customMutation(
  rawMutation,
  customCtx(async (ctx) => ({ admin: await requireAdmin(ctx), db: guardedDb(ctx) })),
);

/**
 * Staff read their own data only: ctx.self is derived from the session, and
 * no staff function takes a staffId. These return purpose-built summaries,
 * never raw salary documents (see convex/staff.ts).
 */
export const staffQuery = customQuery(
  rawQuery,
  customCtx(async (ctx) => ({ self: await requireSelf(ctx) })),
);

// Actions have no database access, so they check the caller through these
// internal queries (convex/access.ts), which run the same helpers as above.

export type ActionViewer = { userId: Id<"users">; phone: string; mustChangePassword: boolean };
export type ActionAdmin = { userId: Id<"users"> };

const viewerForAction = makeFunctionReference<"query", Record<string, never>, ActionViewer>(
  "access:viewerForAction",
);
const adminForAction = makeFunctionReference<"query", Record<string, never>, ActionAdmin>("access:adminForAction");

export const signedInAction = customAction(
  rawAction,
  customCtx(async (ctx) => ({ viewer: await ctx.runQuery(viewerForAction, {}) })),
);

export const adminAction = customAction(
  rawAction,
  customCtx(async (ctx) => ({ admin: await ctx.runQuery(adminForAction, {}) })),
);

// ---------------------------------------------------------------------------
// Internal wrappers (never callable from the browser).
// ---------------------------------------------------------------------------

export const internalQuery = rawInternalQuery;

export const internalMutation = customMutation(
  rawInternalMutation,
  customCtx(async (ctx) => ({ db: guardedDb(ctx) })),
);

export const internalAction = rawInternalAction;
