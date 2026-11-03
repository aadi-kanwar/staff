import { describe, expect, test } from "vitest";
import { api } from "../_generated/api";
import { dayIndex } from "../lib/companyCalendar";
import { createAdmin, createStaffMember, errorCode, setToday, setupTest } from "./harness.test-utils";

describe("attendance", () => {
  test("bulk save logs every change (old → new, who, when) and skips unchanged marks", async () => {
    const t = await setupTest("2027-04-20");
    const admin = await createAdmin(t);
    const a = await createStaffMember(t, admin, { name: "Asha Rao" });
    const b = await createStaffMember(t, admin, { name: "Ravi Kumar" });
    const grid = await admin.as.query(api.attendance.day, { date: "2027-04-20" });
    expect(grid.rows.map((r) => [r.name, r.status])).toEqual([
      ["Asha Rao", null],
      ["Ravi Kumar", null],
    ]);
    await admin.as.mutation(api.attendance.saveDay, {
      date: "2027-04-20",
      entries: [
        { staffId: a.staffId, status: "present" },
        { staffId: b.staffId, status: "present" },
      ],
    });
    const second = await admin.as.mutation(api.attendance.saveDay, {
      date: "2027-04-20",
      entries: [
        { staffId: a.staffId, status: "present" },
        { staffId: b.staffId, status: "absent" },
      ],
    });
    expect(second.changed).toBe(1);
    const log = await admin.as.query(api.attendance.log, {});
    expect(log.map((l) => [l.staffName, l.oldStatus, l.newStatus, l.changedByName])).toEqual([
      ["Ravi Kumar", "present", "absent", "Test Admin"],
      ["Ravi Kumar", null, "present", "Test Admin"],
      ["Asha Rao", null, "present", "Test Admin"],
    ]);
    const marks = await t.run((ctx) => ctx.db.query("attendance").collect());
    expect(marks).toHaveLength(2);
  });

  test("absences flow into the payday; the 31st is recorded but not counted", async () => {
    const t = await setupTest("2027-04-20");
    const admin = await createAdmin(t);
    const s = await createStaffMember(t, admin);
    for (const date of ["2027-04-03", "2027-04-09", "2027-03-31"]) {
      await admin.as.mutation(api.attendance.setOne, { staffId: s.staffId, date, status: "absent" });
    }
    const detail = await admin.as.query(api.people.get, { staffId: s.staffId });
    const april = detail.schedule.paydays.find((p) => p.dueDate === "2027-04-15")!;
    expect(april.net).toBe(13_125);
    const month = await admin.as.query(api.attendance.month, { staffId: s.staffId, month: "2027-03" });
    expect(month.days.find((d) => d.date === "2027-03-31")).toMatchObject({ status: "absent", countsForPay: false });
  });

  test("people can't be marked before they joined", async () => {
    const t = await setupTest("2027-04-20");
    const admin = await createAdmin(t);
    const s = await createStaffMember(t, admin);
    expect(await errorCode(admin.as.mutation(api.attendance.setOne, { staffId: s.staffId, date: "2027-03-01", status: "present" }))).toBe(
      "INVALID_DATE",
    );
  });
});

