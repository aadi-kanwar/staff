import { expect, test } from "vitest";
import { guardedDb } from "../lib/functions";
import { createAdmin, createStaffMember, setupTest } from "./harness.test-utils";

test("attendance log and audit log entries can be added but never edited or deleted", async () => {
  const t = await setupTest();
  const admin = await createAdmin(t);
  const staff = await createStaffMember(t, admin);
  await t.run(async (ctx) => {
    const db = guardedDb(ctx);
    const logId = await db.insert("attendanceLog", {
      staffId: staff.staffId,
      date: "2027-04-01",
      oldStatus: null,
      newStatus: "present",
      changedBy: admin.userId,
      changedAt: Date.now(),
    });
    const auditId = (await ctx.db.query("auditLog").first())!._id;
    await expect(db.patch(logId, { newStatus: "absent" })).rejects.toThrow();
    await expect(db.delete(logId)).rejects.toThrow();
    await expect(db.patch(auditId, { action: "tampered" })).rejects.toThrow();
    await expect(db.delete(auditId)).rejects.toThrow();
    expect((await ctx.db.get(logId))?.newStatus).toBe("present");
    expect((await ctx.db.get(auditId))?.action).not.toBe("tampered");
  });
});
