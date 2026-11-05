import { describe, expect, test, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import {
  checkSettings,
  DEFAULT_NOTIFICATIONS,
  dueTime,
  fill,
} from "../lib/notificationText";
import {
  createAdmin,
  createStaffMember,
  errorCode,
  setupTest,
  type T,
} from "./harness.test-utils";

/** Sets the clock to an India time on a date ("09:05"). */
function at(date: string, clock: string) {
  vi.setSystemTime(new Date(`${date}T${clock}:00+05:30`));
}

let n = 0;
async function addDevice(
  t: T,
  organizationId: Id<"organizations">,
  userId: Id<"users">,
) {
  n += 1;
  await t.run((ctx) =>
    ctx.db.insert("pushSubscriptions", {
      organizationId,
      userId,
      endpoint: `https://push.example.com/${n}`,
      p256dh: "key",
      auth: "auth",
      createdAt: Date.now(),
    }),
  );
}

type Sent = {
  messages: { title: string; body: string; url: string; devices: unknown[] }[];
};
async function queued(t: T): Promise<Sent["messages"]> {
  const jobs = await t.run((ctx) =>
    ctx.db.system.query("_scheduled_functions").collect(),
  );
  return jobs
    .filter((j) => j.name.startsWith("push"))
    .flatMap((j) => (j.args[0] as Sent).messages);
}

describe("wording", () => {
  test("placeholders are filled; unknown ones stay as typed", () => {
    expect(
      fill("Pay {name} {amount} {nope}", { name: "Asha", amount: "₹15,000" }),
    ).toBe("Pay Asha ₹15,000 {nope}");
  });
  test("a time is due for 30 minutes after it", () => {
    expect(dueTime(["09:00"], "09:00")).toBe("09:00");
    expect(dueTime(["09:00"], "09:29")).toBe("09:00");
    expect(dueTime(["09:00"], "09:30")).toBeNull();
    expect(dueTime(["09:00"], "08:59")).toBeNull();
  });
  test("settings are checked and tidied", () => {
    expect(
      checkSettings({
        ...DEFAULT_NOTIFICATIONS,
        marking: {
          ...DEFAULT_NOTIFICATIONS.marking,
          times: ["18:00", "11:00", "11:00"],
        },
      }).marking.times,
    ).toEqual(["11:00", "18:00"]);
    expect(() =>
      checkSettings({
        ...DEFAULT_NOTIFICATIONS,
        payday: { ...DEFAULT_NOTIFICATIONS.payday, time: "9am" },
      }),
    ).toThrow();
  });
});

describe("notifications", () => {
  test("admins get one notification per person paid today, in their own words, once", async () => {
    const t = await setupTest("2027-04-10");
    const admin = await createAdmin(t);
    await createStaffMember(t, admin, {
      name: "Asha Rao",
      joinDate: "2027-03-20",
      payMode: "half_16day",
    }); // payday 15 Apr
    await createStaffMember(t, admin, {
      name: "Ravi Kumar",
      joinDate: "2027-03-20",
      payMode: "half_16day",
    }); // payday 15 Apr
    await createStaffMember(t, admin, {
      name: "Meena",
      joinDate: "2027-03-01",
      payMode: "monthly_10th",
    }); // paid 10 Apr, not 15th
    await addDevice(t, admin.organizationId, admin.userId);
    const { settings } = await admin.as.query(api.notifications.settings, {});
    await admin.as.mutation(api.notifications.updateSettings, {
      settings: {
        ...settings,
        payday: {
          ...settings.payday,
          title: "Salary day: {name}",
          body: "{amount} for {name}",
        },
      },
    });

    at("2027-04-15", "08:55");
    await t.mutation(internal.notifications.sendDue, {});
    expect(await queued(t)).toEqual([]);
    at("2027-04-15", "09:05");
    await t.mutation(internal.notifications.sendDue, {});
    const messages = await queued(t);
    expect(messages.map((m) => [m.title, m.body])).toEqual([
      ["Salary day: Asha Rao", "₹15,000 for Asha Rao"],
      ["Salary day: Ravi Kumar", "₹15,000 for Ravi Kumar"],
    ]);
    // Not again at the next run.
    at("2027-04-15", "09:10");
    await t.mutation(internal.notifications.sendDue, {});
    expect(await queued(t)).toHaveLength(2);
  });

  test("staff are told when a payment to them is recorded", async () => {
    const t = await setupTest("2027-04-15");
    const admin = await createAdmin(t);
    const s = await createStaffMember(t, admin, {
      name: "Asha Rao",
      joinDate: "2027-03-20",
      payMode: "half_16day",
    });
    await addDevice(t, admin.organizationId, s.userId);
    const key = (await admin.as.query(api.people.get, { staffId: s.staffId }))!
      .schedule.paydays[0].key;
    await admin.as.mutation(api.payments.record, {
      staffId: s.staffId,
      paydayKey: key,
      amount: 10_000,
      paidOn: "2027-04-15",
      mode: "upi",
    });
    expect((await queued(t)).map((m) => [m.title, m.body, m.url])).toEqual([
      [
        "Salary paid",
        "₹10,000 has been paid to you for your payday of 15 Apr.",
        "/me/payments",
      ],
    ]);
  });

  test("attendance markers are reminded at the set times only while someone isn't marked", async () => {
    // The test clock only moves forward, so start the day before.
    const t = await setupTest("2027-04-19");
    const admin = await createAdmin(t);
    const marker = await createStaffMember(t, admin, {
      name: "Mohan",
      canMarkAttendance: true,
    });
    const asha = await createStaffMember(t, admin, { name: "Asha" });
    await addDevice(t, admin.organizationId, marker.userId);

    at("2027-04-20", "11:02");
    await t.mutation(internal.notifications.sendDue, {});
    expect((await queued(t)).map((m) => m.body)).toEqual([
      "1 staff at Main PG aren't marked for today yet.",
    ]);

    await marker.as.mutation(api.marking.saveDay, {
      date: "2027-04-20",
      entries: [{ staffId: asha.staffId, status: "present" }],
    });
    at("2027-04-20", "18:01");
    await t.mutation(internal.notifications.sendDue, {});
    expect(await queued(t)).toHaveLength(1); // everyone marked: no second reminder
  });

  test("devices: only signed-in accounts of an organisation; only your own can be removed", async () => {
    const t = await setupTest();
    const admin = await createAdmin(t);
    const s = await createStaffMember(t, admin);
    const sub = {
      endpoint: "https://push.example.com/mine",
      p256dh: "k",
      auth: "a",
    };
    await s.as.mutation(api.notifications.subscribe, sub);
    expect(
      await s.as.query(api.notifications.isSubscribed, {
        endpoint: sub.endpoint,
      }),
    ).toBe(true);
    await admin.as.mutation(api.notifications.unsubscribe, {
      endpoint: sub.endpoint,
    });
    expect(
      await s.as.query(api.notifications.isSubscribed, {
        endpoint: sub.endpoint,
      }),
    ).toBe(true);
    expect(
      await errorCode(
        s.as.mutation(api.notifications.subscribe, {
          ...sub,
          endpoint: "http://insecure",
        }),
      ),
    ).toBe("INVALID_INPUT");
    expect(
      await errorCode(
        s.as.mutation(api.notifications.updateSettings, {
          settings: DEFAULT_NOTIFICATIONS,
        }),
      ),
    ).toBe("FORBIDDEN");
  });
});