describe("adjustments and payments", () => {
  test("advance + bonus change the next payday; a partial payment leaves the rest pending", async () => {
    const t = await setupTest("2027-04-10");
    const admin = await createAdmin(t);
    const s = await createStaffMember(t, admin);
    const detail = await admin.as.query(api.people.get, { staffId: s.staffId });
    const target = detail.defaultAdjustmentTarget!;
    expect(target).toBe(`${s.staffId}:${dayIndex(2027, 4, 15)}`);
    await admin.as.mutation(api.adjustments.add, { staffId: s.staffId, type: "advance", amount: 2_000, note: "Rent", date: "2027-04-10", paydayKey: target });
    await admin.as.mutation(api.adjustments.add, { staffId: s.staffId, type: "bonus", amount: 500, note: "Good work", date: "2027-04-10", paydayKey: target });
    expect((await admin.as.query(api.people.get, { staffId: s.staffId })).schedule.next!.net).toBe(13_500);

    setToday("2027-04-15");
    await admin.as.mutation(api.payments.record, { staffId: s.staffId, paydayKey: target, amount: 10_000, paidOn: "2027-04-15", mode: "upi" });
    const after = await admin.as.query(api.people.get, { staffId: s.staffId });
    expect(after.schedule.paydays[0].status).toBe("partially_paid");
    expect(after.schedule.pending).toBe(3_500);
    expect(
      await errorCode(admin.as.mutation(api.payments.record, { staffId: s.staffId, paydayKey: target, amount: 4_000, paidOn: "2027-04-15", mode: "cash" })),
    ).toBe("INVALID_INPUT");
    const home = await s.as.query(api.staff.home, {});
    expect(home.pending).toBe(3_500);
    const overview = await admin.as.query(api.paydays.overview, {});
    expect(overview.rows.find((r) => r.key === target)?.outstanding).toBe(3_500);
  });

  test("several payments at once are all-or-nothing", async () => {
    const t = await setupTest("2027-05-03");
    const admin = await createAdmin(t);
    const s = await createStaffMember(t, admin);
    const [apr, may] = [dayIndex(2027, 4, 15), dayIndex(2027, 5, 1)].map((i) => `${s.staffId}:${i}`);
    const item = (paydayKey: string, amount: number) => ({ staffId: s.staffId, paydayKey, amount, paidOn: "2027-05-03", mode: "bank" as const });
    expect(await errorCode(admin.as.mutation(api.payments.recordMany, { items: [item(apr, 15_000), item(may, 20_000)] }))).toBe("INVALID_INPUT");
    expect(await t.run((ctx) => ctx.db.query("payments").collect())).toHaveLength(0);
    await admin.as.mutation(api.payments.recordMany, { items: [item(apr, 15_000), item(may, 15_000)] });
    expect((await admin.as.query(api.people.get, { staffId: s.staffId })).schedule.pending).toBe(0);
  });
});

describe("salary revisions", () => {
  test("only cycle starts are accepted; the revision applies from that cycle", async () => {
    const t = await setupTest("2027-04-20");
    const admin = await createAdmin(t);
    const s = await createStaffMember(t, admin);
    const detail = await admin.as.query(api.people.get, { staffId: s.staffId });
    expect(detail.revisionOptions.map((o) => o.date).slice(0, 3)).toEqual(["2027-05-02", "2027-05-18", "2027-06-04"]);
    expect(
      await errorCode(
        admin.as.mutation(api.people.reviseTerms, { staffId: s.staffId, effectiveFromIndex: dayIndex(2027, 5, 3), monthlySalary: 36_000, payMode: "half_16day" }),
      ),
    ).toBe("INVALID_DATE");
    await admin.as.mutation(api.people.reviseTerms, {
      staffId: s.staffId,
      effectiveFromIndex: dayIndex(2027, 5, 2),
      monthlySalary: 36_000,
      payMode: "half_16day",
    });
    const after = await admin.as.query(api.people.get, { staffId: s.staffId });
    expect(after.schedule.paydays.find((p) => p.dueDate === "2027-05-17")!.net).toBe(18_000);
    expect(after.schedule.reserve.amount).toBe(10_000);
    expect(after.terms).toHaveLength(2);
    const audit = await t.run((ctx) => ctx.db.query("auditLog").collect());
    expect(audit.map((a) => a.action)).toContain("salary.revised");
    const future = after.terms.find((r) => r.isFuture)!;
    expect(future.canCancel).toBe(true);
    await admin.as.mutation(api.people.cancelRevision, { termsId: future.termsId });
    expect((await admin.as.query(api.people.get, { staffId: s.staffId })).terms).toHaveLength(1);
  });

  test("a mode change A → B is logged as a mode change", async () => {
    const t = await setupTest("2027-05-05");
    const admin = await createAdmin(t);
    const s = await createStaffMember(t, admin);
    await admin.as.mutation(api.people.reviseTerms, {
      staffId: s.staffId,
      effectiveFromIndex: dayIndex(2027, 5, 18),
      monthlySalary: 30_000,
      payMode: "monthly_10th",
    });
    const after = await admin.as.query(api.people.get, { staffId: s.staffId });
    const june = after.schedule.paydays.find((p) => p.dueDate === "2027-06-10")!;
    expect([june.cycleStartDate, june.cycleEndDate, june.net]).toEqual(["2027-05-18", "2027-05-30", 13_000]);
    const audit = await t.run((ctx) => ctx.db.query("auditLog").collect());
    expect(audit.map((a) => a.action)).toContain("salary.mode_changed");
  });
});

