/**
 * Admin: downloadable reports (CSV, opens in Excel or Google Sheets), as in
 * MealSync. Each covers a date range and the properties chosen on screen,
 * optionally one staff member. `summary` previews the totals; `exportCsv`
 * builds the file and writes an audit entry for every download.
 */
import { v, type Infer } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { writeAudit } from "./lib/audit";
import { addRealDays, fromRealDate } from "./lib/companyCalendar";
import { toCsv } from "./lib/csv";
import { appError } from "./lib/errors";
import { adminMutation, adminQuery, type AdminViewer } from "./lib/functions";
import { isoDateSchema } from "./lib/inputRules";
import {
  ATTENDANCE_STATUSES,
  PAY_MODE_LABELS,
  type AttendanceStatus,
  type PaydayStatus,
} from "./lib/payroll";
import {
  allStaff,
  attendanceOf,
  loadStaff,
  paymentsOf,
  scheduleFor,
  worksOn,
} from "./lib/staffData";
import { todayInIndia } from "./lib/time";

export const vReportKind = v.union(
  v.literal("attendance"),
  v.literal("attendance_summary"),
  v.literal("paydays"),
  v.literal("payments"),
);
export type ReportKind = Infer<typeof vReportKind>;

/** Longest range per report, in days. Daily attendance has one row per person per day, so it's shorter. */
export const MAX_REPORT_DAYS: Record<ReportKind, number> = {
  attendance: 100,
  attendance_summary: 366,
  paydays: 366,
  payments: 366,
};
/** Paydays are worked out ahead; a report can reach this far into the future. */
const MAX_DAYS_AHEAD = 60;

const FILE_NAMES: Record<ReportKind, string> = {
  attendance: "attendance",
  attendance_summary: "attendance-summary",
  paydays: "paydays",
  payments: "payments",
};

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const weekday = (date: string) =>
  WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];

const ATTENDANCE_LABEL: Record<AttendanceStatus, string> = {
  present: "Present",
  absent: "Absent",
  half_day: "Half-day",
  paid_leave: "Paid leave",
  week_off: "Week-off",
};
const PAYDAY_STATUS_LABEL: Record<PaydayStatus, string> = {
  upcoming: "Upcoming",
  due: "Due",
  partially_paid: "Part paid",
  paid: "Paid",
};
const PAYMENT_MODE_LABEL: Record<Doc<"payments">["mode"], string> = {
  cash: "Cash",
  upi: "UPI",
  bank: "Bank transfer",
  opening: "Before the app",
};

function parseRange(kind: ReportKind, from: string, to: string) {
  const a = isoDateSchema.safeParse(from);
  const b = isoDateSchema.safeParse(to);
  if (!a.success || !b.success)
    throw appError("INVALID_INPUT", "Choose a start and an end date.");
  if (b.data < a.data)
    throw appError(
      "INVALID_INPUT",
      "The end date must be on or after the start date.",
    );
  const max = MAX_REPORT_DAYS[kind];
  if (addRealDays(a.data, max - 1) < b.data)
    throw appError(
      "INVALID_INPUT",
      `This report can cover at most ${max} days.`,
    );
  if (b.data > addRealDays(todayInIndia(), MAX_DAYS_AHEAD)) {
    throw appError(
      "INVALID_INPUT",
      `A report can reach at most ${MAX_DAYS_AHEAD} days ahead.`,
    );
  }
  return { from: a.data, to: b.data };
}

function datesBetween(from: string, to: string): string[] {
  const dates: string[] = [];
  for (let d = from; d <= to; d = addRealDays(d, 1)) dates.push(d);
  return dates;
}

/** "+919876543210" → "98765 43210" (Indian numbers), so spreadsheets keep it as text. */
function readablePhone(phone: string): string {
  const m = /^\+91(\d{5})(\d{5})$/.exec(phone);
  return m ? `${m[1]} ${m[2]}` : phone.replace(/^\+/, "");
}

type Cell = string | number;
type Report = {
  header: string[];
  rows: Cell[][];
  totals: { label: string; value: string | number }[];
};

const rupees = (n: number) => Math.round(n * 100) / 100;

