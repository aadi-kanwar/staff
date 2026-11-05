import { expect, test } from "vitest";
import { api, internal } from "../_generated/api";
import { errorCode, setupTest, signedInAs } from "./harness.test-utils";

test("the sample data covers both modes, the Feb edge case and an exited employee", async () => {
  const t = await setupTest("2026-11-03");
  expect(await errorCode(t.action(internal.seed.dev, {}))).toBe("FORBIDDEN");
  process.env.STAFF_ALLOW_DEV_SEED = "true";
  process.env.DEV_SEED_PASSWORD = "sample-pass-1";
  try {
    await t.action(internal.seed.dev, {});
    expect((await t.action(internal.seed.dev, {})).message).toMatch(
      /already exists/,
    );
  } finally {
    delete process.env.STAFF_ALLOW_DEV_SEED;
    delete process.env.DEV_SEED_PASSWORD;
  }
  const adminId = (await t.run((ctx) =>
    ctx.db
      .query("users")
      .withIndex("by_role", (q) => q.eq("role", "admin"))
      .first(),
  ))!._id;
  const admin = await signedInAs(t, adminId);
  const list = await admin.query(api.people.list, {});
  expect(list.map((s) => [s.name, s.status, s.payModeLabel])).toEqual([
    ["Asha Rao", "active", "Half-salary (16-day)"],
    ["Meena Joshi", "active", "Half-salary (16-day)"],
    ["Ravi Kumar", "active", "Monthly (10th)"],
    ["Suresh Patel", "exited", "Half-salary (16-day)"],
  ]);
  const meena = (await admin.query(api.people.get, {
    staffId: list[1].staffId,
  }))!;
  expect(meena.schedule.paydays[0].dueDate).toBe("2026-03-01"); // virtual Feb 29
  expect(meena.terms).toHaveLength(2);
  const asha = list[0];
  expect(asha.pending).toBe(15_000); // 25 Oct overdue
  const dashboard = await admin.query(api.dashboard.summary, {});
  expect(dashboard.overdue.map((r) => r.name)).toContain("Asha Rao");
  const suresh = (await admin.query(api.people.get, {
    staffId: list[3].staffId,
  }))!;
  expect(suresh.profile.reserveStatus).toBe("released");
  expect(suresh.schedule.pending).toBe(0);
});
