import { describe, expect, test } from "vitest";
import { api } from "../_generated/api";
import {
  createAdmin,
  createStaffMember,
  errorCode,
  nextPhone,
  PASSWORD,
  setupTest,
  signedInAs,
} from "./harness.test-utils";

describe("setting up the organisation", () => {
  test("an admin without an organisation must create one first, once", async () => {
    const t = await setupTest();
    const userId = await t.run((ctx) =>
      ctx.db.insert("users", {
        phone: nextPhone(),
        role: "admin",
        name: "New Owner",
      }),
    );
    const admin = await signedInAs(t, userId);
    expect(await admin.query(api.organization.status, {})).toEqual({
      hasOrganization: false,
    });
    expect(await errorCode(admin.query(api.people.list, {}))).toBe(
      "ORG_REQUIRED",
    );
    expect((await admin.query(api.users.me, {}))?.organization).toBeNull();
    expect(
      await errorCode(
        admin.mutation(api.organization.create, {
          name: "x",
          propertyName: "Main PG",
        }),
      ),
    ).toBe("INVALID_INPUT");
    await admin.mutation(api.organization.create, {
      name: "Livoza  Stays",
      propertyName: "Koramangala",
    });
    expect(await admin.query(api.organization.status, {})).toEqual({
      hasOrganization: true,
    });
    const me = await admin.query(api.users.me, {});
    expect(me?.organization?.name).toBe("Livoza Stays");
    expect(me?.organization?.properties.map((p) => p.name)).toEqual([
      "Koramangala",
    ]);
    expect(
      await errorCode(
        admin.mutation(api.organization.create, {
          name: "Second",
          propertyName: "Other",
        }),
      ),
    ).toBe("CONFLICT");
  });

  test("properties are added and renamed; names are unique within the organisation", async () => {
    const t = await setupTest();
    const admin = await createAdmin(t);
    const second = await admin.as.mutation(api.organization.addProperty, {
      name: "Indiranagar",
    });
    expect(
      await errorCode(
        admin.as.mutation(api.organization.addProperty, {
          name: "indiranagar",
        }),
      ),
    ).toBe("CONFLICT");
    await admin.as.mutation(api.organization.renameProperty, {
      targetPropertyId: second,
      name: "HSR Layout",
    });
    await admin.as.mutation(api.organization.rename, { name: "Renamed Org" });
    const org = await admin.as.query(api.organization.get, {});
    expect(org.name).toBe("Renamed Org");
    expect(org.properties.map((p) => p.name)).toEqual([
      "HSR Layout",
      "Main PG",
    ]);
  });
});

describe("properties", () => {
  test("every staff member has a property; screens show the chosen property or all", async () => {
    const t = await setupTest();
    const admin = await createAdmin(t);
    const south = await admin.as.mutation(api.organization.addProperty, {
      name: "South PG",
    });
    const a = await createStaffMember(t, admin, { name: "Asha Rao" });
    await createStaffMember(t, admin, {
      name: "Meena Joshi",
      propertyId: south,
    });

    const all = await admin.as.query(api.people.list, {});
    expect(all.map((r) => [r.name, r.propertyName])).toEqual([
      ["Asha Rao", "Main PG"],
      ["Meena Joshi", "South PG"],
    ]);
    const southOnly = await admin.as.query(api.people.list, {
      propertyId: south,
    });
    expect(southOnly.map((r) => r.name)).toEqual(["Meena Joshi"]);
    const grid = await admin.as.query(api.attendance.day, {
      date: "2027-04-20",
      propertyId: admin.propertyId,
    });
    expect(grid.rows.map((r) => r.name)).toEqual(["Asha Rao"]);
    expect(grid.rows[0].propertyName).toBeNull();

    // Moving someone to another property.
    await admin.as.mutation(api.people.updateProfile, {
      staffId: a.staffId,
      name: "Asha Rao",
      department: "Kitchen",
      staffPropertyId: south,
    });
    expect(
      (await admin.as.query(api.people.get, { staffId: a.staffId })).profile
        .propertyName,
    ).toBe("South PG");
    expect((await a.as.query(api.users.me, {}))?.propertyName).toBe("South PG");
  });
});

