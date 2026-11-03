import { describe, expect, test } from "vitest";
import { api } from "../_generated/api";
import {
  createAdmin,
  createStaffMember,
  errorCode,
  setupTest,
} from "./harness.test-utils";

async function setup() {
  const t = await setupTest("2027-04-20");
  const admin = await createAdmin(t);
  const south = await admin.as.mutation(api.organization.addProperty, {
    name: "South PG",
  });
  const marker = await createStaffMember(t, admin, {
    name: "Mohan Marker",
    department: "Front desk",
  });
  const asha = await createStaffMember(t, admin, { name: "Asha Rao" });
  const ravi = await createStaffMember(t, admin, {
    name: "Ravi Kumar",
    department: "Housekeeping",
  });
  const elsewhere = await createStaffMember(t, admin, {
    name: "Meena Joshi",
    propertyId: south,
  });
  return { t, admin, marker, asha, ravi, elsewhere };
}

describe("attendance marking by staff", () => {
  test("without the permission, staff can't mark anyone", async () => {
    const { marker, asha } = await setup();
    expect((await marker.as.query(api.users.me, {}))?.canMarkAttendance).toBe(
      false,
    );
    expect(
      await errorCode(marker.as.query(api.marking.day, { date: "2027-04-20" })),
    ).toBe("FORBIDDEN");
    expect(
      await errorCode(
        marker.as.mutation(api.marking.saveDay, {
          date: "2027-04-20",
          entries: [{ staffId: asha.staffId, status: "absent" }],
        }),
      ),
    ).toBe("FORBIDDEN");
  });

  test("a marker sees and marks the other staff of their own property only", async () => {
    const { t, admin, marker, asha, ravi, elsewhere } = await setup();
    await admin.as.mutation(api.people.setMarking, {
      staffId: marker.staffId,
      allowed: true,
    });
    expect((await marker.as.query(api.users.me, {}))?.canMarkAttendance).toBe(
      true,
    );
    expect(
      (await admin.as.query(api.people.get, { staffId: marker.staffId }))
        .profile.canMarkAttendance,
    ).toBe(true);

    const grid = await marker.as.query(api.marking.day, { date: "2027-04-20" });
    expect(grid.propertyName).toBe("Main PG");
    expect(grid.rows.map((r) => r.name)).toEqual(["Asha Rao", "Ravi Kumar"]);
    // Names, departments and marks only: nothing about pay.
    expect(Object.keys(grid.rows[0]).sort()).toEqual([
      "department",
      "name",
      "staffId",
      "status",
    ]);

    const saved = await marker.as.mutation(api.marking.saveDay, {
      date: "2027-04-20",
      entries: [
        { staffId: asha.staffId, status: "present" },
        { staffId: ravi.staffId, status: "absent" },
      ],
    });
    expect(saved.changed).toBe(2);
    expect(
      (
        await admin.as.query(api.attendance.day, { date: "2027-04-20" })
      ).rows.find((r) => r.name === "Ravi Kumar")?.status,
    ).toBe("absent");
    const log = await admin.as.query(api.attendance.log, {});
    expect(log[0].changedByName).toBe("Mohan Marker");

    // Not themselves, not another property.
    for (const staffId of [marker.staffId, elsewhere.staffId]) {
      expect(
        await errorCode(
          marker.as.mutation(api.marking.saveDay, {
            date: "2027-04-20",
            entries: [{ staffId, status: "present" }],
          }),
        ),
      ).toBe("FORBIDDEN");
    }
    // Today and the last 7 days only.
    expect(
      await errorCode(marker.as.query(api.marking.day, { date: "2027-04-21" })),
    ).toBe("INVALID_DATE");
    expect(
      await errorCode(marker.as.query(api.marking.day, { date: "2027-04-12" })),
    ).toBe("INVALID_DATE");
    expect(
      (await marker.as.query(api.marking.day, { date: "2027-04-13" })).rows,
    ).toHaveLength(2);

    // Taking it away stops it at once.
    await admin.as.mutation(api.people.setMarking, {
      staffId: marker.staffId,
      allowed: false,
    });
    expect(
      await errorCode(marker.as.query(api.marking.day, { date: "2027-04-20" })),
    ).toBe("FORBIDDEN");
    const audits = await t.run((ctx) => ctx.db.query("auditLog").collect());
    expect(
      audits.filter((a) => a.action === "staff.marking_changed"),
    ).toHaveLength(2);
  });

  test("the permission can be given when adding someone; another organisation's admin can't change it", async () => {
    const { t, admin, asha } = await setup();
    const giver = await createStaffMember(t, admin, {
      name: "Gita",
      canMarkAttendance: true,
    });
    expect(
      (await giver.as.query(api.marking.day, { date: "2027-04-20" })).rows
        .length,
    ).toBeGreaterThan(0);
    const other = await createAdmin(t, "Owner B", "Org B");
    expect(
      await errorCode(
        other.as.mutation(api.people.setMarking, {
          staffId: asha.staffId,
          allowed: true,
        }),
      ),
    ).toBe("NOT_FOUND");
  });
});
