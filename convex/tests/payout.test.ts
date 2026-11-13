import { describe, expect, test } from "vitest";
import { api } from "../_generated/api";
import { checkPayout } from "../lib/payout";
import {
  createAdmin,
  createStaffMember,
  errorCode,
  setupTest,
} from "./harness.test-utils";

const bank = {
  accountName: "Asha Rao",
  accountNumber: "1234 5678 9012",
  ifsc: "hdfc0001234",
  bankName: "HDFC Bank",
};

describe("payment details", () => {
  test("are checked and tidied", () => {
    expect(checkPayout({ upiId: " Asha@OKAXIS ", ...bank }, true)).toEqual({
      upiId: "asha@okaxis",
      accountName: "Asha Rao",
      accountNumber: "123456789012",
      ifsc: "HDFC0001234",
      bankName: "HDFC Bank",
    });
    expect(() => checkPayout({ upiId: "not-a-upi" }, true)).toThrow();
    expect(() => checkPayout({ accountNumber: "123456789" }, true)).toThrow(); // name and IFSC missing
    expect(() => checkPayout({}, true)).toThrow();
    expect(checkPayout({}, false)).toEqual({});
  });

  test("an admin sets them directly; they show where payments are made", async () => {
    const t = await setupTest("2027-04-20");
    const admin = await createAdmin(t);
    const s = await createStaffMember(t, admin, {
      name: "Asha Rao",
      joinDate: "2027-03-20",
    });
    await admin.as.mutation(api.people.setPayout, {
      staffId: s.staffId,
      details: { upiId: "asha@okaxis" },
    });
    const detail = (await admin.as.query(api.people.get, {
      staffId: s.staffId,
    }))!;
    expect(detail.profile.payout).toMatchObject({ upiId: "asha@okaxis" });
    expect(detail.schedule.paydays[0].payTo).toBe("UPI asha@okaxis");
    expect((await s.as.query(api.staff.profile, {})).payout).toMatchObject({
      upiId: "asha@okaxis",
    });
  });

  test("a staff member's change waits for an admin, who sees it flagged and approves or rejects it", async () => {
    const t = await setupTest("2027-04-20");
    const admin = await createAdmin(t);
    const s = await createStaffMember(t, admin, { name: "Asha Rao" });
    await admin.as.mutation(api.people.setPayout, {
      staffId: s.staffId,
      details: { upiId: "old@okaxis" },
    });

    await s.as.mutation(api.payoutRequests.submit, { details: bank });
    // Not in effect yet.
    expect((await s.as.query(api.staff.profile, {})).payout).toMatchObject({
      upiId: "old@okaxis",
    });
    expect(
      (await s.as.query(api.staff.profile, {})).payoutRequest,
    ).toMatchObject({ accountNumber: "123456789012" });
    // Flagged for the admin: staff list, dashboard, profile.
    expect((await admin.as.query(api.people.list, {}))[0].payoutPending).toBe(
      true,
    );
    expect(
      (await admin.as.query(api.dashboard.summary, {})).payoutApprovals.map(
        (p) => p.name,
      ),
    ).toEqual(["Asha Rao"]);

    await admin.as.mutation(api.people.approvePayout, { staffId: s.staffId });
    const after = (await admin.as.query(api.people.get, {
      staffId: s.staffId,
    }))!.profile;
    expect(after.payout).toMatchObject({
      accountNumber: "123456789012",
      ifsc: "HDFC0001234",
    });
    expect(after.payout?.upiId).toBeUndefined();
    expect(after.payoutRequest).toBeNull();
    expect((await admin.as.query(api.people.list, {}))[0].payoutPending).toBe(
      false,
    );

    // A second request, rejected: the approved details stay.
    await s.as.mutation(api.payoutRequests.submit, {
      details: { upiId: "new@ybl" },
    });
    await admin.as.mutation(api.people.rejectPayout, { staffId: s.staffId });
    const kept = await s.as.query(api.staff.profile, {});
    expect(kept.payout).toMatchObject({ accountNumber: "123456789012" });
    expect(kept.payoutRequest).toBeNull();
    expect(
      await errorCode(
        admin.as.mutation(api.people.approvePayout, { staffId: s.staffId }),
      ),
    ).toBe("CONFLICT");

    const actions = (
      await t.run((ctx) => ctx.db.query("auditLog").collect())
    ).map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        "staff.payout_requested",
        "staff.payout_approved",
        "staff.payout_rejected",
      ]),
    );
  });

  test("staff can only ask for their own; other organisations can't approve; invalid requests are refused", async () => {
    const t = await setupTest();
    const admin = await createAdmin(t);
    const s = await createStaffMember(t, admin);
    expect(
      await errorCode(
        s.as.mutation(api.payoutRequests.submit, { details: {} }),
      ),
    ).toBe("INVALID_INPUT");
    expect(
      await errorCode(
        admin.as.mutation(api.payoutRequests.submit, {
          details: { upiId: "x@ok" },
        }),
      ),
    ).toBe("FORBIDDEN");
    expect(
      await errorCode(
        s.as.mutation(api.people.approvePayout, { staffId: s.staffId }),
      ),
    ).toBe("FORBIDDEN");
    await s.as.mutation(api.payoutRequests.submit, {
      details: { upiId: "me@okaxis" },
    });
    const other = await createAdmin(t, "Other", "Org B");
    expect(
      await errorCode(
        other.as.mutation(api.people.approvePayout, { staffId: s.staffId }),
      ),
    ).toBe("NOT_FOUND");
    await s.as.mutation(api.payoutRequests.withdraw, {});
    expect((await s.as.query(api.staff.profile, {})).payoutRequest).toBeNull();
  });
});
