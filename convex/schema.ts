import { authTables } from "@convex-dev/auth/server";
import { vPayout, vPayoutRequest } from "./lib/payout";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  vAdjustmentType,
  vAttendanceStatus,
  vPayMode,
  vNotificationSettings,
  vRecordStatus,
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
 *
 * As in MealSync, an organisation (one per Admin) has one or more
 * properties. Every staff member belongs to one property of one
 * organisation; an admin sees every property of their organisation and
 * nothing of any other. Rows that hang off a staff member (terms,
 * attendance, adjustments, payments) reach the organisation through it.
 */
export default defineSchema({
  ...authTables,

  // Admin Hub sign-in tickets already used (by their one-time `jti`), so a
  // ticket can't be used twice. Rows older than 10 minutes are deleted by a
  // scheduled job; by then the ticket has long expired anyway.
  ssoUsedTickets: defineTable({
    jti: v.string(), // unique
    usedAt: v.number(),
  })
    .index("by_jti", ["jti"])
    .index("by_usedAt", ["usedAt"]),

  organizations: defineTable({
    name: v.string(),
    status: vRecordStatus,
    /** The admin's choices for phone notifications (absent: defaults; see lib/notificationText.ts). */
    notificationSettings: v.optional(vNotificationSettings),
    createdBy: v.optional(v.id("users")),
    createdAt: v.number(),
  }),

  properties: defineTable({
    organizationId: v.id("organizations"),
    name: v.string(), // unique within the organisation (case-insensitive)
    status: vRecordStatus,
    createdAt: v.number(),
  }).index("by_org_status", ["organizationId", "status"]),

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
    /** The organisation the account belongs to. Absent for an admin who hasn't set one up yet. */
    organizationId: v.optional(v.id("organizations")),
    /** Set when an admin created the account or reset its password. */
    mustChangePassword: v.optional(v.boolean()),
    disabled: v.optional(v.boolean()),
    /** True once a master admin has signed in through the Admin Hub (single sign-on). */
    ssoManaged: v.optional(v.boolean()),
  })
    .index("email", ["email"])
    .index("phone", ["phone"])
    .index("by_role", ["role"])
    .index("by_org_role", ["organizationId", "role"]),

  staff: defineTable({
    organizationId: v.id("organizations"),
    propertyId: v.id("properties"), // a property of organizationId
    userId: v.id("users"), // unique
    name: v.string(),
    phone: v.string(), // E.164, same as the login
    department: v.string(),
    joinDate: v.string(),
    status: vStaffStatus,
    lastWorkingDay: v.optional(v.string()),
    reserveStatus: vReserveStatus,
    reserveForfeitReason: v.optional(v.string()),
    /** Where their salary is paid (UPI / bank), as approved or set by an admin. */
    payout: v.optional(vPayout),
    /** A change they asked for, waiting for an admin's approval. */
    payoutRequest: v.optional(vPayoutRequest),
    /** May mark attendance for the other staff of their property (set by an admin). */
    canMarkAttendance: v.optional(v.boolean()),
    /** Unmarked days before this date are not flagged (tracking hadn't begun for them). */
    attendanceFrom: v.string(),
    createdAt: v.number(),
    createdBy: v.optional(v.id("users")),
    exitedAt: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_org", ["organizationId"])
    .index("by_property", ["propertyId"])
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
    organizationId: v.optional(v.id("organizations")),
    staffId: v.id("staff"),
    date: v.string(),
    oldStatus: v.union(vAttendanceStatus, v.null()), // null: the day had no mark yet
    newStatus: vAttendanceStatus,
    changedBy: v.id("users"),
    changedAt: v.number(),
  })
    .index("by_org_changedAt", ["organizationId", "changedAt"])
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
    /** Past payments entered by period: the salary period the admin said it was for. */
    periodFrom: v.optional(v.string()),
    periodTo: v.optional(v.string()),
    recordedBy: v.optional(v.id("users")),
    recordedAt: v.number(),
  })
    .index("by_staff", ["staffId"])
    .index("by_payday", ["paydayKey"]),

  // Phones/browsers that receive notifications. One per endpoint.
  pushSubscriptions: defineTable({
    organizationId: v.id("organizations"),
    userId: v.id("users"),
    endpoint: v.string(), // unique
    p256dh: v.string(),
    auth: v.string(),
    createdAt: v.number(),
  })
    .index("by_endpoint", ["endpoint"])
    .index("by_user", ["userId"]),

  // Scheduled notifications already sent, so each goes out once per day and time.
  notificationRuns: defineTable({
    organizationId: v.id("organizations"),
    kind: v.string(), // "payday" | "marking"
    date: v.string(), // India date
    time: v.string(), // "HH:mm"
    sentAt: v.number(),
    recipients: v.number(),
  }).index("by_org_kind_date_time", ["organizationId", "kind", "date", "time"]),

  // Sign-in abuse protection (copied from MealSync): failed attempts per phone.
  authAttemptLimits: defineTable({
    key: v.string(),
    windowStart: v.number(),
    count: v.number(),
  }).index("by_key", ["key"]),

  // Append-only log of admin actions: salary revisions, mode changes,
  // payments, exits, forfeits... Never store passwords or tokens here.
  auditLog: defineTable({
    organizationId: v.optional(v.id("organizations")), // absent for setup steps outside any organisation
    actorUserId: v.optional(v.id("users")), // absent for setup steps run from the CLI
    action: v.string(),
    entityType: v.string(),
    entityId: v.string(),
    staffId: v.optional(v.id("staff")),
    metadata: v.optional(v.any()),
    createdAt: v.number(),
  })
    .index("by_org_createdAt", ["organizationId", "createdAt"])
    .index("by_staff_createdAt", ["staffId", "createdAt"]),
});
