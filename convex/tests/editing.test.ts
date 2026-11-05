import { describe, expect, test } from "vitest";
import { api } from "../_generated/api";
import { dayIndex } from "../lib/companyCalendar";
import {
  createAdmin,
  createStaffMember,
  errorCode,
  nextPhone,
  setupTest,
} from "./harness.test-utils";

async function setup(today = "2027-05-20") {
  const t = await setupTest(today);
  const admin = await createAdmin(t);
  const s = await createStaffMember(t, admin, {
    name: "Asha Rao",
    joinDate: "2027-03-20",
    payMode: "half_16day",
    monthlySalary: 30_000,
  });
  const detail = async () =>
    (await admin.as.query(api.people.get, { staffId: s.staffId }))!;
  return { t, admin, s, detail };
}

describe("editing every part of a profile", () => {
  test("mobile number: the login moves with it; a number in use is refused", async () => {
    const { t, admin, s, detail } = await setup();
    const other = await createStaffMember(t, admin, { name: "Ravi" });
    const base = {
      staffId: s.staffId,
      name: "Asha Rao",
      department: "Kitchen",
    };
    expect(
      await errorCode(
        admin.as.mutation(api.people.updateProfile, {
          ...base,
          phone: other.phone,
        }),
      ),
    ).toBe("CONFLICT");
    const fresh = nextPhone();
    await admin.as.mutation(api.people.updateProfile, {
      ...base,
      phone: fresh,
    });
    expect((await detail()).profile.phone).toBe(fresh);
    const login = await t.run(async (ctx) => ({
      user: await ctx.db.get(s.userId),
      accounts: await ctx.db
        .query("authAccounts")
        .withIndex("userIdAndProvider", (q) => q.eq("userId", s.userId))
        .collect(),
    }));
    expect(login.user?.phone).toBe(fresh);
    expect(login.accounts.map((a) => a.providerAccountId)).toEqual([fresh]);
  });

  test("joining date: moves the salary at joining; refused while money sits on paydays that would move", async () => {
    const { admin, s, detail } = await setup();
    const base = {
      staffId: s.staffId,
      name: "Asha Rao",
      department: "Kitchen",
    };
    const first = (await detail()).schedule.paydays[0];
    await admin.as.mutation(api.payments.record, {
      staffId: s.staffId,
      paydayKey: first.key,
      amount: 1_000,
      paidOn: "2027-04-20",
      mode: "cash",
    });
    expect(
      await errorCode(
        admin.as.mutation(api.people.updateProfile, {
          ...base,
          joinDate: "2027-03-22",
        }),
      ),
    ).toBe("CONFLICT");
    const paymentId = (await detail()).payments[0]._id;
    await admin.as.mutation(api.payments.remove, { paymentId });
    await admin.as.mutation(api.people.updateProfile, {
      ...base,
      joinDate: "2027-03-22",
    });
    const after = await detail();
    expect(after.profile.joinDate).toBe("2027-03-22");
    expect(after.terms[0].effectiveFromDate).toBe("2027-03-22");
    expect(after.schedule.reserve.startDate).toBe("2027-03-22");
  });

  test("salary rows: correct the amount and pay mode at joining, move or remove a later change", async () => {
    const { admin, s, detail } = await setup("2027-04-20");
    const join = (await detail()).terms[0];
    await admin.as.mutation(api.people.editTerms, {
      termsId: join.termsId,
      monthlySalary: 32_000,
      payMode: "half_16day",
    });
    expect((await detail()).schedule.paydays[0].net).toBe(16_000);

    await admin.as.mutation(api.people.reviseTerms, {
      staffId: s.staffId,
      effectiveFromIndex: dayIndex(2027, 5, 2),
      monthlySalary: 36_000,
      payMode: "half_16day",
    });
    const revision = (await detail()).terms[1];
    expect(revision.startOptions.map((o) => o.date).slice(0, 2)).toEqual([
      "2027-03-30",
      "2027-04-16",
    ]);
    // Not a cycle's first day.
    expect(
      await errorCode(
        admin.as.mutation(api.people.editTerms, {
          termsId: revision.termsId,
          monthlySalary: 36_000,
          payMode: "half_16day",
          effectiveFromIndex: dayIndex(2027, 4, 20),
        }),
      ),
    ).toBe("INVALID_DATE");
    await admin.as.mutation(api.people.editTerms, {
      termsId: revision.termsId,
      monthlySalary: 40_000,
      payMode: "half_16day",
      effectiveFromIndex: dayIndex(2027, 4, 16),
    });
    const moved = await detail();
    expect(moved.terms[1].effectiveFromDate).toBe("2027-04-16");
    expect(
      moved.schedule.paydays.find((p) => p.dueDate === "2027-05-01")!.net,
    ).toBe(20_000);

    expect(
      await errorCode(
        admin.as.mutation(api.people.deleteTerms, { termsId: join.termsId }),
      ),
    ).toBe("CONFLICT");
    await admin.as.mutation(api.people.deleteTerms, {
      termsId: revision.termsId,
    });
    expect((await detail()).terms).toHaveLength(1);
  });

  test("changing the pay mode at joining is refused if a later change would no longer start on a cycle", async () => {
    const { admin, s, detail } = await setup("2027-04-20");
    await admin.as.mutation(api.people.reviseTerms, {
      staffId: s.staffId,
      effectiveFromIndex: dayIndex(2027, 5, 2),
      monthlySalary: 36_000,
      payMode: "half_16day",
    });
    const join = (await detail()).terms[0];
    expect(
      await errorCode(
        admin.as.mutation(api.people.editTerms, {
          termsId: join.termsId,
          monthlySalary: 30_000,
          payMode: "monthly_10th",
        }),
      ),
    ).toBe("INVALID_DATE");
  });
});

