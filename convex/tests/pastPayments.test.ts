import { expect, test } from "vitest";
import { api } from "../_generated/api";
import {
  createAdmin,
  createStaffMember,
  errorCode,
  setupTest,
} from "./harness.test-utils";

test("a past payment for a period settles that period's paydays, oldest first, and shows on the calendar", async () => {
  const t = await setupTest("2027-06-20");
  const admin = await createAdmin(t);
  const s = await createStaffMember(t, admin, {
    name: "Asha",
    joinDate: "2027-03-20",
    payMode: "half_16day",
  });
  const base = {
    staffId: s.staffId,
    paidOn: "2027-05-05",
    mode: "cash" as const,
  };

  // 30 Mar – 15 Apr and 16 Apr – 1 May fall in these dates; ₹20,000 pays the first in full and ₹5,000 of the second.
  const plan = await admin.as.query(api.payments.planPastPayment, {
    staffId: s.staffId,
    from: "2027-03-30",
    to: "2027-05-01",
    amount: 20_000,
  });
  expect(
    plan.covered.map((p) => [p.cycleStartDate, p.cycleEndDate, p.apply]),
  ).toEqual([
    ["2027-03-30", "2027-04-15", 15_000],
    ["2027-04-16", "2027-05-01", 5_000],
  ]);
  await admin.as.mutation(api.payments.recordPast, {
    ...base,
    from: "2027-03-30",
    to: "2027-05-01",
    amount: 20_000,
  });

  const cal = await s.as.query(api.staff.payCalendar, {});
  expect(
    cal.periods.slice(0, 2).map((p) => [p.date, p.state, p.remaining]),
  ).toEqual([
    ["2027-04-15", "paid", 0],
    ["2027-05-01", "pending", 10_000],
  ]);
  const detail = (await admin.as.query(api.people.get, {
    staffId: s.staffId,
  }))!;
  expect(
    detail.payments.map((p) => [p.amount, p.periodFrom, p.periodTo, p.note]),
  ).toEqual(
    expect.arrayContaining([
      [
        15_000,
        "2027-03-30",
        "2027-05-01",
        "Past payment for 2027-03-30 to 2027-04-15",
      ],
      [
        5_000,
        "2027-03-30",
        "2027-05-01",
        "Past payment for 2027-04-16 to 2027-05-01",
      ],
    ]),
  );

  // More than is owed for the dates, dates with no pay period, a future payment date: refused.
  expect(
    await errorCode(
      admin.as.mutation(api.payments.recordPast, {
        ...base,
        from: "2027-04-16",
        to: "2027-05-01",
        amount: 10_001,
      }),
    ),
  ).toBe("INVALID_INPUT");
  expect(
    await errorCode(
      admin.as.mutation(api.payments.recordPast, {
        ...base,
        from: "2027-03-20",
        to: "2027-03-25",
        amount: 100,
      }),
    ),
  ).toBe("INVALID_INPUT");
  expect(
    await errorCode(
      admin.as.mutation(api.payments.recordPast, {
        ...base,
        paidOn: "2027-07-01",
        from: "2027-04-16",
        to: "2027-05-01",
        amount: 100,
      }),
    ),
  ).toBe("INVALID_DATE");
});

test("monthly pay: a calendar month entered as 1st to 31st covers that month", async () => {
  const t = await setupTest("2027-06-20");
  const admin = await createAdmin(t);
  const s = await createStaffMember(t, admin, {
    name: "Ravi",
    joinDate: "2027-03-20",
    payMode: "monthly_10th",
    monthlySalary: 30_000,
  });
  await admin.as.mutation(api.payments.recordPast, {
    staffId: s.staffId,
    from: "2027-05-01",
    to: "2027-05-31",
    amount: 30_000,
    paidOn: "2027-06-10",
    mode: "bank",
    note: "May salary",
  });
  const may = (await admin.as.query(api.people.get, {
    staffId: s.staffId,
  }))!.schedule.paydays.find((p) => p.cycleStartDate === "2027-05-01")!;
  expect([may.dueDate, may.status, may.outstanding]).toEqual([
    "2027-06-10",
    "paid",
    0,
  ]);
  const other = await createAdmin(t, "Other", "Org B");
  expect(
    await errorCode(
      other.as.query(api.payments.planPastPayment, {
        staffId: s.staffId,
        from: "2027-05-01",
        to: "2027-05-31",
        amount: 1,
      }),
    ),
  ).toBe("NOT_FOUND");
});