async function buildReport(
  ctx: Pick<QueryCtx, "db">,
  admin: AdminViewer,
  kind: ReportKind,
  from: string,
  to: string,
  staffId?: Doc<"staff">["_id"],
): Promise<Report> {
  const people = staffId
    ? [await loadStaff(ctx, admin, staffId)]
    : await allStaff(ctx, admin);
  const propertyName = new Map(
    admin.properties.map((p) => [p._id as string, p.name]),
  );
  const who = (s: Doc<"staff">) => [
    propertyName.get(s.propertyId) ?? "",
    s.name,
    readablePhone(s.phone),
    s.department,
  ];
  const today = todayInIndia();

  if (kind === "attendance" || kind === "attendance_summary") {
    const dates = datesBetween(from, to);
    const totals = Object.fromEntries(
      [...ATTENDANCE_STATUSES, "unmarked"].map((s) => [s, 0]),
    ) as Record<AttendanceStatus | "unmarked", number>;
    const rows: Cell[][] = [];
    for (const s of people) {
      const marks = new Map(
        (await attendanceOf(ctx, s._id)).map((m) => [m.date, m.status]),
      );
      const own = Object.fromEntries(
        [...ATTENDANCE_STATUSES, "unmarked"].map((k) => [k, 0]),
      ) as typeof totals;
      let working = 0;
      for (const date of dates) {
        if (!worksOn(s, date)) continue;
        const status = marks.get(date) ?? null;
        // Days still to come aren't "not marked" yet; they're simply left out.
        if (status === null && date > today) continue;
        working += 1;
        own[status ?? "unmarked"] += 1;
        if (kind === "attendance") {
          rows.push([
            ...who(s),
            date,
            weekday(date),
            status ? ATTENDANCE_LABEL[status] : "Not marked",
            fromRealDate(date) === null ? "No (31st)" : "Yes",
          ]);
        }
      }
      for (const k of Object.keys(totals) as (keyof typeof totals)[])
        totals[k] += own[k];
      if (kind === "attendance_summary" && working > 0) {
        const paidDays =
          own.present + own.paid_leave + own.week_off + own.half_day * 0.5;
        rows.push([
          ...who(s),
          working,
          own.present,
          own.half_day,
          own.absent,
          own.paid_leave,
          own.week_off,
          own.unmarked,
          paidDays,
        ]);
      }
    }
    const summary = [
      ...ATTENDANCE_STATUSES.map((st) => ({
        label: ATTENDANCE_LABEL[st],
        value: totals[st],
      })),
      { label: "Not marked", value: totals.unmarked },
    ];
    return kind === "attendance"
      ? {
          header: [
            "Property",
            "Staff",
            "Mobile",
            "Department",
            "Date",
            "Day",
            "Attendance",
            "Counts for pay",
          ],
          rows,
          totals: summary,
        }
      : {
          header: [
            "Property",
            "Staff",
            "Mobile",
            "Department",
            "Working days",
            "Present",
            "Half-day",
            "Absent",
            "Paid leave",
            "Week-off",
            "Not marked",
            "Paid days (marked)",
          ],
          rows,
          totals: [{ label: "Staff", value: rows.length }, ...summary],
        };
  }

  if (kind === "paydays") {
    const rows: Cell[][] = [];
    let net = 0;
    let paid = 0;
    for (const s of people) {
      const schedule = await scheduleFor(ctx, s, today);
      for (const p of schedule.paydays) {
        if (p.dueDate < from || p.dueDate > to) continue;
        net += p.net;
        paid += p.paid;
        rows.push([
          ...who(s),
          p.dueDate,
          p.isFinal ? "Final cycle" : "Payday",
          PAY_MODE_LABELS[p.payMode],
          p.cycleStartDate,
          p.cycleEndDate,
          p.tally.paidDays,
          rupees(p.earning),
          p.bonus,
          p.deduction,
          p.advance,
          p.net,
          p.paid,
          p.outstanding,
          PAYDAY_STATUS_LABEL[p.status],
        ]);
      }
      const settlement = schedule.settlement;
      if (
        settlement &&
        settlement.dueDate >= from &&
        settlement.dueDate <= to &&
        settlement.extrasNet !== 0
      ) {
        net += settlement.extrasNet;
        paid += settlement.extrasPaid;
        rows.push([
          ...who(s),
          settlement.dueDate,
          "Final settlement (reserve and other items)",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          settlement.extrasNet,
          settlement.extrasPaid,
          settlement.extrasOutstanding,
          settlement.extrasOutstanding <= 0
            ? "Paid"
            : settlement.extrasPaid > 0
              ? "Part paid"
              : "Due",
        ]);
      }
    }
    rows.sort(
      (a, b) =>
        String(a[4]).localeCompare(String(b[4])) ||
        String(a[1]).localeCompare(String(b[1])),
    );
    return {
      header: [
        "Property",
        "Staff",
        "Mobile",
        "Department",
        "Payday",
        "Type",
        "Pay mode",
        "Cycle start",
        "Cycle end",
        "Paid days",
        "Earned (₹)",
        "Bonus (₹)",
        "Deduction (₹)",
        "Advance (₹)",
        "Net payable (₹)",
        "Paid (₹)",
        "Still owed (₹)",
        "Status",
      ],
      rows,
      totals: [
        { label: "Paydays", value: rows.length },
        { label: "Net payable (₹)", value: net },
        { label: "Paid (₹)", value: paid },
        { label: "Still owed (₹)", value: net - paid },
      ],
    };
  }

  // Payments made in the range.
  const rows: Cell[][] = [];
  let total = 0;
  for (const s of people) {
    const schedule = await scheduleFor(ctx, s, today);
    const paydayDate = new Map(schedule.paydays.map((p) => [p.key, p.dueDate]));
    if (schedule.settlement)
      paydayDate.set(
        schedule.settlement.key,
        `${schedule.settlement.dueDate} (final settlement)`,
      );
    for (const p of await paymentsOf(ctx, s._id)) {
      if (p.paidOn < from || p.paidOn > to) continue;
      total += p.amount;
      rows.push([
        ...who(s),
        p.paidOn,
        paydayDate.get(p.paydayKey) ?? "",
        p.amount,
        PAYMENT_MODE_LABEL[p.mode],
        p.note ?? "",
      ]);
    }
  }
  rows.sort(
    (a, b) =>
      String(a[4]).localeCompare(String(b[4])) ||
      String(a[1]).localeCompare(String(b[1])),
  );
  return {
    header: [
      "Property",
      "Staff",
      "Mobile",
      "Department",
      "Paid on",
      "For payday",
      "Amount (₹)",
      "Mode",
      "Note",
    ],
    rows,
    totals: [
      { label: "Payments", value: rows.length },
      { label: "Total paid (₹)", value: total },
    ],
  };
}

