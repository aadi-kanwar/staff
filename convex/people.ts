/**
 * Admin: staff records, salary terms, exits and the Joining Reserve.
 * Every function here is admin-only (adminQuery / adminMutation / adminAction).
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
import {
  addRealDays,
  indexOnOrBefore,
  joinIndexFromRealDate,
  toRealDate,
} from "./lib/companyCalendar";
import { appError } from "./lib/errors";
import {
  adminAction,
  adminMutation,
  adminQuery,
  internalMutation,
  internalQuery,
  orgProperty,
} from "./lib/functions";
import {
  departmentSchema,
  displayNameSchema,
  isoDateSchema,
  normalizePhone,
  noteSchema,
  passwordProblem,
  amountSchema,
  salarySchema,
} from "./lib/inputRules";
import {
  PAY_MODE_LABELS,
  computeSchedule,
  finalKey,
  isValidRevisionStart,
  revisionStarts,
  sortTerms,
  type PayMode,
  type Schedule,
} from "./lib/payroll";
import { paydayRow } from "./lib/adminViews";
import { recordSettlement } from "./lib/settlement";
import {
  allStaff,
  engineInputFor,
  loadStaff,
  scheduleFor,
  termsOf,
} from "./lib/staffData";
import { todayInIndia } from "./lib/time";
import { vAdjustmentType, vPayMode, vReserveStatus } from "./lib/validators";

function check<T>(
  result:
    | { success: true; data: T }
    | { success: false; error: { issues: { message: string }[] } },
): T {
  if (!result.success)
    throw appError("INVALID_INPUT", result.error.issues[0]?.message);
  return result.data;
}

function currentTerms(terms: Doc<"salaryTerms">[], todayIndex: number) {
  const sorted = [...terms].sort(
    (a, b) => a.effectiveFromIndex - b.effectiveFromIndex,
  );
  return (
    sorted.filter((t) => t.effectiveFromIndex <= todayIndex).at(-1) ?? sorted[0]
  );
}

/** Staff list with search-friendly fields and pay at a glance. */
export const list = adminQuery({
  args: {},
  handler: async (ctx) => {
    const today = todayInIndia();
    const todayIndex = indexOnOrBefore(today);
    const names = new Map(
      ctx.admin.properties.map((p) => [p._id as string, p.name]),
    );
    const propertyName = (id: Id<"properties">) => names.get(id) ?? "";
    const rows = await Promise.all(
      (await allStaff(ctx, ctx.admin)).map(async (staff) => {
        const schedule = await scheduleFor(ctx, staff, today, 1);
        const terms = currentTerms(await termsOf(ctx, staff._id), todayIndex);
        const user = await ctx.db.get(staff.userId);
        return {
          staffId: staff._id,
          name: staff.name,
          phone: staff.phone,
          department: staff.department,
          propertyId: staff.propertyId,
          propertyName: propertyName(staff.propertyId),
          status: staff.status,
          joinDate: staff.joinDate,
          lastWorkingDay: staff.lastWorkingDay ?? null,
          monthlySalary: terms.monthlySalary,
          payMode: terms.payMode,
          payModeLabel: PAY_MODE_LABELS[terms.payMode],
          pending: schedule.pending,
          next: schedule.next && {
            date: schedule.next.dueDate,
            net: schedule.next.net,
          },
          reserve: {
            amount: schedule.reserve.amount,
            status: staff.reserveStatus,
          },
          mustChangePassword: user?.mustChangePassword === true,
        };
      }),
    );
    return rows;
  },
});

/** Pay modes with their admin-only labels (kept on the server so the website code never contains them). */
export const payModes = adminQuery({
  args: {},
  handler: async () =>
    (Object.keys(PAY_MODE_LABELS) as PayMode[]).map((value) => ({
      value,
      label: PAY_MODE_LABELS[value],
    })),
});

export const departments = adminQuery({
  args: {},
  handler: async (ctx) =>
    [
      ...new Set((await allStaff(ctx, ctx.admin)).map((s) => s.department)),
    ].sort(),
});

