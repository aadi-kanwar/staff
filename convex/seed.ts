/**
 * DEVELOPMENT ONLY: sample data so every screen can be reviewed.
 * Refuses to run unless STAFF_ALLOW_DEV_SEED=true and DEV_SEED_PASSWORD is
 * set on the deployment. Run with `npx convex run seed:dev`.
 *
 * Accounts (password = DEV_SEED_PASSWORD, no forced change):
 *   +919000000001  Admin (only if no admin exists yet)
 *   +919000000002  Asha Rao      Half-salary (16-day), joined 14 Sep 2026, one payday overdue;
 *                                can mark attendance for North PG
 *   +919000000003  Ravi Kumar    Monthly (10th), joined 1 Jun 2026, advance on the next payday
 *   +919000000004  Meena Joshi   Half-salary (16-day), joined 4 Feb 2026: first payday was virtual
 *                                Feb 29 (paid 1 Mar); a salary revision is scheduled
 *   +919000000005  Suresh Patel  left on 25 Oct 2026, settled
 *
 * If the admin has no organisation yet, "Sample organisation" is created
 * with two properties, North PG and South PG. Asha and Ravi work at the
 * first property, Meena and Suresh at the second (or the first, if the
 * organisation has only one).
 */
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { createLogin } from "./lib/accounts";
import { writeAudit } from "./lib/audit";
import { joinIndexFromRealDate } from "./lib/companyCalendar";
import { appError } from "./lib/errors";
import {
  adminOrganization,
  internalAction,
  internalMutation,
  internalQuery,
  organizationProperties,
} from "./lib/functions";
import { computeSchedule, revisionStarts, type PayMode } from "./lib/payroll";
import { recordSettlement } from "./lib/settlement";
import { engineInputFor, scheduleFor } from "./lib/staffData";
import { todayInIndia } from "./lib/time";
import { vAttendanceStatus } from "./lib/validators";

type Sample = {
  key: string;
  name: string;
  phone: string;
  department: string;
  joinDate: string;
  monthlySalary: number;
  payMode: PayMode;
  /** Tracking began on this date (days before count as Present without a flag). */
  asOf: string;
  /** The last payday (real date) already paid outside the app. */
  paidUpToDate?: string;
  /** Which of the organisation's properties (by position). */
  property: 0 | 1;
  /** May mark attendance for the others at their property. */
  canMarkAttendance?: boolean;
};

const SAMPLES: Sample[] = [
  {
    key: "asha",
    name: "Asha Rao",
    phone: "+919000000002",
    department: "Kitchen",
    joinDate: "2026-09-14",
    monthlySalary: 30_000,
    payMode: "half_16day",
    asOf: "2026-11-01",
    paidUpToDate: "2026-10-10",
    property: 0,
    canMarkAttendance: true,
  },
  {
    key: "ravi",
    name: "Ravi Kumar",
    phone: "+919000000003",
    department: "Housekeeping",
    joinDate: "2026-06-01",
    monthlySalary: 24_000,
    payMode: "monthly_10th",
    asOf: "2026-11-01",
    paidUpToDate: "2026-10-10",
    property: 0,
  },
  {
    key: "meena",
    name: "Meena Joshi",
    phone: "+919000000004",
    department: "Front desk",
    joinDate: "2026-02-04",
    monthlySalary: 27_000,
    payMode: "half_16day",
    asOf: "2026-11-01",
    paidUpToDate: "2026-10-23",
    property: 1,
  },
  {
    key: "suresh",
    name: "Suresh Patel",
    phone: "+919000000005",
    department: "Security",
    joinDate: "2026-07-20",
    monthlySalary: 21_000,
    payMode: "half_16day",
    asOf: "2026-10-21",
    paidUpToDate: "2026-10-20",
    property: 1,
  },
];

function requireDevSeed(): string {
  if (process.env.STAFF_ALLOW_DEV_SEED !== "true") {
    throw appError(
      "FORBIDDEN",
      "Sample data is only allowed on a development deployment (set STAFF_ALLOW_DEV_SEED=true).",
    );
  }
  const password = process.env.DEV_SEED_PASSWORD ?? "";
  if (password.length < 8)
    throw appError(
      "INVALID_INPUT",
      "Set DEV_SEED_PASSWORD (at least 8 characters) first.",
    );
  return password;
}