describe("deleting a staff member", () => {
  test("needs their name; removes the login and every record; another organisation can't", async () => {
    const { t, admin, s, detail } = await setup();
    await admin.as.mutation(api.attendance.setOne, {
      staffId: s.staffId,
      date: "2027-05-01",
      status: "absent",
    });
    const key = (await detail()).schedule.paydays[0].key;
    await admin.as.mutation(api.payments.record, {
      staffId: s.staffId,
      paydayKey: key,
      amount: 500,
      paidOn: "2027-05-01",
      mode: "cash",
    });

    const other = await createAdmin(t, "Owner B", "Org B");
    expect(
      await errorCode(
        other.as.mutation(api.people.deleteStaff, {
          staffId: s.staffId,
          confirmName: "Asha Rao",
        }),
      ),
    ).toBe("NOT_FOUND");
    expect(
      await errorCode(
        admin.as.mutation(api.people.deleteStaff, {
          staffId: s.staffId,
          confirmName: "Asha",
        }),
      ),
    ).toBe("INVALID_INPUT");
    await admin.as.mutation(api.people.deleteStaff, {
      staffId: s.staffId,
      confirmName: "asha rao",
    });

    const left = await t.run(async (ctx) => ({
      staff: await ctx.db.get(s.staffId),
      user: await ctx.db.get(s.userId),
      terms: await ctx.db.query("salaryTerms").collect(),
      attendance: await ctx.db.query("attendance").collect(),
      payments: await ctx.db.query("payments").collect(),
      accounts: await ctx.db
        .query("authAccounts")
        .withIndex("userIdAndProvider", (q) => q.eq("userId", s.userId))
        .collect(),
      sessions: await ctx.db
        .query("authSessions")
        .withIndex("userId", (q) => q.eq("userId", s.userId))
        .collect(),
      audit: (await ctx.db.query("auditLog").collect()).filter(
        (a) => a.action === "staff.deleted",
      ),
    }));
    expect(left.staff).toBeNull();
    expect(left.user).toBeNull();
    expect(
      [
        left.terms,
        left.attendance,
        left.payments,
        left.accounts,
        left.sessions,
      ].map((x) => x.length),
    ).toEqual([0, 0, 0, 0, 0]);
    expect(left.audit[0].metadata).toMatchObject({ name: "Asha Rao" });
    expect(await admin.as.query(api.people.list, {})).toEqual([]);
    expect((await admin.as.query(api.attendance.log, {}))[0].staffName).toBe(
      "Deleted staff member",
    );
    expect(await errorCode(s.as.query(api.staff.home, {}))).not.toBe(
      "NO_ERROR",
    );
  });
});