/** Everything on one staff member's detail screen. */
export const get = adminQuery({
  args: { staffId: v.id("staff") },
  handler: async (ctx, { staffId }) => {
    const staff = await loadStaff(ctx, ctx.admin, staffId);
    const today = todayInIndia();
    const todayIndex = indexOnOrBefore(today);
    const input = await engineInputFor(ctx, staff, today);
    const schedule = computeSchedule(input);
    const termRows = sortTerms(input.terms);
    const termDocs = (await termsOf(ctx, staffId)).sort(
      (a, b) => a.effectiveFromIndex - b.effectiveFromIndex,
    );
    const current = currentTerms(termDocs, todayIndex);
    const user = await ctx.db.get(staff.userId);
    const adjustments = await ctx.db
      .query("adjustments")
      .withIndex("by_staff", (q) => q.eq("staffId", staffId))
      .collect();
    const payments = await ctx.db
      .query("payments")
      .withIndex("by_staff", (q) => q.eq("staffId", staffId))
      .collect();
    const paydayDates = new Map(
      schedule.paydays.map((p) => [p.key, p.dueDate]),
    );
    if (schedule.settlement)
      paydayDates.set(schedule.settlement.key, schedule.settlement.dueDate);
    const editable = staff.status === "active";

    return {
      profile: {
        staffId: staff._id,
        name: staff.name,
        phone: staff.phone,
        department: staff.department,
        propertyId: staff.propertyId,
        propertyName:
          ctx.admin.properties.find((p) => p._id === staff.propertyId)?.name ??
          "",
        joinDate: staff.joinDate,
        status: staff.status,
        lastWorkingDay: staff.lastWorkingDay ?? null,
        attendanceFrom: staff.attendanceFrom,
        reserveStatus: staff.reserveStatus,
        reserveForfeitReason: staff.reserveForfeitReason ?? null,
        mustChangePassword: user?.mustChangePassword === true,
        exitedAt: staff.exitedAt ?? null,
      },
      today,
      terms: termDocs.map((t, i) => ({
        termsId: t._id,
        effectiveFromIndex: t.effectiveFromIndex,
        effectiveFromDate: toRealDate(t.effectiveFromIndex),
        monthlySalary: t.monthlySalary,
        payMode: t.payMode,
        payModeLabel: PAY_MODE_LABELS[t.payMode],
        isCurrent: t._id === current._id,
        isFuture: t.effectiveFromIndex > todayIndex,
        canCancel: editable && i > 0 && t.effectiveFromIndex > todayIndex,
        createdAt: t.createdAt,
      })),
      current: {
        monthlySalary: current.monthlySalary,
        payMode: current.payMode,
        payModeLabel: PAY_MODE_LABELS[current.payMode],
      },
      revisionOptions:
        editable && staff.lastWorkingDay === undefined
          ? revisionStarts(
              { joinDate: staff.joinDate, terms: termRows, today },
              6,
            ).map((index) => ({
              index,
              date: toRealDate(index),
            }))
          : [],
      schedule: {
        reserve: schedule.reserve,
        pending: schedule.pending,
        next: schedule.next && paydayRow(staff, schedule.next, today),
        settlement: schedule.settlement,
        unsettledAdjustments: schedule.unsettledAdjustments,
        paydays: schedule.paydays.map((p) => paydayRow(staff, p, today)),
      },
      adjustments: adjustments
        .map((a) => ({
          ...a,
          paydayDate: paydayDates.get(a.paydayKey) ?? null,
        }))
        .sort(
          (a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt,
        ),
      payments: payments
        .map((p) => ({
          ...p,
          paydayDate: paydayDates.get(p.paydayKey) ?? null,
          isFinal: p.paydayKey === finalKey(staffId),
        }))
        .sort(
          (a, b) =>
            b.paidOn.localeCompare(a.paidOn) || b.recordedAt - a.recordedAt,
        ),
      /** Paydays an adjustment can settle against: not yet fully paid. */
      adjustmentTargets: [
        ...schedule.paydays
          .filter((p) => p.status !== "paid")
          .map((p) => ({
            key: p.key,
            date: p.dueDate,
            status: p.status,
            label: p.isFinal ? "Final cycle" : null,
          })),
        ...(schedule.settlement
          ? [
              {
                key: schedule.settlement.key,
                date: schedule.settlement.dueDate,
                status: "due",
                label: "Final settlement",
              },
            ]
          : []),
      ],
      defaultAdjustmentTarget:
        schedule.paydays.find((p) => p.status !== "paid" && p.dueDate >= today)
          ?.key ??
        schedule.paydays.find((p) => p.status !== "paid")?.key ??
        schedule.settlement?.key ??
        null,
    };
  },
});

/** For the add-staff form: paydays already due, to choose "Paid up to". */
export const previewOpening = adminQuery({
  args: { joinDate: v.string(), monthlySalary: v.number(), payMode: vPayMode },
  handler: async (_ctx, args) => {
    if (
      !isoDateSchema.safeParse(args.joinDate).success ||
      !(args.monthlySalary > 0)
    )
      return [];
    const today = todayInIndia();
    const schedule = computeSchedule({
      staffId: "new",
      joinDate: args.joinDate,
      terms: [
        {
          effectiveFromIndex: joinIndexFromRealDate(args.joinDate),
          monthlySalary: args.monthlySalary,
          payMode: args.payMode,
        },
      ],
      attendance: {},
      adjustments: [],
      payments: [],
      today,
      reserveStatus: "held",
      upcoming: 1,
    });
    return {
      reserveAmount: schedule.reserve.amount,
      past: schedule.paydays
        .filter((p) => p.dueDate <= today)
        .map((p) => ({
          paydayIndex: p.paydayIndex,
          date: p.dueDate,
          net: p.net,
        }))
        .reverse(),
      next: schedule.next && {
        date: schedule.next.dueDate,
        net: schedule.next.net,
      },
    };
  },
});

const vOpening = v.object({
  type: vAdjustmentType,
  amount: v.number(),
  note: v.string(),
});

const newStaffArgs = {
  /** The property they work at (one of the admin's organisation). */
  propertyId: v.id("properties"),
  name: v.string(),
  phone: v.string(),
  department: v.string(),
  joinDate: v.string(),
  monthlySalary: v.number(),
  payMode: vPayMode,
  /** The last payday already settled outside the app (its company-day index), if any. */
  paidUpToIndex: v.optional(v.number()),
  reserveStatus: vReserveStatus,
  reserveForfeitReason: v.optional(v.string()),
  opening: v.optional(vOpening),
};

/**
 * Creates a staff member's login (mobile + initial password; they must
 * change it at first sign-in) and their record.
 */
export const create = adminAction({
  args: { ...newStaffArgs, initialPassword: v.string() },
  handler: async (ctx, args): Promise<{ staffId: Id<"staff"> }> => {
    const phone = normalizePhone(args.phone);
    if (phone === null) throw appError("INVALID_PHONE");
    const problem = passwordProblem(args.initialPassword, phone);
    if (problem !== null) throw appError("WEAK_PASSWORD", problem);
    const { initialPassword, ...details } = args;
    const organizationId = ctx.admin.organizationId;
    await ctx.runQuery(internal.people.checkNewStaff, {
      ...details,
      phone,
      organizationId,
    });
    let userId: Id<"users">;
    try {
      userId = await createLogin(ctx, phone, initialPassword);
    } catch {
      throw appError("CONFLICT", "That mobile number already has an account.");
    }
    try {
      const staffId: Id<"staff"> = await ctx.runMutation(
        internal.people.insertStaff,
        {
          ...details,
          phone,
          organizationId,
          userId,
          createdBy: ctx.admin.userId,
        },
      );
      return { staffId };
    } catch (error) {
      await ctx.runMutation(internal.people.removeLogin, { userId });
      throw error;
    }
  },
});

type NewStaff = {
  organizationId: Id<"organizations">;
  propertyId: Id<"properties">;
  name: string;
  phone: string;
  department: string;
  joinDate: string;
  monthlySalary: number;
  payMode: PayMode;
  paidUpToIndex?: number;
  reserveStatus: Doc<"staff">["reserveStatus"];
  reserveForfeitReason?: string;
  opening?: { type: Doc<"adjustments">["type"]; amount: number; note: string };
};

/** Validates a new staff member; returns the opening schedule (before any attendance). */
async function validateNewStaff(
  ctx: Pick<QueryCtx, "db">,
  args: NewStaff,
  today: string,
  ownLogin?: Id<"users">,
) {
  await requireOpenProperty(ctx, args.organizationId, args.propertyId);
  const name = check(displayNameSchema.safeParse(args.name));
  const department = check(departmentSchema.safeParse(args.department));
  const joinDate = check(isoDateSchema.safeParse(args.joinDate));
  if (joinDate > addRealDays(today, 60))
    throw appError(
      "INVALID_DATE",
      "The joining date can be at most 60 days ahead.",
    );
  const monthlySalary = check(salarySchema.safeParse(args.monthlySalary));
  if (
    args.reserveStatus === "forfeited" &&
    !args.reserveForfeitReason?.trim()
  ) {
    throw appError(
      "INVALID_INPUT",
      "Give a reason for forfeiting the Joining Reserve.",
    );
  }
  const existing = await ctx.db
    .query("staff")
    .withIndex("by_phone", (q) => q.eq("phone", args.phone))
    .first();
  const login = await ctx.db
    .query("users")
    .withIndex("phone", (q) => q.eq("phone", args.phone))
    .first();
  if (existing !== null || (login !== null && login._id !== ownLogin))
    throw appError("CONFLICT", "That mobile number already has an account.");
  const schedule = computeSchedule({
    staffId: "new",
    joinDate,
    terms: [
      {
        effectiveFromIndex: joinIndexFromRealDate(joinDate),
        monthlySalary,
        payMode: args.payMode,
      },
    ],
    attendance: {},
    adjustments: [],
    payments: [],
    today,
    reserveStatus: args.reserveStatus,
    upcoming: 1,
  });
  if (args.paidUpToIndex !== undefined) {
    const payday = schedule.paydays.find(
      (p) => p.paydayIndex === args.paidUpToIndex,
    );
    if (!payday || payday.dueDate > today)
      throw appError(
        "INVALID_INPUT",
        "Choose a payday that has already passed.",
      );
  }
  if (args.opening) {
    check(amountSchema.safeParse(args.opening.amount));
    check(
      noteSchema
        .min(1, "Add a note for the opening balance.")
        .safeParse(args.opening.note),
    );
  }
  return { name, department, joinDate, monthlySalary };
}

/** The property must be an active one of the organisation. */
async function requireOpenProperty(
  ctx: Pick<QueryCtx, "db">,
  organizationId: Id<"organizations">,
  propertyId: Id<"properties">,
) {
  const property = await ctx.db.get(propertyId);
  if (
    property === null ||
    property.organizationId !== organizationId ||
    property.status !== "active"
  ) {
    throw appError("INVALID_INPUT", "Choose the property they work at.");
  }
  return property;
}

export const checkNewStaff = internalQuery({
  args: { ...newStaffArgs, organizationId: v.id("organizations") },
  handler: async (ctx, args) => {
    await validateNewStaff(ctx, args, todayInIndia());
    return null;
  },
});

/** Inserts the staff record, terms, opening payments and opening balance. Used by `create` and the seed. */
export const insertStaff = internalMutation({
  args: {
    ...newStaffArgs,
    organizationId: v.id("organizations"),
    userId: v.id("users"),
    createdBy: v.optional(v.id("users")),
    /** Seed only: pretend "today" (and attendance tracking start) is this date. */
    asOf: v.optional(v.string()),
    mustChangePassword: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<Id<"staff">> => {
    const today = args.asOf ?? todayInIndia();
    const valid = await validateNewStaff(ctx, args, today, args.userId);
    const now = Date.now();
    await ctx.db.patch(args.userId, {
      role: "staff",
      organizationId: args.organizationId,
      name: valid.name,
      mustChangePassword: args.mustChangePassword ?? true,
    });
    const staffId = await ctx.db.insert("staff", {
      organizationId: args.organizationId,
      propertyId: args.propertyId,
      userId: args.userId,
      name: valid.name,
      phone: args.phone,
      department: valid.department,
      joinDate: valid.joinDate,
      status: "active",
      reserveStatus: args.reserveStatus,
      reserveForfeitReason:
        args.reserveStatus === "forfeited"
          ? args.reserveForfeitReason?.trim()
          : undefined,
      attendanceFrom: today,
      createdAt: now,
      createdBy: args.createdBy,
    });
    await ctx.db.insert("salaryTerms", {
      staffId,
      effectiveFromIndex: joinIndexFromRealDate(valid.joinDate),
      monthlySalary: valid.monthlySalary,
      payMode: args.payMode,
      createdBy: args.createdBy,
      createdAt: now,
    });
    const staff = (await ctx.db.get(staffId))!;
    const schedule = await scheduleFor(ctx, staff, today);
    let openingPaid = 0;
    if (args.paidUpToIndex !== undefined) {
      for (const payday of schedule.paydays.filter(
        (p) => p.paydayIndex <= args.paidUpToIndex!,
      )) {
        if (payday.net <= 0) continue;
        await ctx.db.insert("payments", {
          staffId,
          paydayKey: payday.key,
          amount: payday.net,
          paidOn: payday.dueDate,
          mode: "opening",
          note: "Settled before the app was used",
          recordedBy: args.createdBy,
          recordedAt: now,
        });
        openingPaid += 1;
      }
    }
    if (args.opening) {
      const target =
        schedule.paydays.find(
          (p) =>
            args.paidUpToIndex === undefined ||
            p.paydayIndex > args.paidUpToIndex,
        ) ?? schedule.paydays.at(-1)!;
      await ctx.db.insert("adjustments", {
        staffId,
        type: args.opening.type,
        amount: args.opening.amount,
        note: args.opening.note.trim(),
        date: today,
        paydayKey: target.key,
        createdBy: args.createdBy,
        createdAt: now,
      });
    }
    await writeAudit(ctx, {
      organizationId: staff.organizationId,
      actorUserId: args.createdBy,
      action: "staff.created",
      entityType: "staff",
      entityId: staffId,
      staffId,
      metadata: {
        joinDate: valid.joinDate,
        monthlySalary: valid.monthlySalary,
        payMode: args.payMode,
        openingPaydaysPaid: openingPaid,
        reserveStatus: args.reserveStatus,
        propertyId: args.propertyId,
      },
    });
    return staffId;
  },
});

/** Undoes a login whose staff record couldn't be saved. */
export const removeLogin = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    for (const account of await ctx.db
      .query("authAccounts")
      .withIndex("userIdAndProvider", (q) => q.eq("userId", userId))
      .collect()) {
      await ctx.db.delete(account._id);
    }
    const user = await ctx.db.get(userId);
    if (user !== null && user.role === undefined) await ctx.db.delete(userId);
    return null;
  },
});

