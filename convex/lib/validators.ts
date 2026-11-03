import { v, type Infer } from "convex/values";

/** Account roles. One admin for v1, but any number of accounts may hold "admin". */
export const ROLES = ["admin", "staff"] as const;
export const vRole = v.union(v.literal("admin"), v.literal("staff"));
export type Role = Infer<typeof vRole>;

export const vPayMode = v.union(
  v.literal("monthly_10th"),
  v.literal("half_16day"),
);

export const vAttendanceStatus = v.union(
  v.literal("present"),
  v.literal("absent"),
  v.literal("half_day"),
  v.literal("paid_leave"),
  v.literal("week_off"),
);

/** Organisations and properties: archived ones are kept for history but hidden. */
export const vRecordStatus = v.union(
  v.literal("active"),
  v.literal("archived"),
);

export const vStaffStatus = v.union(v.literal("active"), v.literal("exited"));
export type StaffStatus = Infer<typeof vStaffStatus>;

export const vReserveStatus = v.union(
  v.literal("held"),
  v.literal("released"),
  v.literal("forfeited"),
);

export const vAdjustmentType = v.union(
  v.literal("advance"),
  v.literal("deduction"),
  v.literal("bonus"),
);

/** "opening": paydays settled outside the app before it was used (set when adding existing staff). */
export const PAYMENT_MODES = ["cash", "upi", "bank"] as const;
export const vPaymentMode = v.union(
  v.literal("cash"),
  v.literal("upi"),
  v.literal("bank"),
);
export const vStoredPaymentMode = v.union(
  v.literal("cash"),
  v.literal("upi"),
  v.literal("bank"),
  v.literal("opening"),
);
export type StoredPaymentMode = Infer<typeof vStoredPaymentMode>;
