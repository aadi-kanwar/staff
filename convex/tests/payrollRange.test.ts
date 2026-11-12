import { expect, test } from "vitest";
import { api } from "../_generated/api";
import {
  createAdmin,
  createStaffMember,
  errorCode,
  setupTest,
} from "./harness.test-utils";

test("payroll range: paid and unpaid paydays in any range, what's owed now, and this month's totals", async () => {
  const t = await setupTest("2027-05-20");
  const admin = await createAdmin(t);
  const south = await admin.as.mutation(api.organization.addProperty, {
    name: "South PG",
  });
  const s = await createStaffMember(t, admin, {
    name: "Asha Rao",
    joinDate: "2027-03-20",
    payMode: "half_16day",
  }); // 15 Apr, 1 May, 17 May, 3 Jun…
  await createStaffMember(t, admin, {
    name: "Meena",
    joinDate: "2027-03-20",
    payMode: "half_16day",
    propertyId: south,
  });
  const key = async (date: string) =>
    (await admin.as.query(api.people.get, {
      staffId: s.staffId,
    }))!.schedule.paydays.find((p) => p.dueDate === date)!.key;
  await admin.as.mutation(api.payments.record, {
    staffId: s.staffId,
    paydayKey: await key("2027-05-01"),
    amount: 15_000,
    paidOn: "2027-05-02",
    mode: "upi",
  });
  await admin.as.mutation(api.payments.record, {
    staffId: s.staffId,
    paydayKey: await key("2027-05-17"),
    amount: 5_000,
    paidOn: "2027-05-18",
    mode: "cash",
  });

  const may = await admin.as.query(api.paydays.range, {
    from: "2027-05-01",
    to: "2027-05-31",
    propertyId: admin.propertyId,
  });
  expect(may.month).toMatchObject({
    start: "2027-05-01",
    end: "2027-05-31",
    due: 30_000,
    pending: 10_000,
    paid: 20_000,
    tickets: 2,
    paidTickets: 1,
  });
  expect(may.rows.map((r) => [r.dueDate, r.status, r.lastPaidOn])).toEqual([
    ["2027-05-01", "paid", "2027-05-02"],
    ["2027-05-17", "partially_paid", "2027-05-18"],
  ]);
  // Owed now, whatever the range: 15 Apr (unpaid) and the rest of 17 May.
  expect(may.owedNow.map((r) => [r.dueDate, r.outstanding])).toEqual([
    ["2027-04-15", 15_000],
    ["2027-05-17", 10_000],
  ]);

  // All properties: both people. A range in the future reaches far enough.
  const ahead = await admin.as.query(api.paydays.range, {
    from: "2027-06-01",
    to: "2027-07-31",
  });
  expect(
    ahead.rows.filter((r) => r.name === "Asha Rao").map((r) => r.dueDate),
  ).toEqual(["2027-06-03", "2027-06-19", "2027-07-05", "2027-07-21"]);
  expect(new Set(ahead.rows.map((r) => r.name))).toEqual(
    new Set(["Asha Rao", "Meena"]),
  );

  expect(
    await errorCode(
      admin.as.query(api.paydays.range, {
        from: "2027-05-31",
        to: "2027-05-01",
      }),
    ),
  ).toBe("INVALID_INPUT");
  expect(
    await errorCode(
      admin.as.query(api.paydays.range, {
        from: "2026-01-01",
        to: "2027-05-01",
      }),
    ),
  ).toBe("INVALID_INPUT");

  // The dashboard shows the same month.
  const dash = await admin.as.query(api.dashboard.summary, {
    propertyId: admin.propertyId,
  });
  expect(dash.month).toMatchObject({
    due: 30_000,
    pending: 10_000,
    paid: 20_000,
  });
  expect(dash.monthRows.map((r) => r.dueDate)).toEqual([
    "2027-05-01",
    "2027-05-17",
  ]);
});
