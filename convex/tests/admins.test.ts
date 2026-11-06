import { describe, expect, test } from "vitest";
import { api } from "../_generated/api";
import {
  createAdmin,
  createStaffMember,
  errorCode,
  nextPhone,
  setupTest,
  signedInAs,
  type T,
} from "./harness.test-utils";

const signIn = (t: T, phone: string, password: string) =>
  t.action(api.auth.signIn, {
    provider: "phone-password",
    params: { phone, password },
  });

describe("adding admins", () => {
  test("a new admin gets a temporary password, must change it, then has full access to the same organisation", async () => {
    const t = await setupTest();
    const owner = await createAdmin(t, "Owner");
    const s = await createStaffMember(t, owner, { name: "Asha Rao" });
    const phone = nextPhone();
    const { userId, temporaryPassword } = await owner.as.action(
      api.admins.add,
      { name: "Priya Manager", phone },
    );
    expect(temporaryPassword).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}$/);
    expect(
      (await signIn(t, phone, temporaryPassword)).tokens?.token,
    ).toBeTruthy();

    const priya = await signedInAs(t, userId);
    const me = await priya.query(api.users.me, {});
    expect(me).toMatchObject({ role: "admin", mustChangePassword: true });
    expect(me?.organization?.name).toBe("Test Organisation");
    expect(await errorCode(priya.query(api.people.list, {}))).toBe(
      "PASSWORD_CHANGE_REQUIRED",
    );

    await priya.action(api.users.changePassword, {
      newPassword: "priya-own-pass-7",
    });
    expect((await priya.query(api.people.list, {})).map((r) => r.name)).toEqual(
      ["Asha Rao"],
    );
    expect(
      (await priya.query(api.people.get, { staffId: s.staffId }))?.profile.name,
    ).toBe("Asha Rao");

    const list = await owner.as.query(api.admins.list, {});
    expect(list.map((a) => [a.name, a.isYou, a.mustChangePassword])).toEqual([
      ["Owner", true, false],
      ["Priya Manager", false, false],
    ]);
  });

  test("a number already in use (admin or staff) is refused, and nothing is created", async () => {
    const t = await setupTest();
    const owner = await createAdmin(t);
    const s = await createStaffMember(t, owner);
    expect(
      await errorCode(
        owner.as.action(api.admins.add, { name: "Dup", phone: s.phone }),
      ),
    ).toBe("CONFLICT");
    expect(
      await errorCode(
        owner.as.action(api.admins.add, { name: "Dup", phone: owner.phone }),
      ),
    ).toBe("CONFLICT");
    expect(
      await errorCode(
        owner.as.action(api.admins.add, { name: "X", phone: "123" }),
      ),
    ).toBe("INVALID_PHONE");
    expect(await owner.as.query(api.admins.list, {})).toHaveLength(1);
  });

  test("staff can't add admins; admins of another organisation don't see or change yours", async () => {
    const t = await setupTest();
    const owner = await createAdmin(t, "Owner", "Org A");
    const s = await createStaffMember(t, owner);
    const other = await createAdmin(t, "Other", "Org B");
    expect(
      await errorCode(
        s.as.action(api.admins.add, { name: "Sneaky", phone: nextPhone() }),
      ),
    ).toBe("FORBIDDEN");
    expect(
      (await other.as.query(api.admins.list, {})).map((a) => a.name),
    ).toEqual(["Other"]);
    expect(
      await errorCode(
        other.as.mutation(api.admins.remove, { userId: owner.userId }),
      ),
    ).toBe("NOT_FOUND");
    expect(
      await errorCode(
        other.as.action(api.admins.resetPassword, { userId: owner.userId }),
      ),
    ).toBe("NOT_FOUND");
  });
});

describe("removing and resetting admins", () => {
  test("not yourself, never the last; a removed admin's login is gone", async () => {
    const t = await setupTest();
    const owner = await createAdmin(t, "Owner");
    expect(
      await errorCode(
        owner.as.mutation(api.admins.remove, { userId: owner.userId }),
      ),
    ).toBe("CONFLICT");
    const phone = nextPhone();
    const { userId, temporaryPassword } = await owner.as.action(
      api.admins.add,
      { name: "Priya", phone },
    );
    await owner.as.mutation(api.admins.remove, { userId });
    expect(await t.run((ctx) => ctx.db.get(userId))).toBeNull();
    expect(await errorCode(signIn(t, phone, temporaryPassword))).not.toBe(
      "NO_ERROR",
    );
    const actions = (
      await t.run((ctx) => ctx.db.query("auditLog").collect())
    ).map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining(["admin.added", "admin.removed"]),
    );
  });

  test("a reset gives a new temporary password and requires a change again", async () => {
    const t = await setupTest();
    const owner = await createAdmin(t, "Owner");
    const phone = nextPhone();
    const { userId } = await owner.as.action(api.admins.add, {
      name: "Priya",
      phone,
    });
    const priya = await signedInAs(t, userId);
    await priya.action(api.users.changePassword, {
      newPassword: "priya-own-pass-7",
    });
    expect(
      await errorCode(
        owner.as.action(api.admins.resetPassword, { userId: owner.userId }),
      ),
    ).toBe("CONFLICT");
    const { temporaryPassword } = await owner.as.action(
      api.admins.resetPassword,
      { userId },
    );
    expect(
      (await signIn(t, phone, temporaryPassword)).tokens?.token,
    ).toBeTruthy();
    expect(await errorCode(signIn(t, phone, "priya-own-pass-7"))).toBe(
      "SIGN_IN_FAILED",
    );
    expect(
      (await signedInAs(t, userId).then((c) => c.query(api.users.me, {})))
        ?.mustChangePassword,
    ).toBe(true);
  });
});