export const updateProfile = adminMutation({
  args: {
    staffId: v.id("staff"),
    name: v.string(),
    department: v.string(),
    /** Moves them to another property of the organisation. Omit to keep it. */
    staffPropertyId: v.optional(v.id("properties")),
  },
  handler: async (ctx, args) => {
    const staff = await loadStaff(ctx, ctx.admin, args.staffId);
    const name = check(displayNameSchema.safeParse(args.name));
    const department = check(departmentSchema.safeParse(args.department));
    const propertyId =
      args.staffPropertyId === undefined
        ? staff.propertyId
        : orgProperty(ctx.admin, args.staffPropertyId)._id;
    if (propertyId !== staff.propertyId) requireEditable(staff);
    if (
      name === staff.name &&
      department === staff.department &&
      propertyId === staff.propertyId
    )
      return null;
    await ctx.db.patch(staff._id, { name, department, propertyId });
    await ctx.db.patch(staff.userId, { name });
    await writeAudit(ctx, {
      organizationId: staff.organizationId,
      actorUserId: ctx.admin.userId,
      action: "staff.updated",
      entityType: "staff",
      entityId: staff._id,
      staffId: staff._id,
      metadata: {
        before: {
          name: staff.name,
          department: staff.department,
          propertyId: staff.propertyId,
        },
        after: { name, department, propertyId },
      },
    });
    return null;
  },
});

