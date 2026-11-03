/**
 * CONFIDENTIALITY: calls every staff query and checks that nothing about
 * how pay is calculated reaches a staff member: no pay mode, rates, cycle
 * lengths or formulas, by field name or in any text. Pay periods' dates are
 * shown (as `period.from` / `period.to`, see convex/staff.ts); the engine's
 * own cycle fields never are.
 */
import { makeFunctionReference } from "convex/server";
import { expect, test } from "vitest";
import { api } from "../_generated/api";
import { dayIndex } from "../lib/companyCalendar";
import * as staffModule from "../staff";
import {
  createAdmin,
  createStaffMember,
  setToday,
  setupTest,
} from "./harness.test-utils";

/** Field names required by the brief, plus close relatives. */
const FORBIDDEN_FIELDS = [
  "payMode",
  "rate",
  "dayRate",
  "cycleStart",
  "cycleEnd",
  "cycleLength",
];
const FORBIDDEN_FIELD_PATTERN =
  /paymode|rate$|rate[A-Z_]|dayrate|perday|cycle|salary|terms|formula|index|divisor|weight/i;
const FORBIDDEN_TEXT = [
  /16[- ]?day/i,
  /half[- ]salary/i,
  /monthly \(10th\)/i,
  /monthly_10th|half_16day/,
  /\/\s*(16|30|32)\b/,
  /× ?₹/,
];

/** Arguments for staff queries that take any. Every staff query must appear in ARGS or take none. */
const ARGS: Record<string, (months: string[]) => Record<string, unknown>[]> = {
  attendanceMonth: (months) => months.map((month) => ({ month })),
};

function findLeaks(value: unknown, path = "$"): string[] {
  const leaks: string[] = [];
  if (Array.isArray(value)) {
    value.forEach((item, i) => leaks.push(...findLeaks(item, `${path}[${i}]`)));
  } else if (value !== null && typeof value === "object") {
    for (const [key, inner] of Object.entries(value)) {
      if (FORBIDDEN_FIELDS.includes(key) || FORBIDDEN_FIELD_PATTERN.test(key))
        leaks.push(`${path}.${key}`);
      leaks.push(...findLeaks(inner, `${path}.${key}`));
    }
  } else if (typeof value === "string") {
    for (const pattern of FORBIDDEN_TEXT)
      if (pattern.test(value)) leaks.push(`${path} = "${value}"`);
  }
  return leaks;
}

test("no staff query returns pay-calculation details", async () => {
  const t = await setupTest("2027-03-01");
  const admin = await createAdmin(t);
  // Mode A, joined 3 Feb (virtual Feb 29 payday), with every kind of data.
  const a = await createStaffMember(t, admin, {
    name: "Asha Rao",
    joinDate: "2027-02-03",
    payMode: "half_16day",
  });
  // Mode B, opening balance, revision with a mode change, then an exit.
  const b = await createStaffMember(t, admin, {
    name: "Ravi Kumar",
    joinDate: "2027-01-05",
    payMode: "monthly_10th",
  });

  setToday("2027-03-20");
  for (const s of [a, b]) {
    await admin.as.mutation(api.attendance.saveDay, {
      date: "2027-03-05",
      entries: [{ staffId: s.staffId, status: "absent" }],
    });
    await admin.as.mutation(api.attendance.setOne, {
      staffId: s.staffId,
      date: "2027-03-06",
      status: "half_day",
    });
    await admin.as.mutation(api.attendance.setOne, {
      staffId: s.staffId,
      date: "2027-03-07",
      status: "paid_leave",
    });
    await admin.as.mutation(api.attendance.setOne, {
      staffId: s.staffId,
      date: "2027-03-08",
      status: "week_off",
    });
    const detail = await admin.as.query(api.people.get, { staffId: s.staffId });
    const key = detail.defaultAdjustmentTarget!;
    for (const type of ["advance", "deduction", "bonus"] as const) {
      await admin.as.mutation(api.adjustments.add, {
        staffId: s.staffId,
        type,
        amount: 300,
        note: `${type} note`,
        date: "2027-03-20",
        paydayKey: key,
      });
    }
    const due = detail.schedule.paydays.find((p) => p.status === "due");
    if (due)
      await admin.as.mutation(api.payments.record, {
        staffId: s.staffId,
        paydayKey: due.key,
        amount: 1_000,
        paidOn: "2027-03-20",
        mode: "upi",
      });
  }
  await admin.as.mutation(api.people.reviseTerms, {
    staffId: b.staffId,
    effectiveFromIndex: dayIndex(2027, 4, 1),
    monthlySalary: 33_000,
    payMode: "half_16day",
  });
  setToday("2027-04-25");
  await admin.as.mutation(api.people.setLastWorkingDay, {
    staffId: b.staffId,
    lastWorkingDay: "2027-04-24",
  });
  await admin.as.mutation(api.people.confirmSettlement, {
    staffId: b.staffId,
    paidOn: "2027-04-25",
    mode: "cash",
  });

  const names = Object.keys(staffModule).sort();
  expect(names).toEqual([
    "attendanceMonth",
    "attendanceMonths",
    "home",
    "payCalendar",
    "payments",
    "profile",
  ]);
  let calls = 0;
  for (const person of [a, b]) {
    const months = await person.as.query(api.staff.attendanceMonths, {});
    expect(months.length).toBeGreaterThan(0);
    for (const name of names) {
      const argsList = ARGS[name] ? ARGS[name](months) : [{}];
      for (const args of argsList) {
        const payload = await person.as.query(
          makeFunctionReference<"query">(`staff:${name}`),
          args,
        );
        expect(
          findLeaks(payload),
          `staff.${name}(${JSON.stringify(args)})`,
        ).toEqual([]);
        calls += 1;
      }
    }
  }
  expect(calls).toBeGreaterThanOrEqual(12);

  // The line items are there, without per-day figures.
  const payments = await a.as.query(api.staff.payments, {});
  const labels = payments.paydays.flatMap((p) => p.lines.map((l) => l.label));
  expect(labels).toEqual(
    expect.arrayContaining([
      "Absent × 1",
      "Half-day × 1",
      "Bonus: bonus note",
      "Deduction: deduction note",
      "Advance recovered: advance note",
    ]),
  );
});

test("the leak detector itself catches leaks", () => {
  expect(findLeaks({ payMode: "x" })).toHaveLength(1);
  expect(findLeaks({ a: [{ cycleStart: 1 }] })).toHaveLength(1);
  expect(
    findLeaks({ dayRate: 1, rate: 2, cycleLength: 3, cycleEnd: 4 }),
  ).toHaveLength(4);
  expect(findLeaks({ label: "Half-salary (16-day)" }).length).toBeGreaterThan(
    0,
  );
  expect(findLeaks({ label: "Absent × 2", amount: -1875 })).toEqual([]);
});
