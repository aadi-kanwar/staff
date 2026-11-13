import { expect, test } from "vitest";
import { api, internal } from "../_generated/api";
import {
  createAdmin,
  createStaffMember,
  errorCode,
  setupTest,
} from "./harness.test-utils";

test("past payments are records only: one breakdown, on the calendars, never in the balance", async () => {
  const t = await setupTest("2027-06-20");
  const admin = await createAdmin(t);
  const s = await createStaffMember(t, admin, {
    name: "Asha",
    joinDate: "2027-03-20",
    payMode: "half_16day",
  });
  const before = (await admin.as.query(api.people.get, {
    staffId: s.staffId,
  }))!;

  // Salary + bonus − deduction in one record; any dates (even before joining, even reversed).
  await admin.as.mutation(api.pastRecords.add, {
    staffId: s.staffId,
    from: "2027-04-15",
    to: "2027-03-30",
    salary: 15_000,
    bonus: 1_000,
    deduction: 500,
    paidOn: "2027-04-16",
    mode: "upi",
    note: "March salary",
  });
  await admin.as.mutation(api.pastRecords.add, {
    staffId: s.staffId,
    from: "2027-01-20",
    to: "2027-02-19",
    salary: 12_000,
  });

  const after = (await admin.as.query(api.people.get, { staffId: s.staffId }))!;
  expect(after.pastRecords.every((r) => !r.converted)).toBe(true);
  expect(
    after.pastRecords.map((r) => [
      r.from,
      r.to,
      r.salary,
      r.bonus,
      r.deduction,
      r.total,
    ]),
  ).toEqual([
    ["2027-01-20", "2027-02-19", 12_000, 0, 0, 12_000],
    ["2027-03-30", "2027-04-15", 15_000, 1_000, 500, 15_500],
  ]);
  // Nothing about pay changes: no payments, same paydays and balance, same monthly totals.
  expect(after.payments).toEqual([]);
  expect(after.schedule.pending).toBe(before.schedule.pending);
  expect(after.schedule.paydays.map((p) => p.outstanding)).toEqual(
    before.schedule.paydays.map((p) => p.outstanding),
  );
  expect(
    (
      await admin.as.query(api.paydays.range, {
        from: "2027-04-01",
        to: "2027-04-30",
      })
    ).month.paid,
  ).toBe(0);

  // The staff member sees them on the calendar and in their payment history, outside the totals.
  const cal = await s.as.query(api.staff.payCalendar, {});
  expect(cal.pastRecords).toEqual([
    { from: "2027-01-20", to: "2027-02-19", total: 12_000 },
    { from: "2027-03-30", to: "2027-04-15", total: 15_500 },
  ]);
  const history = await s.as.query(api.staff.payments, {});
  expect(history.pastRecords.map((r) => [r.total, r.method, r.note])).toEqual([
    [15_500, "UPI", "March salary"],
    [12_000, null, null],
  ]);
  expect(history.totalPaid).toBe(0);

  expect(
    await errorCode(
      admin.as.mutation(api.pastRecords.add, {
        staffId: s.staffId,
        from: "2027-01-01",
        to: "2027-01-31",
        salary: 0,
      }),
    ),
  ).toBe("INVALID_INPUT");
  const other = await createAdmin(t, "Other", "Org B");
  const recordId = after.pastRecords[0].recordId;
  expect(
    await errorCode(other.as.mutation(api.pastRecords.remove, { recordId })),
  ).toBe("NOT_FOUND");
  await admin.as.mutation(api.pastRecords.remove, { recordId });
  expect(
    (await admin.as.query(api.people.get, { staffId: s.staffId }))!.pastRecords,
  ).toHaveLength(1);
});