function requireEditable(staff: Doc<"staff">) {
  if (staff.status !== "active")
    throw appError(
      "CONFLICT",
      "This person has left. Their record can't be changed.",
    );
}

/** Payments already recorded for paydays whose cycle starts on or after `fromIndex`. */
function paymentsFrom(schedule: Schedule, fromIndex: number) {
  return schedule.paydays.filter(
    (p) => p.cycleStartIndex >= fromIndex && p.paid > 0,
  );
}

/** A salary revision or pay-mode change, from the first day of a cycle. */
export const reviseTerms = adminMutation({
  args: {
    staffId: v.id("staff"),
    effectiveFromIndex: v.number(),
    monthlySalary: v.number(),
    payMode: vPayMode,
  },
  handler: async (ctx, args) => {
    const staff = await loadStaff(ctx, ctx.admin, args.staffId);
    requireEditable(staff);
    if (staff.lastWorkingDay !== undefined)
      throw appError(
        "CONFLICT",
        "A last working day is set. Cancel it to revise the salary.",
      );
    const monthlySalary = check(salarySchema.safeParse(args.monthlySalary));
    const today = todayInIndia();
    const input = await engineInputFor(ctx, staff, today);
    if (
      !isValidRevisionStart(
        { joinDate: staff.joinDate, terms: input.terms, today },
        args.effectiveFromIndex,
      )
    ) {
      throw appError(
        "INVALID_DATE",
        "Changes can only start on the first day of a pay cycle, from today on.",
      );
    }
    if (
      paymentsFrom(computeSchedule(input), args.effectiveFromIndex).length > 0
    ) {
      throw appError(
        "CONFLICT",
        "Payments are already recorded for a payday after that date.",
      );
    }
    const previous = sortTerms(input.terms).at(-1)!;
    if (
      previous.monthlySalary === monthlySalary &&
      previous.payMode === args.payMode
    ) {
      throw appError(
        "INVALID_INPUT",
        "That's the same salary and pay mode as now.",
      );
    }
    const termsId = await ctx.db.insert("salaryTerms", {
      staffId: staff._id,
      effectiveFromIndex: args.effectiveFromIndex,
      monthlySalary,
      payMode: args.payMode,
      createdBy: ctx.admin.userId,
      createdAt: Date.now(),
    });
    await writeAudit(ctx, {
      organizationId: staff.organizationId,
      actorUserId: ctx.admin.userId,
      action:
        previous.payMode !== args.payMode
          ? "salary.mode_changed"
          : "salary.revised",
      entityType: "salaryTerms",
      entityId: termsId,
      staffId: staff._id,
      metadata: {
        effectiveFrom: toRealDate(args.effectiveFromIndex),
        before: {
          monthlySalary: previous.monthlySalary,
          payMode: previous.payMode,
        },
        after: { monthlySalary, payMode: args.payMode },
      },
    });
    return null;
  },
});