const reportArgs = {
  kind: vReportKind,
  from: v.string(),
  to: v.string(),
  staffId: v.optional(v.id("staff")),
};

/** Totals for the chosen report, to preview before downloading. */
export const summary = adminQuery({
  args: reportArgs,
  handler: async (ctx, args) => {
    const { from, to } = parseRange(args.kind, args.from, args.to);
    const report = await buildReport(
      ctx,
      ctx.admin,
      args.kind,
      from,
      to,
      args.staffId,
    );
    return { from, to, rows: report.rows.length, totals: report.totals };
  },
});

/** The report as a CSV file. Every download is written to the audit log. */
export const exportCsv = adminMutation({
  args: reportArgs,
  handler: async (ctx, args) => {
    const { from, to } = parseRange(args.kind, args.from, args.to);
    const report = await buildReport(
      ctx,
      ctx.admin,
      args.kind,
      from,
      to,
      args.staffId,
    );
    const { organization, property, userId } = ctx.admin;
    await writeAudit(ctx, {
      organizationId: organization._id,
      actorUserId: userId,
      action: "report.exported",
      entityType: property ? "properties" : "organizations",
      entityId: property ? property._id : organization._id,
      staffId: args.staffId,
      metadata: { kind: args.kind, from, to, rows: report.rows.length },
    });
    const slug = (text: string) =>
      text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
    const who = args.staffId
      ? slug((await loadStaff(ctx, ctx.admin, args.staffId)).name) || "staff"
      : property
        ? slug(property.name) || "property"
        : "all-properties";
    return {
      filename: `staff-${FILE_NAMES[args.kind]}-${who}-${from}-to-${to}.csv`,
      csv: toCsv([report.header, ...report.rows]),
    };
  },
});