describe("exit and final settlement", () => {
  test("pro-rated final cycle + pending + reserve, then exited with read-only access", async () => {
    const t = await setupTest("2027-04-15");
    const admin = await createAdmin(t);
    const s = await createStaffMember(t, admin);
    await admin.as.mutation(api.payments.record, {
      staffId: s.staffId,
      paydayKey: `${s.staffId}:${dayIndex(2027, 4, 15)}`,
      amount: 15_000,
      paidOn: "2027-04-15",
      mode: "cash",
    });
    setToday("2027-05-11");
    await admin.as.mutation(api.people.setLastWorkingDay, { staffId: s.staffId, lastWorkingDay: "2027-05-10" });
    const detail = await admin.as.query(api.people.get, { staffId: s.staffId });
    expect(detail.schedule.settlement!.totalOutstanding).toBe(15_000 + 8_438 + 10_000);
    const result = await admin.as.mutation(api.people.confirmSettlement, { staffId: s.staffId, paidOn: "2027-05-11", mode: "bank" });
    expect(result.totalPaid).toBe(33_438);
    const record = await t.run((ctx) => ctx.db.get(s.staffId));
    expect(record?.status).toBe("exited");
    expect(record?.reserveStatus).toBe("released");
    const home = await s.as.query(api.staff.home, {});
    expect(home.status).toBe("exited");
    expect(home.pending).toBe(0);
    expect((await s.as.query(api.staff.payments, {})).paydays[0].title).toBe("Final settlement");
    expect(await errorCode(admin.as.mutation(api.people.updateProfile, { staffId: s.staffId, name: "X Y", department: "Z" }))).toBe(
      "NO_ERROR",
    );
    expect(await errorCode(admin.as.mutation(api.attendance.setOne, { staffId: s.staffId, date: "2027-05-05", status: "absent" }))).toBe(
      "CONFLICT",
    );
  });

  test("forfeiting needs a reason and removes the reserve from the settlement", async () => {
    const t = await setupTest("2027-05-11");
    const admin = await createAdmin(t);
    const s = await createStaffMember(t, admin);
    await admin.as.mutation(api.people.setLastWorkingDay, { staffId: s.staffId, lastWorkingDay: "2027-05-10" });
    expect(await errorCode(admin.as.mutation(api.people.forfeitReserve, { staffId: s.staffId, reason: "" }))).toBe("INVALID_INPUT");
    await admin.as.mutation(api.people.forfeitReserve, { staffId: s.staffId, reason: "Left without notice" });
    const detail = await admin.as.query(api.people.get, { staffId: s.staffId });
    expect(detail.schedule.settlement!.reserveAmount).toBe(0);
    expect(detail.schedule.settlement!.totalOutstanding).toBe(15_000 + 15_000 + 8_438);
    const audit = await t.run((ctx) => ctx.db.query("auditLog").collect());
    expect(audit.find((a) => a.action === "reserve.forfeited")?.metadata).toEqual({ reason: "Left without notice" });
  });
});

describe("existing staff onboarding", () => {
  test("paydays up to 'Paid up to' are marked paid (mode opening); an opening balance lands on the next one", async () => {
    const t = await setupTest("2026-11-03");
    const admin = await createAdmin(t);
    const preview = await admin.as.query(api.people.previewOpening, { joinDate: "2026-09-14", monthlySalary: 30_000, payMode: "half_16day" });
    if (!Array.isArray(preview)) {
      // Join 14 Sep → earning from 24 Sep → paydays 10 Oct, 26 Oct (both already passed); next 12 Nov.
      expect(preview.past.map((p) => p.date)).toEqual(["2026-10-25", "2026-10-09"]);
      expect(preview.next?.date).toBe("2026-11-11");
      const s = await createStaffMember(t, admin, {
        joinDate: "2026-09-14",
        paidUpToIndex: preview.past[1].paydayIndex,
        opening: { type: "advance", amount: 1_000, note: "Advance given in October" },
      });
      const detail = await admin.as.query(api.people.get, { staffId: s.staffId });
      expect(detail.payments.map((p) => [p.mode, p.amount, p.paidOn])).toEqual([["opening", 15_000, "2026-10-09"]]);
      expect(detail.schedule.pending).toBe(14_000); // 26 Oct still owed, less the opening advance
      expect(detail.adjustments[0].paydayDate).toBe("2026-10-25");
      expect(detail.schedule.paydays.find((p) => p.dueDate === "2026-10-25")!.net).toBe(14_000);
    } else {
      throw new Error("preview should not be empty");
    }
  });
});