/** Cancels a revision that hasn't started yet. */
export const cancelRevision = adminMutation({
  args: { termsId: v.id("salaryTerms") },
  handler: async (ctx, { termsId }) => {
    const terms = await ctx.db.get(termsId);
    if (terms === null) throw appError("NOT_FOUND");
    const staff = await loadStaff(ctx, ctx.admin, terms.staffId);
    requireEditable(staff);
    const all = (await termsOf(ctx, staff._id)).sort(
      (a, b) => a.effectiveFromIndex - b.effectiveFromIndex,
    );
    const today = todayInIndia();
    if (
      all[0]._id === termsId ||
      terms.effectiveFromIndex <= indexOnOrBefore(today)
    ) {
      throw appError(
        "CONFLICT",
        "Only a revision that hasn't started yet can be cancelled.",
      );
    }
    if (
      paymentsFrom(
        await scheduleFor(ctx, staff, today),
        terms.effectiveFromIndex,
      ).length > 0
    ) {
      throw appError(
        "CONFLICT",
        "Payments are already recorded for a payday after that date.",
      );
    }
    await ctx.db.delete(termsId);
    await writeAudit(ctx, {
      organizationId: staff.organizationId,
      actorUserId: ctx.admin.userId,
      action: "salary.revision_cancelled",
      entityType: "salaryTerms",
      entityId: termsId,
      staffId: staff._id,
      metadata: {
        effectiveFrom: toRealDate(terms.effectiveFromIndex),
        monthlySalary: terms.monthlySalary,
        payMode: terms.payMode,
      },
    });
    return null;
  },
});

