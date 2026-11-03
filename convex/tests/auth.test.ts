import { describe, expect, test } from "vitest";
import { api, internal } from "../_generated/api";
import { FAILED_ATTEMPTS_LIMIT } from "../authLimits";
import {
  PASSWORD,
  createAdmin,
  errorCode,
  nextPhone,
  setupTest,
  signedInAs,
  type T,
} from "./harness.test-utils";

const signIn = (
  t: T,
  phone: string,
  password: string,
  extra: Record<string, string> = {},
) =>
  t.action(api.auth.signIn, {
    provider: "phone-password",
    params: { phone, password, ...extra },
  });

describe("first admin", () => {
  test("is created once from the CLI and can sign in with a normalised number", async () => {
    const t = await setupTest();
    await t.action(internal.setup.createFirstAdmin, {
      phone: "98765 43210",
      password: PASSWORD,
      name: "Owner",
    });
    const users = await t.run((ctx) => ctx.db.query("users").collect());
    expect(users.map((u) => [u.phone, u.role, u.name])).toEqual([
      ["+919876543210", "admin", "Owner"],
    ]);
    for (const written of ["9876543210", "+91 98765-43210", "09876543210"]) {
      expect(
        (await signIn(t, written, PASSWORD)).tokens?.token,
        written,
      ).toBeTruthy();
    }
    expect(
      await errorCode(
        t.action(internal.setup.createFirstAdmin, {
          phone: "9123456780",
          password: PASSWORD,
          name: "Other",
        }),
      ),
    ).toBe("CONFLICT");
  });

  test("can come from environment variables", async () => {
    const t = await setupTest();
    process.env.FIRST_ADMIN_PHONE = "9876500000";
    process.env.FIRST_ADMIN_PASSWORD = PASSWORD;
    process.env.FIRST_ADMIN_NAME = "Env Owner";
    try {
      await t.action(internal.setup.createFirstAdmin, {});
    } finally {
      delete process.env.FIRST_ADMIN_PHONE;
      delete process.env.FIRST_ADMIN_PASSWORD;
      delete process.env.FIRST_ADMIN_NAME;
    }
    const admin = await t.run((ctx) => ctx.db.query("users").first());
    expect(admin?.phone).toBe("+919876500000");
    expect(admin?.role).toBe("admin");
  });
});

describe("sign-in", () => {
  test("there is no self sign-up", async () => {
    const t = await setupTest();
    expect(
      await errorCode(signIn(t, "9876543210", PASSWORD, { flow: "signUp" })),
    ).toBe("FORBIDDEN");
    expect(await t.run((ctx) => ctx.db.query("users").collect())).toHaveLength(
      0,
    );
  });

  test("wrong password and unknown number give the same error", async () => {
    const t = await setupTest();
    await t.action(internal.setup.createFirstAdmin, {
      phone: "9876543210",
      password: PASSWORD,
      name: "Owner",
    });
    expect(await errorCode(signIn(t, "9876543210", "wrong-password"))).toBe(
      "SIGN_IN_FAILED",
    );
    expect(await errorCode(signIn(t, "9123456780", PASSWORD))).toBe(
      "SIGN_IN_FAILED",
    );
  });

  test("too many failed attempts lock the number for a while", async () => {
    const t = await setupTest();
    for (let i = 0; i < FAILED_ATTEMPTS_LIMIT; i += 1)
      await errorCode(signIn(t, "9123456780", "nope-nope-1"));
    expect(await errorCode(signIn(t, "9123456780", PASSWORD))).toBe(
      "TOO_MANY_ATTEMPTS",
    );
  });
});

describe("staff accounts", () => {
  test("an admin creates the account; staff must change the password at first login", async () => {
    const t = await setupTest();
    const admin = await createAdmin(t);
    const phone = nextPhone();
    const { staffId } = await admin.as.action(api.people.create, {
      propertyId: admin.propertyId,
      name: "Ravi Kumar",
      phone,
      department: "Kitchen",
      joinDate: "2027-03-20",
      monthlySalary: 30_000,
      payMode: "half_16day",
      reserveStatus: "held",
      initialPassword: PASSWORD,
    });
    expect((await signIn(t, phone, PASSWORD)).tokens?.token).toBeTruthy();
    const userId = await t.run(
      async (ctx) => (await ctx.db.get(staffId))!.userId,
    );
    const staff = await signedInAs(t, userId);
    expect((await staff.query(api.users.me, {}))?.mustChangePassword).toBe(
      true,
    );
    expect(await errorCode(staff.query(api.staff.home, {}))).toBe(
      "PASSWORD_CHANGE_REQUIRED",
    );
    await staff.action(api.users.changePassword, {
      newPassword: "my-own-secret-9",
    });
    expect((await staff.query(api.users.me, {}))?.mustChangePassword).toBe(
      false,
    );
    expect((await staff.query(api.staff.home, {})).name).toBe("Ravi Kumar");
    expect(
      (await signIn(t, phone, "my-own-secret-9")).tokens?.token,
    ).toBeTruthy();
    expect(await errorCode(signIn(t, phone, PASSWORD))).toBe("SIGN_IN_FAILED");
  });

  test("the same number can't be added twice", async () => {
    const t = await setupTest();
    const admin = await createAdmin(t);
    const args = {
      propertyId: admin.propertyId,
      name: "Ravi Kumar",
      phone: "9876543210",
      department: "Kitchen",
      joinDate: "2027-03-20",
      monthlySalary: 30_000,
      payMode: "half_16day" as const,
      reserveStatus: "held" as const,
      initialPassword: PASSWORD,
    };
    await admin.as.action(api.people.create, args);
    expect(
      await errorCode(
        admin.as.action(api.people.create, { ...args, name: "Someone Else" }),
      ),
    ).toBe("CONFLICT");
    expect(await t.run((ctx) => ctx.db.query("staff").collect())).toHaveLength(
      1,
    );
  });

  test("admin password reset gives a temporary password and signs the person out", async () => {
    const t = await setupTest();
    const admin = await createAdmin(t);
    const phone = nextPhone();
    const { staffId } = await admin.as.action(api.people.create, {
      propertyId: admin.propertyId,
      name: "Ravi Kumar",
      phone,
      department: "Kitchen",
      joinDate: "2027-03-20",
      monthlySalary: 30_000,
      payMode: "half_16day",
      reserveStatus: "held",
      initialPassword: PASSWORD,
    });
    const { temporaryPassword } = await admin.as.action(
      api.people.resetPassword,
      { staffId },
    );
    expect(temporaryPassword).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}$/);
    expect(
      (await signIn(t, phone, temporaryPassword)).tokens?.token,
    ).toBeTruthy();
    expect(await errorCode(signIn(t, phone, PASSWORD))).toBe("SIGN_IN_FAILED");
    const audit = await t.run((ctx) => ctx.db.query("auditLog").collect());
    expect(audit.map((a) => a.action)).toContain("staff.password_reset");
    expect(JSON.stringify(audit)).not.toContain(temporaryPassword);
  });
});