describe("organisations are kept apart", () => {
  test("an admin can't see or change another organisation's staff or properties", async () => {
    const t = await setupTest();
    const owner = await createAdmin(t, "Owner A", "Org A");
    const other = await createAdmin(t, "Owner B", "Org B");
    const s = await createStaffMember(t, owner, { name: "Asha Rao" });

    expect(await other.as.query(api.people.list, {})).toEqual([]);
    expect(
      await errorCode(other.as.query(api.people.get, { staffId: s.staffId })),
    ).toBe("NOT_FOUND");
    expect(
      await errorCode(
        other.as.mutation(api.attendance.setOne, {
          staffId: s.staffId,
          date: "2027-04-20",
          status: "absent",
        }),
      ),
    ).toBe("NOT_FOUND");
    expect(
      await errorCode(
        other.as.query(api.attendance.month, {
          staffId: s.staffId,
          month: "2027-04",
        }),
      ),
    ).toBe("NOT_FOUND");
    expect(
      await errorCode(
        other.as.action(api.people.resetPassword, { staffId: s.staffId }),
      ),
    ).toBe("NOT_FOUND");
    expect(
      await errorCode(
        other.as.query(api.reports.summary, {
          kind: "attendance",
          from: "2027-04-01",
          to: "2027-04-20",
          staffId: s.staffId,
        }),
      ),
    ).toBe("NOT_FOUND");
    // Another organisation's property can't be chosen on screen or used for new staff.
    expect(
      await errorCode(
        other.as.query(api.people.list, { propertyId: owner.propertyId }),
      ),
    ).toBe("FORBIDDEN");
    expect(
      await errorCode(
        other.as.action(api.people.create, {
          propertyId: owner.propertyId,
          name: "Sneaky",
          phone: nextPhone(),
          department: "Kitchen",
          joinDate: "2027-03-20",
          monthlySalary: 30_000,
          payMode: "half_16day",
          reserveStatus: "held",
          initialPassword: PASSWORD,
        }),
      ),
    ).toBe("INVALID_INPUT");
    expect(
      await errorCode(
        other.as.mutation(api.organization.renameProperty, {
          targetPropertyId: owner.propertyId,
          name: "Mine",
        }),
      ),
    ).toBe("NOT_FOUND");
    // The attendance log only shows your own organisation.
    await owner.as.mutation(api.attendance.setOne, {
      staffId: s.staffId,
      date: "2027-04-20",
      status: "present",
    });
    expect(await owner.as.query(api.attendance.log, {})).toHaveLength(1);
    expect(await other.as.query(api.attendance.log, {})).toHaveLength(0);
    expect((await other.as.query(api.paydays.overview, {})).rows).toHaveLength(
      0,
    );
  });
});

const local = (phone: string) => `${phone.slice(3, 8)} ${phone.slice(8)}`;

describe("reports", () => {
  test("attendance, paydays and payments reports; each download is audited", async () => {
    const t = await setupTest("2027-04-20");
    const admin = await createAdmin(t);
    const s = await createStaffMember(t, admin, { name: "Asha Rao" });
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
    const key = (await admin.as.query(api.people.get, { staffId: s.staffId }))
      .schedule.paydays[0].key;
    await admin.as.mutation(api.payments.record, {
      staffId: s.staffId,
      paydayKey: key,
      amount: 5_000,
      paidOn: "2027-04-16",
      mode: "upi",
    });

    const range = { from: "2027-04-01", to: "2027-04-10" };
    const att = await admin.as.query(api.reports.summary, {
      kind: "attendance",
      ...range,
    });
    expect(att.rows).toBe(10);
    expect(att.totals.find((x) => x.label === "Absent")?.value).toBe(1);
    expect(att.totals.find((x) => x.label === "Half-day")?.value).toBe(1);

    const file = await admin.as.mutation(api.reports.exportCsv, {
      kind: "attendance",
      ...range,
    });
    expect(file.filename).toBe(
      "staff-attendance-main-pg-2027-04-01-to-2027-04-10.csv",
    );
    const lines = file.csv.trim().split("\r\n");
    expect(lines[0]).toBe(
      "Property,Staff,Mobile,Department,Date,Day,Attendance,Counts for pay",
    );
    expect(lines).toContain(
      `Main PG,Asha Rao,${local(s.phone)},Kitchen,2027-04-03,Saturday,Absent,Yes`,
    );

    const summaryFile = await admin.as.mutation(api.reports.exportCsv, {
      kind: "attendance_summary",
      ...range,
    });
    expect(summaryFile.csv).toContain(
      `Main PG,Asha Rao,${local(s.phone)},Kitchen,10,0,1,1,0,0,8,0.5`,
    );

    const paydays = await admin.as.query(api.reports.summary, {
      kind: "paydays",
      from: "2027-04-01",
      to: "2027-04-30",
    });
    expect(paydays.totals).toEqual([
      { label: "Paydays", value: 1 },
      { label: "Net payable (₹)", value: 13_594 },
      { label: "Paid (₹)", value: 5_000 },
      { label: "Still owed (₹)", value: 8_594 },
    ]);

    const payments = await admin.as.mutation(api.reports.exportCsv, {
      kind: "payments",
      from: "2027-04-01",
      to: "2027-04-20",
      staffId: s.staffId,
    });
    expect(payments.filename).toBe(
      "staff-payments-asha-rao-2027-04-01-to-2027-04-20.csv",
    );
    expect(payments.csv).toContain(
      `Main PG,Asha Rao,${local(s.phone)},Kitchen,2027-04-16,2027-04-15,5000,UPI,`,
    );

    expect(
      await errorCode(
        admin.as.query(api.reports.summary, {
          kind: "attendance",
          from: "2027-01-01",
          to: "2027-04-20",
        }),
      ),
    ).toBe("INVALID_INPUT");
    const audits = await t.run((ctx) => ctx.db.query("auditLog").collect());
    expect(audits.filter((a) => a.action === "report.exported")).toHaveLength(
      3,
    );
  });
});