export const setLastWorkingDay = adminMutation({
  args: { staffId: v.id("staff"), lastWorkingDay: v.string() },
  handler: async (ctx, args) => {
    const staff = await loadStaff(ctx, ctx.admin, args.staffId);
    requireEditable(staff);
    const date = check(isoDateSchema.safeParse(args.lastWorkingDay));
    const today = todayInIndia();
    if (date < staff.joinDate)
      throw appError(
        "INVALID_DATE",
        "The last working day can't be before the joining date.",
      );
    if (date > addRealDays(today, 90))
      throw appError(
        "INVALID_DATE",
        "The last working day can be at most 90 days ahead.",
      );
    const input = await engineInputFor(
      ctx,
      { ...staff, lastWorkingDay: date },
      today,
    );
    const schedule = computeSchedule(input);
    const keys = new Set([
      ...schedule.paydays.map((p) => p.key),
      finalKey(staff._id),
    ]);
    if (input.payments.some((p) => !keys.has(p.paydayKey))) {
      throw appError(
        "CONFLICT",
        "Payments are already recorded for a payday after that date.",
      );
    }
    await ctx.db.patch(staff._id, { lastWorkingDay: date });
    await writeAudit(ctx, {
      organizationId: staff.organizationId,
      actorUserId: ctx.admin.userId,
      action: "exit.last_day_set",
      entityType: "staff",
      entityId: staff._id,
      staffId: staff._id,
      metadata: {
        lastWorkingDay: date,
        previous: staff.lastWorkingDay ?? null,
      },
    });
    return null;
  },
});

