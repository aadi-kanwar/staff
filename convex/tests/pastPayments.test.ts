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
        "Past payment for 30 Mar – 15 Apr 2027",
      ],
      [
        5_000,
        "2027-03-30",
        "2027-05-01",
        "Past payment for 16 Apr – 1 May 2027",
      ],
    ]),
  );

  // Nothing is refused. More than is owed: the rest is kept as a past payment for those dates.
  await admin.as.mutation(api.payments.recordPast, {
    ...base,
    from: "2027-04-16",
    to: "2027-05-01",
    amount: 10_001,
  });
  // Dates with no pay period (the Joining Reserve days), even a reversed range: kept as a past payment.
  await admin.as.mutation(api.payments.recordPast, {
    ...base,
    from: "2027-03-25",
    to: "2027-03-20",
    amount: 500,
  });
  const after = await s.as.query(api.staff.payCalendar, {});
  expect(after.periods[1]).toMatchObject({ state: "paid", remaining: 0 });
  expect(after.pastEntries).toEqual([
    { kind: "payment", from: "2027-03-20", to: "2027-03-25", amount: 500 },
    { kind: "payment", from: "2027-04-16", to: "2027-05-01", amount: 1 },
  ]);
  // Shown on the staff member's Payments too, and nothing more is owed because of it.
  const list = await s.as.query(api.staff.payments, {});
  expect(
    list.paydays
      .filter((r) => r.title === "Past payment")
      .map((r) => r.amount)
      .sort(),
  ).toEqual([1, 500]);
  expect(
    (await admin.as.query(api.people.get, { staffId: s.staffId }))!.schedule
      .unsettledAdjustments,
  ).toEqual([]);
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

test("past bonuses and deductions go on the pay period of their dates, or are kept as history", async () => {
  const t = await setupTest("2027-06-20");
  const admin = await createAdmin(t);
  const s = await createStaffMember(t, admin, {
    name: "Asha",
    joinDate: "2027-03-20",
    payMode: "half_16day",
  });
  // A bonus for 2–17 May, already paid with that salary: the payday's net goes up by 500 and 500 is paid.
  await admin.as.mutation(api.payments.recordPast, {
    staffId: s.staffId,
    kind: "bonus",
    from: "2027-05-02",
    to: "2027-05-17",
    amount: 500,
    alreadyPaid: true,
    paidOn: "2027-05-17",
    mode: "upi",
  });
  // A deduction for 18 May – 3 Jun (not paid yet): that payday's net goes down.
  await admin.as.mutation(api.payments.recordPast, {
    staffId: s.staffId,
    kind: "deduction",
    from: "2027-05-18",
    to: "2027-06-03",
    amount: 1_000,
    note: "Broken mixer",
  });
  const paydays = (await admin.as.query(api.people.get, {
    staffId: s.staffId,
  }))!.schedule.paydays;
  const may17 = paydays.find((p) => p.dueDate === "2027-05-17")!;
  const jun3 = paydays.find((p) => p.dueDate === "2027-06-03")!;
  expect([may17.bonus, may17.net, may17.paid]).toEqual([500, 15_500, 500]);
  expect([jun3.deduction, jun3.net]).toEqual([1_000, 14_000]);
  // Dates with no pay period: kept as history, not carried into the final settlement.
  await admin.as.mutation(api.payments.recordPast, {
    staffId: s.staffId,
    kind: "deduction",
    from: "2027-03-20",
    to: "2027-03-22",
    amount: 200,
  });
  const detail = (await admin.as.query(api.people.get, {
    staffId: s.staffId,
  }))!;
  expect(detail.pastEntries.map((e) => [e.kind, e.amount])).toEqual([
    ["deduction", 200],
  ]);
  expect(detail.schedule.unsettledAdjustments).toEqual([]);
  const list = await s.as.query(api.staff.payments, {});
  expect(list.paydays.find((r) => r.title === "Past deduction")?.amount).toBe(
    -200,
  );
});
