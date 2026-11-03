import type { AttendanceStatus } from "@convex/lib/payroll";

export const ATTENDANCE_OPTIONS: { value: AttendanceStatus; label: string; short: string }[] = [
  { value: "present", label: "Present", short: "P" },
  { value: "absent", label: "Absent", short: "A" },
  { value: "half_day", label: "Half-day", short: "H" },
  { value: "paid_leave", label: "Paid leave", short: "L" },
  { value: "week_off", label: "Week-off", short: "W" },
];

export const ATTENDANCE_LABEL = Object.fromEntries(ATTENDANCE_OPTIONS.map((o) => [o.value, o.label])) as Record<
  AttendanceStatus,
  string
>;

/** Token classes per status (backgrounds are the subtle semantic tokens; text always has a label too). */
export const ATTENDANCE_TONE: Record<AttendanceStatus, string> = {
  present: "border-success-border bg-success-subtle text-success",
  absent: "border-danger-border bg-danger-subtle text-danger-text",
  half_day: "border-warning-border bg-warning-subtle text-warning",
  paid_leave: "border-info-border bg-info-subtle text-info",
  week_off: "border-border bg-muted text-foreground-secondary",
};

export const PAYDAY_STATUS_LABEL = {
  upcoming: "Upcoming",
  due: "Due",
  partially_paid: "Part paid",
  paid: "Paid",
} as const;

export const PAYMENT_MODE_LABEL: Record<string, string> = {
  cash: "Cash",
  upi: "UPI",
  bank: "Bank transfer",
  opening: "Before the app",
};

export const ADJUSTMENT_LABEL = { advance: "Advance", deduction: "Deduction", bonus: "Bonus" } as const;