export const cancelExit = adminMutation({
  args: { staffId: v.id("staff") },
  handler: async (ctx, { staffId }) => {
    const staff = await loadStaff(ctx, ctx.admin, staffId);
    requireEditable(staff);
    if (staff.lastWorkingDay === undefined)
      throw appError("CONFLICT", "No last working day is set.");
    const settlementPayments = await ctx.db
      .query("payments")
      .withIndex("by_payday", (q) => q.eq("paydayKey", finalKey(staffId)))
      .first();
    if (settlementPayments !== null)
      throw appError(
        "CONFLICT",
        "Final settlement payments are already recorded.",
      );
    await ctx.db.patch(staffId, { lastWorkingDay: undefined });
    await writeAudit(ctx, {
      organizationId: staff.organizationId,
      actorUserId: ctx.admin.userId,
      action: "exit.cancelled",
      entityType: "staff",
      entityId: staffId,
      staffId,
      metadata: { cancelledLastWorkingDay: staff.lastWorkingDay },
    });
    return null;
  },
});

export const forfeitReserve = adminMutation({
  args: { staffId: v.id("staff"), reason: v.string() },
  handler: async (ctx, args) => {
    const staff = await loadStaff(ctx, ctx.admin, args.staffId);
    requireEditable(staff);
    const reason = check(
      noteSchema.min(3, "Give a reason for forfeiting.").safeParse(args.reason),
    );
    if (staff.reserveStatus !== "held")
      throw appError("CONFLICT", "The Joining Reserve isn't held any more.");
    await ctx.db.patch(staff._id, {
      reserveStatus: "forfeited",
      reserveForfeitReason: reason,
    });
    await writeAudit(ctx, {
      organizationId: staff.organizationId,
      actorUserId: ctx.admin.userId,
      action: "reserve.forfeited",
      entityType: "staff",
      entityId: staff._id,
      staffId: staff._id,
      metadata: { reason },
    });
    return null;
  },
});