test("entries saved the earlier way (payments / adjustments on paydays) become records and leave the balance", async () => {
  const t = await setupTest("2027-06-20");
  const admin = await createAdmin(t);
  const s = await createStaffMember(t, admin, {
    name: "Asha",
    joinDate: "2027-03-20",
    payMode: "half_16day",
  });
  const detail = (await admin.as.query(api.people.get, {
    staffId: s.staffId,
  }))!;
  const [p1, p2] = detail.schedule.paydays;
  await t.run(async (ctx) => {
    const at = 1_000;
    const common = {
      staffId: s.staffId,
      paidOn: "2027-05-05",
      mode: "cash" as const,
      periodFrom: "2027-03-30",
      periodTo: "2027-05-01",
      recordedAt: at,
    };
    await ctx.db.insert("payments", {
      ...common,
      paydayKey: p1.key,
      amount: 15_000,
      note: "Past payment",
    });
    await ctx.db.insert("payments", {
      ...common,
      paydayKey: p2.key,
      amount: 5_000,
      note: "Past payment",
    });
    // A bonus "already paid" (adjustment + payment saved together) and a deduction.
    const bonus = {
      staffId: s.staffId,
      periodFrom: "2027-05-02",
      periodTo: "2027-05-17",
      createdAt: 2_000,
    };
    await ctx.db.insert("adjustments", {
      ...bonus,
      type: "bonus",
      amount: 500,
      note: "Diwali",
      date: "2027-05-17",
      paydayKey: p2.key,
    });
    await ctx.db.insert("payments", {
      staffId: s.staffId,
      paydayKey: p2.key,
      amount: 500,
      paidOn: "2027-05-17",
      mode: "upi",
      periodFrom: "2027-05-02",
      periodTo: "2027-05-17",
      recordedAt: 2_000,
    });
    await ctx.db.insert("adjustments", {
      staffId: s.staffId,
      type: "deduction",
      amount: 200,
      note: "Breakage",
      date: "2027-03-22",
      paydayKey: `${s.staffId}:past`,
      periodFrom: "2027-03-20",
      periodTo: "2027-03-22",
      createdAt: 3_000,
    });
    // An ordinary payment stays as it is.
    await ctx.db.insert("payments", {
      staffId: s.staffId,
      paydayKey: p1.key,
      amount: 100,
      paidOn: "2027-04-15",
      mode: "cash",
      recordedAt: 4_000,
    });
  });

  expect(await t.mutation(internal.migrations.convertPastEntries, {})).toEqual({
    records: 3,
  });
  expect(await t.mutation(internal.migrations.convertPastEntries, {})).toEqual({
    records: 0,
  });
  const after = (await admin.as.query(api.people.get, { staffId: s.staffId }))!;
  expect(
    after.pastRecords.map((r) => [
      r.from,
      r.salary,
      r.bonus,
      r.deduction,
      r.paidOn,
      r.mode,
    ]),
  ).toEqual([
    ["2027-03-20", 0, 0, 200, null, null],
    ["2027-03-30", 20_000, 0, 0, "2027-05-05", "cash"],
    ["2027-05-02", 0, 500, 0, "2027-05-17", "upi"],
  ]);
  expect(after.payments.map((p) => p.amount)).toEqual([100]);
  // Converted records are listed for the admin (marked), but not shown on calendars or to the staff member.
  expect(after.pastRecords.every((r) => r.converted)).toBe(true);
  expect((await s.as.query(api.staff.payCalendar, {})).pastRecords).toEqual([]);
  expect((await s.as.query(api.staff.payments, {})).pastRecords).toEqual([]);
  // One created with "Record a past payment" does show.
  await admin.as.mutation(api.pastRecords.add, {
    staffId: s.staffId,
    from: "2027-02-01",
    to: "2027-02-28",
    salary: 9_000,
  });
  expect((await s.as.query(api.staff.payCalendar, {})).pastRecords).toEqual([
    { from: "2027-02-01", to: "2027-02-28", total: 9_000 },
  ]);
  expect(await t.run((ctx) => ctx.db.query("adjustments").collect())).toEqual(
    [],
  );
});
