import { describe, expect, test } from "vitest";
import { api } from "../_generated/api";
import { createAdmin, createStaffMember, errorCode, setupTest, type T } from "./harness.test-utils";

type Client = Pick<T, "query" | "mutation" | "action">;

describe("admin functions refuse staff and signed-out callers", () => {
  test("queries", async () => {
    const t = await setupTest();
    const admin = await createAdmin(t);
    const staff = await createStaffMember(t, admin);
    const calls = [
      (c: Client) => c.query(api.people.list, {}),
      (c: Client) => c.query(api.people.get, { staffId: staff.staffId }),
      (c: Client) => c.query(api.paydays.overview, {}),
      (c: Client) => c.query(api.dashboard.summary, {}),
      (c: Client) => c.query(api.attendance.day, { date: "2027-04-20" }),
      (c: Client) => c.query(api.attendance.month, { staffId: staff.staffId, month: "2027-04" }),
      (c: Client) => c.query(api.attendance.log, {}),
    ];
    for (const call of calls) {
      expect(await errorCode(call(staff.as))).toBe("FORBIDDEN");
      expect(await errorCode(call(t))).toBe("NOT_SIGNED_IN");
      expect(await errorCode(call(admin.as))).toBe("NO_ERROR");
    }
  });

  test("mutations and actions", async () => {
    const t = await setupTest();
    const admin = await createAdmin(t);
    const staff = await createStaffMember(t, admin);
    const { staffId } = staff;
    const calls = [
      (c: Client) => c.mutation(api.attendance.saveDay, { date: "2027-04-20", entries: [{ staffId, status: "absent" }] }),
      (c: Client) => c.mutation(api.attendance.setOne, { staffId, date: "2027-04-20", status: "absent" }),
      (c: Client) =>
        c.mutation(api.adjustments.add, { staffId, type: "bonus", amount: 100, note: "x", date: "2027-04-20", paydayKey: `${staffId}:0` }),
      (c: Client) =>
        c.mutation(api.payments.record, { staffId, paydayKey: `${staffId}:0`, amount: 100, paidOn: "2027-04-20", mode: "cash" }),
      (c: Client) => c.mutation(api.people.setLastWorkingDay, { staffId, lastWorkingDay: "2027-04-25" }),
      (c: Client) => c.mutation(api.people.forfeitReserve, { staffId, reason: "Left without notice" }),
      (c: Client) => c.mutation(api.people.updateProfile, { staffId, name: "Hacker", department: "X" }),
      (c: Client) => c.action(api.people.resetPassword, { staffId }),
    ];
    for (const call of calls) expect(await errorCode(call(staff.as))).toBe("FORBIDDEN");
    const record = await t.run(async (ctx) => ctx.db.get(staffId));
    expect(record?.name).toBe("Test Staff");
    expect(record?.reserveStatus).toBe("held");
  });
});

describe("staff queries", () => {
  test("only ever describe the caller", async () => {
    const t = await setupTest();
    const admin = await createAdmin(t);
    const asha = await createStaffMember(t, admin, { name: "Asha Rao" });
    const ravi = await createStaffMember(t, admin, { name: "Ravi Kumar" });
    expect((await asha.as.query(api.staff.home, {})).name).toBe("Asha Rao");
    expect((await ravi.as.query(api.staff.home, {})).name).toBe("Ravi Kumar");
    expect((await ravi.as.query(api.staff.profile, {})).name).toBe("Ravi Kumar");
  });

  test("refuse admins and signed-out callers", async () => {
    const t = await setupTest();
    const admin = await createAdmin(t);
    expect(await errorCode(admin.as.query(api.staff.home, {}))).toBe("FORBIDDEN");
    expect(await errorCode(t.query(api.staff.home, {}))).toBe("NOT_SIGNED_IN");
  });
});