export const restoreReserve = adminMutation({
  args: { staffId: v.id("staff") },
  handler: async (ctx, { staffId }) => {
    const staff = await loadStaff(ctx, ctx.admin, staffId);
    requireEditable(staff);
    if (staff.reserveStatus !== "forfeited")
      throw appError("CONFLICT", "The Joining Reserve isn't forfeited.");
    await ctx.db.patch(staffId, {
      reserveStatus: "held",
      reserveForfeitReason: undefined,
    });
    await writeAudit(ctx, {
      organizationId: staff.organizationId,
      actorUserId: ctx.admin.userId,
      action: "reserve.restored",
      entityType: "staff",
      entityId: staffId,
      staffId,
      metadata: { previousReason: staff.reserveForfeitReason ?? null },
    });
    return null;
  },
});

/**
 * Confirms the final settlement: records a payment for everything still
 * owed (each payday, plus the reserve and unsettled adjustments), releases
 * the reserve unless forfeited, and marks the person as exited. Their login
 * stays, read-only, so they can see their history.
 */
export const confirmSettlement = adminMutation({
  args: {
    staffId: v.id("staff"),
    paidOn: v.string(),
    mode: v.union(v.literal("cash"), v.literal("upi"), v.literal("bank")),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const staff = await loadStaff(ctx, ctx.admin, args.staffId);
    requireEditable(staff);
    const paidOn = check(isoDateSchema.safeParse(args.paidOn));
    const note = args.note ? check(noteSchema.safeParse(args.note)) : undefined;
    const today = todayInIndia();
    if (staff.lastWorkingDay === undefined)
      throw appError("CONFLICT", "Set the last working day first.");
    if (staff.lastWorkingDay > today)
      throw appError(
        "INVALID_DATE",
        "The settlement can be confirmed once the last working day has come.",
      );
    if (paidOn > today)
      throw appError(
        "INVALID_DATE",
        "The payment date can't be in the future.",
      );
    return await recordSettlement(
      ctx,
      staff,
      { paidOn, mode: args.mode, note },
      ctx.admin.userId,
      today,
    );
  },
});

/**
 * Gives a staff member who forgot their password a temporary one, shown
 * once to the admin. Their devices are signed out and they must choose a
 * new password at next sign-in. Admin accounts can't be reset here.
 */
export const resetPassword = adminAction({
  args: { staffId: v.id("staff") },
  handler: async (ctx, args): Promise<{ temporaryPassword: string }> => {
    const target = await ctx.runQuery(internal.people.resetTarget, {
      staffId: args.staffId,
      organizationId: ctx.admin.organizationId,
    });
    const password = temporaryPassword();
    await modifyAccountCredentials(ctx, {
      provider: PHONE_PASSWORD_PROVIDER,
      account: { id: target.phone, secret: password },
    });
    await invalidateSessions(ctx, { userId: target.userId });
    await ctx.runMutation(internal.people.recordPasswordReset, {
      staffId: args.staffId,
      actorUserId: ctx.admin.userId,
    });
    return { temporaryPassword: password };
  },
});

export const resetTarget = internalQuery({
  args: { staffId: v.id("staff"), organizationId: v.id("organizations") },
  returns: v.object({ userId: v.id("users"), phone: v.string() }),
  handler: async (ctx, { staffId, organizationId }) => {
    const staff = await loadStaff(
      ctx,
      { organization: { _id: organizationId } },
      staffId,
    );
    const user = await ctx.db.get(staff.userId);
    if (!user?.phone) throw appError("NOT_FOUND");
    if (user.role !== "staff")
      throw appError("FORBIDDEN", "Admin passwords can't be reset here.");
    return { userId: staff.userId, phone: user.phone };
  },
});

export const recordPasswordReset = internalMutation({
  args: { staffId: v.id("staff"), actorUserId: v.id("users") },
  handler: async (ctx, { staffId, actorUserId }) => {
    const staff = (await ctx.db.get(staffId))!;
    await ctx.db.patch(staff.userId, { mustChangePassword: true });
    await writeAudit(ctx, {
      organizationId: staff.organizationId,
      actorUserId,
      action: "staff.password_reset",
      entityType: "staff",
      entityId: staffId,
      staffId,
    });
    return null;
  },
});
