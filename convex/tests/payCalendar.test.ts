import { expect, test } from "vitest";
import { api } from "../_generated/api";
import {
  createAdmin,
  createStaffMember,
  setupTest,
} from "./harness.test-utils";

test("the staff Home calendar marks periods paid, pending, current and upcoming", async () => {
  const t = await setupTest("2027-04-20");
  const admin = await createAdmin(t);
  const s = await createStaffMember(t, admin, {
    joinDate: "2027-03-20",
    payMode: "half_16day",
  });

  const before = await s.as.query(api.staff.payCalendar, {});
  expect(before.reserve.period).toEqual({
    from: "2027-03-20",
    to: "2027-03-29",
  });
  expect(
    before.periods
      .slice(0, 4)
      .map((p) => [p.period.from, p.period.to, p.date, p.state]),
  ).toEqual([
    ["2027-03-30", "2027-04-15", "2027-04-15", "pending"],
    ["2027-04-16", "2027-05-01", "2027-05-01", "current"],
    ["2027-05-02", "2027-05-17", "2027-05-17", "upcoming"],
    ["2027-05-18", "2027-06-03", "2027-06-03", "upcoming"],
  ]);
  expect(before.pending).toBe(15_000);

  const key = (await admin.as.query(api.people.get, { staffId: s.staffId }))
    .schedule.paydays[0].key;
  await admin.as.mutation(api.payments.record, {
    staffId: s.staffId,
    paydayKey: key,
    amount: 5_000,
    paidOn: "2027-04-20",
    mode: "cash",
  });
  expect(
    (await s.as.query(api.staff.payCalendar, {})).periods[0],
  ).toMatchObject({ state: "pending", remaining: 10_000 });
  await admin.as.mutation(api.payments.record, {
    staffId: s.staffId,
    paydayKey: key,
    amount: 10_000,
    paidOn: "2027-04-20",
    mode: "cash",
  });
  const after = await s.as.query(api.staff.payCalendar, {});
  expect(after.periods[0]).toMatchObject({ state: "paid", remaining: 0 });
  expect(after.pending).toBe(0);
});

test("absent and half days are on the calendar; anything owed comes first in both payday lists", async () => {
  const t = await setupTest("2027-05-20");
  const admin = await createAdmin(t);
  const s = await createStaffMember(t, admin, {
    joinDate: "2027-03-20",
    payMode: "half_16day",
  });
  await admin.as.mutation(api.attendance.setOne, {
    staffId: s.staffId,
    date: "2027-04-03",
    status: "absent",
  });
  await admin.as.mutation(api.attendance.setOne, {
    staffId: s.staffId,
    date: "2027-04-05",
    status: "half_day",
  });
  await admin.as.mutation(api.attendance.setOne, {
    staffId: s.staffId,
    date: "2027-04-06",
    status: "present",
  });
  const cal = await s.as.query(api.staff.payCalendar, {});
  expect(cal.absences).toEqual([
    { date: "2027-04-03", kind: "absent" },
    { date: "2027-04-05", kind: "half_day" },
  ]);
  // The admin's Paydays tab gets the same absences for its calendar.
  expect(
    (await admin.as.query(api.people.get, { staffId: s.staffId })).absences,
  ).toEqual(cal.absences);

  // Paydays 15 Apr, 1 May, 17 May have passed. Pay 1 May only: 15 Apr and 17 May are still owed.
  const detail = await admin.as.query(api.people.get, { staffId: s.staffId });
  const may1 = detail.schedule.paydays.find((p) => p.dueDate === "2027-05-01")!;
  await admin.as.mutation(api.payments.record, {
    staffId: s.staffId,
    paydayKey: may1.key,
    amount: may1.net,
    paidOn: "2027-05-01",
    mode: "upi",
  });
  const list = await s.as.query(api.staff.payments, {});
  expect(list.paydays.map((p) => [p.date, p.remaining > 0])).toEqual([
    ["2027-04-15", true],
    ["2027-05-17", true],
    ["2027-06-03", true],
    ["2027-05-01", false],
  ]);
});
