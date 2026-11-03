import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  vAdjustmentType,
  vAttendanceStatus,
  vPayMode,
  vReserveStatus,
  vRole,
  vStaffStatus,
  vStoredPaymentMode,
} from "./lib/validators";

/**
 * Staff attendance & salary data model.
 *
 * Convex has no unique constraints. Every "one per X" rule below is
 * enforced inside the mutation that inserts the row (look up by index
 * first, then insert or update). Mutations are transactional, so this is safe.
 *
 * Paydays are NOT stored: convex/lib/payroll.ts computes them from
 * salaryTerms, attendance, adjustments and payments. Adjustments and
 * payments point at a payday by its deterministic key,
 * `${staffId}:${virtualPaydayIndex}` (or `${staffId}:final` for the
 * leaver's final settlement extras).
 *
 * Dates are real dates "YYYY-MM-DD" in Asia/Kolkata; "...Index" fields are
 * days on the 30-day company calendar (convex/lib/companyCalendar.ts).
 */
export default defineSchema({
  ...authTables,

  // Convex Auth's users table, plus who the account belongs to.
  users: defineTable({
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    phone: v.optional(v.string()), // E.164: the login identifier
    phoneVerificationTime: v.optional(v.number()),
    isAnonymous: v.optional(v.boolean()),
    // Absent until the account is set up by an admin (or the first-admin script).
    role: v.optional(vRole),
    /** Set when an admin created the account or reset its password. */
    mustChangePassword: v.optional(v.boolean()),
    disabled: v.optional(v.boolean()),
  })
    .index("email", ["email"])
    .index("phone", ["phone"])
    .index("by_role", ["role"]),

  staff: defineTable({
    userId: v.id("users"), // unique
    name: v.string(),
    phone: v.string(), // E.164, same as the login
    department: v.string(),
    joinDate: v.string(),
    status: vStaffStatus,
    lastWorkingDay: v.optional(v.string()),
    reserveStatus: vReserveStatus,
    reserveForfeitReason: v.optional(v.string()),
    /** Unmarked days before this date are not flagged (tracking hadn't begun for them). */
    attendanceFrom: v.string(),
    createdAt: v.number(),
    createdBy: v.optional(v.id("users")),
    exitedAt: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_status", ["status"])
    .index("by_phone", ["phone"]),

  // Salary history. The earliest row is the terms at joining (it fixes the
  // Joining Reserve); later rows start on a cycle's first day.
  salaryTerms: defineTable({
    staffId: v.id("staff"),
    effectiveFromIndex: v.number(),
    monthlySalary: v.number(),
    payMode: vPayMode,
    createdBy: v.optional(v.id("users")),
    createdAt: v.number(),
  }).index("by_staff_effective", ["staffId", "effectiveFromIndex"]),

  // Current mark only. One per staff + date.
  attendance: defineTable({
    staffId: v.id("staff"),
    date: v.string(),
    status: vAttendanceStatus,
    markedBy: v.id("users"),
    updatedAt: v.number(),
  })
    .index("by_staff_date", ["staffId", "date"])
    .index("by_date", ["date"]),

  // Append-only: every change to attendance, never edited or deleted.
  attendanceLog: defineTable({
    staffId: v.id("staff"),
    date: v.string(),
    oldStatus: v.union(vAttendanceStatus, v.null()), // null: the day had no mark yet
    newStatus: vAttendanceStatus,
    changedBy: v.id("users"),
    changedAt: v.number(),
  })
    .index("by_changedAt", ["changedAt"])
    .index("by_staff_changedAt", ["staffId", "changedAt"]),

  adjustments: defineTable({
    staffId: v.id("staff"),
    type: vAdjustmentType,
    amount: v.number(), // whole rupees, > 0
    note: v.string(),
    date: v.string(),
    paydayKey: v.string(),
    createdBy: v.optional(v.id("users")),
    createdAt: v.number(),
  })
    .index("by_staff", ["staffId"])
    .index("by_payday", ["paydayKey"]),

  payments: defineTable({
    staffId: v.id("staff"),
    paydayKey: v.string(),
    amount: v.number(), // whole rupees, > 0
    paidOn: v.string(),
    mode: vStoredPaymentMode,
    note: v.optional(v.string()),
    recordedBy: v.optional(v.id("users")),
    recordedAt: v.number(),
  })
    .index("by_staff", ["staffId"])
    .index("by_payday", ["paydayKey"]),

  // Sign-in abuse protection (copied from MealSync): failed attempts per phone.
  authAttemptLimits: defineTable({
    key: v.string(),
    windowStart: v.number(),
    count: v.number(),
  }).index("by_key", ["key"]),

  // Append-only log of admin actions: salary revisions, mode changes,
  // payments, exits, forfeits... Never store passwords or tokens here.
  auditLog: defineTable({
    actorUserId: v.optional(v.id("users")), // absent for setup steps run from the CLI
    action: v.string(),
    entityType: v.string(),
    entityId: v.string(),
    staffId: v.optional(v.id("staff")),
    metadata: v.optional(v.any()),
    createdAt: v.number(),
  })
    .index("by_createdAt", ["createdAt"])
    .index("by_staff_createdAt", ["staffId", "createdAt"]),
});