/** The last payday on or before `date`, for "Paid up to". */
function paydayIndexOn(sample: Sample, date: string): number {
  const schedule = computeSchedule({
    staffId: "seed",
    joinDate: sample.joinDate,
    terms: [
      {
        effectiveFromIndex: joinIndexFromRealDate(sample.joinDate),
        monthlySalary: sample.monthlySalary,
        payMode: sample.payMode,
      },
    ],
    attendance: {},
    adjustments: [],
    payments: [],
    today: date,
    reserveStatus: "held",
    upcoming: 1,
  });
  const payday = schedule.paydays.filter((p) => p.dueDate <= date).at(-1);
  if (!payday) throw new Error(`No payday by ${date} for ${sample.name}`);
  return payday.paydayIndex;
}

export const dev = internalAction({
  args: {},
  handler: async (ctx): Promise<{ message: string }> => {
    const password = requireDevSeed();
    let adminId = await ctx.runQuery(internal.seed.firstAdmin, {});
    if (adminId === null) {
      adminId = await createLogin(ctx, "+919000000001", password);
      await ctx.runMutation(internal.setup.makeAdmin, {
        userId: adminId,
        name: "Sample Admin",
      });
    }
    const { organizationId, propertyIds } = await ctx.runMutation(
      internal.seed.ensureOrganization,
      { adminId },
    );
    const created: string[] = [];
    for (const sample of SAMPLES) {
      if (await ctx.runQuery(internal.seed.phoneTaken, { phone: sample.phone }))
        continue;
      const userId = await createLogin(ctx, sample.phone, password);
      const staffId: Id<"staff"> = await ctx.runMutation(
        internal.people.insertStaff,
        {
          organizationId,
          propertyId:
            propertyIds[Math.min(sample.property, propertyIds.length - 1)],
          name: sample.name,
          phone: sample.phone,
          department: sample.department,
          joinDate: sample.joinDate,
          monthlySalary: sample.monthlySalary,
          payMode: sample.payMode,
          paidUpToIndex: sample.paidUpToDate
            ? paydayIndexOn(sample, sample.paidUpToDate)
            : undefined,
          reserveStatus: "held",
          canMarkAttendance: sample.canMarkAttendance,
          userId,
          createdBy: adminId,
          asOf: sample.asOf,
          mustChangePassword: false,
        },
      );
      await ctx.runMutation(internal.seed.populate, {
        key: sample.key,
        staffId,
        adminId,
      });
      created.push(sample.name);
    }
    return {
      message: created.length
        ? `Created: ${created.join(", ")}.`
        : "Sample data already exists; nothing changed.",
    };
  },
});

/** The admin's organisation and its properties; creates the sample ones if they have none. */
export const ensureOrganization = internalMutation({
  args: { adminId: v.id("users") },
  handler: async (
    ctx,
    { adminId },
  ): Promise<{
    organizationId: Id<"organizations">;
    propertyIds: Id<"properties">[];
  }> => {
    const admin = (await ctx.db.get(adminId))!;
    const existing = await adminOrganization(ctx, admin);
    if (existing !== null) {
      const properties = await organizationProperties(ctx, existing._id);
      if (properties.length > 0)
        return {
          organizationId: existing._id,
          propertyIds: properties.map((p) => p._id),
        };
    }
    const now = Date.now();
    const organizationId =
      existing?._id ??
      (await ctx.db.insert("organizations", {
        name: "Sample organisation",
        status: "active",
        createdBy: adminId,
        createdAt: now,
      }));
    await ctx.db.patch(adminId, { organizationId });
    const propertyIds: Id<"properties">[] = [];
    for (const name of ["North PG", "South PG"]) {
      propertyIds.push(
        await ctx.db.insert("properties", {
          organizationId,
          name,
          status: "active",
          createdAt: now,
        }),
      );
    }
    return { organizationId, propertyIds };
  },
});

export const firstAdmin = internalQuery({
  args: {},
  handler: async (ctx) =>
    (
      await ctx.db
        .query("users")
        .withIndex("by_role", (q) => q.eq("role", "admin"))
        .first()
    )?._id ?? null,
});

export const phoneTaken = internalQuery({
  args: { phone: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { phone }) =>
    (await ctx.db
      .query("users")
      .withIndex("phone", (q) => q.eq("phone", phone))
      .first()) !== null,
});

type Mark = { date: string; status: typeof vAttendanceStatus.type };

/** Attendance, adjustments, revisions and the exit for each sample person. */
export const populate = internalMutation({
  args: { key: v.string(), staffId: v.id("staff"), adminId: v.id("users") },
  handler: async (ctx, { key, staffId, adminId }) => {
    const today = todayInIndia();
    const now = Date.now();
    const { organizationId } = (await ctx.db.get(staffId))!;
    const mark = async (marks: Mark[]) => {
      for (const m of marks) {
        await ctx.db.insert("attendance", {
          staffId,
          date: m.date,
          status: m.status,
          markedBy: adminId,
          updatedAt: now,
        });
        await ctx.db.insert("attendanceLog", {
          organizationId,
          staffId,
          date: m.date,
          oldStatus: null,
          newStatus: m.status,
          changedBy: adminId,
          changedAt: now,
        });
      }
    };
    const adjust = async (
      type: "advance" | "deduction" | "bonus",
      amount: number,
      note: string,
    ) => {
      const staff = (await ctx.db.get(staffId))!;
      const schedule = await scheduleFor(ctx, staff, today);
      const target =
        schedule.paydays.find(
          (p) => p.status !== "paid" && p.dueDate >= today,
        ) ?? schedule.paydays.at(-1)!;
      await ctx.db.insert("adjustments", {
        staffId,
        type,
        amount,
        note,
        date: today,
        paydayKey: target.key,
        createdBy: adminId,
        createdAt: now,
      });
    };

    if (key === "asha") {
      // 25 Oct payday left unpaid (overdue); 2 Nov left unmarked on purpose.
      await mark([{ date: "2026-11-01", status: "present" }]);
      await adjust("bonus", 500, "Diwali bonus");
    }
    if (key === "ravi") {
      await mark([
        { date: "2026-11-01", status: "half_day" },
        { date: "2026-11-02", status: "present" },
      ]);
      await adjust("advance", 2_000, "Advance for rent");
      // October (paid 10 Nov) is still to come; September was paid on 10 Oct.
    }
    if (key === "meena") {
      await mark([
        { date: "2026-11-01", status: "week_off" },
        { date: "2026-11-02", status: "absent" },
      ]);
      await adjust("deduction", 300, "Broken crockery");
      // A raise from the next cycle start (the date picker's first option).
      const staff = (await ctx.db.get(staffId))!;
      const input = await engineInputFor(ctx, staff, today);
      const start = revisionStarts(
        { joinDate: staff.joinDate, terms: input.terms, today },
        1,
      )[0];
      if (start !== undefined) {
        await ctx.db.insert("salaryTerms", {
          staffId,
          effectiveFromIndex: start,
          monthlySalary: 30_000,
          payMode: "half_16day",
          createdBy: adminId,
          createdAt: now,
        });
      }
    }
    if (key === "suresh") {
      await mark([
        { date: "2026-10-21", status: "absent" },
        { date: "2026-10-22", status: "present" },
        { date: "2026-10-23", status: "present" },
        { date: "2026-10-24", status: "paid_leave" },
        { date: "2026-10-25", status: "present" },
      ]);
      await ctx.db.patch(staffId, { lastWorkingDay: "2026-10-25" });
      const staff = (await ctx.db.get(staffId))!;
      await recordSettlement(
        ctx,
        staff,
        { paidOn: "2026-10-27", mode: "bank" },
        adminId,
        today,
      );
    }
    await writeAudit(ctx, {
      organizationId,
      actorUserId: adminId,
      action: "dev.seeded",
      entityType: "staff",
      entityId: staffId,
      staffId,
    });
    return null;
  },
});
