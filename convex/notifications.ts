/**
 * Phone notifications (Web Push), as in MealSync:
 *  - to admins: one notification per person whose payday is today (at the
 *    time set in Settings), with what's still owed;
 *  - to a staff member: when a payment to them is recorded;
 *  - to staff who mark attendance: at the times set, if anyone at their
 *    property isn't marked yet today.
 * The admin chooses the wording (with {placeholders}) and times. Devices are
 * registered by each person on their own phone after allowing notifications.
 */
import { v } from "convex/values";
import { formatInTimeZone } from "date-fns-tz";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { formatINR } from "./lib/money";
import { appError } from "./lib/errors";
import {
  adminMutation,
  adminQuery,
  internalMutation,
  organizationProperties,
  signedInMutation,
  signedInQuery,
  viewerQuery,
} from "./lib/functions";
import {
  checkSettings,
  dueTime,
  fill,
  notificationSettings,
  PLACEHOLDERS,
} from "./lib/notificationText";
import { scheduleFor, worksOn } from "./lib/staffData";
import { TIMEZONE, todayInIndia } from "./lib/time";
import { vNotificationSettings } from "./lib/validators";

type Device = {
  subscriptionId: Id<"pushSubscriptions">;
  endpoint: string;
  p256dh: string;
  auth: string;
};
type Message = {
  devices: Device[];
  title: string;
  body: string;
  url: string;
  tag: string;
};

const day = (date: string) =>
  formatInTimeZone(new Date(`${date}T12:00:00Z`), "UTC", "d MMM");

/** The public half of the push signing key. Browsers need it to subscribe. */
export const publicKey = viewerQuery({
  args: {},
  handler: async () => ({ publicKey: process.env.VAPID_PUBLIC_KEY ?? null }),
});

/** The organisation a signed-in account belongs to (admins directly, staff through their record). */
async function organizationOf(ctx: Pick<QueryCtx, "db">, user: Doc<"users">) {
  if (user.role === "admin") return user.organizationId ?? null;
  if (user.role === "staff") {
    const staff = await ctx.db
      .query("staff")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();
    return staff?.organizationId ?? null;
  }
  return null;
}

function checkSubscription(args: {
  endpoint: string;
  p256dh: string;
  auth: string;
}) {
  let url: URL;
  try {
    url = new URL(args.endpoint);
  } catch {
    throw appError("INVALID_INPUT", "That notification address isn't valid.");
  }
  if (
    url.protocol !== "https:" ||
    args.endpoint.length > 1000 ||
    args.p256dh.length > 200 ||
    args.auth.length > 100
  ) {
    throw appError("INVALID_INPUT", "That notification address isn't valid.");
  }
}

/** Saves this phone/browser to receive the caller's notifications. */
export const subscribe = signedInMutation({
  args: { endpoint: v.string(), p256dh: v.string(), auth: v.string() },
  handler: async (ctx, args) => {
    checkSubscription(args);
    const organizationId = await organizationOf(ctx, ctx.viewer.user);
    if (organizationId === null)
      throw appError(
        "FORBIDDEN",
        "Notifications aren't available for this account yet.",
      );
    const existing = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", args.endpoint))
      .unique();
    // A shared device someone else used before now belongs to this person.
    if (existing !== null) await ctx.db.delete(existing._id);
    await ctx.db.insert("pushSubscriptions", {
      organizationId,
      userId: ctx.viewer.userId,
      endpoint: args.endpoint,
      p256dh: args.p256dh,
      auth: args.auth,
      createdAt: Date.now(),
    });
    return null;
  },
});

/** Stops notifications on this phone/browser (the caller's own device only). */
export const unsubscribe = signedInMutation({
  args: { endpoint: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", args.endpoint))
      .unique();
    if (existing !== null && existing.userId === ctx.viewer.userId)
      await ctx.db.delete(existing._id);
    return null;
  },
});

/** Whether this phone/browser receives the caller's notifications. */
export const isSubscribed = signedInQuery({
  args: { endpoint: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", args.endpoint))
      .unique();
    return existing !== null && existing.userId === ctx.viewer.userId;
  },
});

/** Settings → Notifications: the wording and times, and the placeholders each can use. */
export const settings = adminQuery({
  args: {},
  handler: async (ctx) => ({
    settings: notificationSettings(ctx.admin.organization.notificationSettings),
    placeholders: PLACEHOLDERS,
  }),
});

export const updateSettings = adminMutation({
  args: { settings: vNotificationSettings },
  handler: async (ctx, args) => {
    const settings = checkSettings(args.settings);
    await ctx.db.patch(ctx.admin.organization._id, {
      notificationSettings: settings,
    });
    return null;
  },
});

async function devicesOf(
  ctx: Pick<QueryCtx, "db">,
  userIds: Iterable<Id<"users">>,
): Promise<Device[]> {
  const devices: Device[] = [];
  for (const userId of new Set(userIds)) {
    for (const sub of await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect()) {
      devices.push({
        subscriptionId: sub._id,
        endpoint: sub.endpoint,
        p256dh: sub.p256dh,
        auth: sub.auth,
      });
    }
  }
  return devices;
}

async function queue(ctx: Pick<MutationCtx, "scheduler">, messages: Message[]) {
  const withDevices = messages.filter((m) => m.devices.length > 0);
  if (withDevices.length > 0)
    await ctx.scheduler.runAfter(0, internal.push.send, {
      messages: withDevices,
    });
  return withDevices.reduce((n, m) => n + m.devices.length, 0);
}

/**
 * Called when a payment to `staff` is recorded (payments.ts, settlements):
 * tells them on their phone, if the admin has this notification on.
 */
export async function notifyPayment(
  ctx: Pick<MutationCtx, "db" | "scheduler">,
  staff: Doc<"staff">,
  payment: {
    amount: number;
    paidOn: string;
    paydayDate: string | null;
    remaining: number;
  },
) {
  const organization = await ctx.db.get(staff.organizationId);
  if (!organization) return;
  const text = notificationSettings(organization.notificationSettings).payment;
  if (!text.enabled) return;
  const values = {
    name: staff.name,
    amount: formatINR(payment.amount),
    payday: payment.paydayDate
      ? day(payment.paydayDate)
      : "your final settlement",
    paidOn: day(payment.paidOn),
    remaining: formatINR(Math.max(payment.remaining, 0)),
  };
  await queue(ctx, [
    {
      devices: await devicesOf(ctx, [staff.userId]),
      title: fill(text.title, values),
      body: fill(text.body, values),
      url: "/me/payments",
      tag: `payment-${Date.now()}`,
    },
  ]);
}

/** Already sent for this organisation, kind, day and time? Records it if not. */
async function claimRun(
  ctx: MutationCtx,
  organizationId: Id<"organizations">,
  kind: string,
  date: string,
  time: string,
) {
  const already = await ctx.db
    .query("notificationRuns")
    .withIndex("by_org_kind_date_time", (q) =>
      q
        .eq("organizationId", organizationId)
        .eq("kind", kind)
        .eq("date", date)
        .eq("time", time),
    )
    .first();
  if (already !== null) return null;
  return await ctx.db.insert("notificationRuns", {
    organizationId,
    kind,
    date,
    time,
    sentAt: Date.now(),
    recipients: 0,
  });
}

/** Admins: one message per person with money due today (paydays and final settlements). */
export async function paydayMessages(
  ctx: Pick<QueryCtx, "db">,
  organization: Doc<"organizations">,
  today: string,
): Promise<Message[]> {
  const text = notificationSettings(organization.notificationSettings).payday;
  const admins = await ctx.db
    .query("users")
    .withIndex("by_org_role", (q) =>
      q.eq("organizationId", organization._id).eq("role", "admin"),
    )
    .collect();
  const devices = await devicesOf(
    ctx,
    admins.filter((a) => a.disabled !== true).map((a) => a._id),
  );
  const properties = new Map(
    (await organizationProperties(ctx, organization._id)).map((p) => [
      p._id as string,
      p.name,
    ]),
  );
  const messages: Message[] = [];
  for (const staff of await ctx.db
    .query("staff")
    .withIndex("by_org", (q) => q.eq("organizationId", organization._id))
    .collect()) {
    const schedule = await scheduleFor(ctx, staff, today, 1);
    const owed =
      schedule.paydays
        .filter((p) => p.dueDate === today && p.outstanding > 0)
        .reduce((a, p) => a + p.outstanding, 0) +
      (schedule.settlement?.dueDate === today
        ? Math.max(schedule.settlement.extrasOutstanding, 0)
        : 0);
    if (owed <= 0) continue;
    const values = {
      name: staff.name,
      amount: formatINR(owed),
      property: properties.get(staff.propertyId) ?? "",
      date: day(today),
    };
    messages.push({
      devices,
      title: fill(text.title, values),
      body: fill(text.body, values),
      url: `/admin/staff/${staff._id}?tab=paydays`,
      tag: `payday-${staff._id}-${today}`,
    });
  }
  return messages;
}

/** Staff who mark attendance: one message each if anyone else at their property isn't marked today. */
export async function markingMessages(
  ctx: Pick<QueryCtx, "db">,
  organization: Doc<"organizations">,
  today: string,
): Promise<Message[]> {
  const text = notificationSettings(organization.notificationSettings).marking;
  const everyone = await ctx.db
    .query("staff")
    .withIndex("by_org", (q) => q.eq("organizationId", organization._id))
    .collect();
  const properties = new Map(
    (await organizationProperties(ctx, organization._id)).map((p) => [
      p._id as string,
      p.name,
    ]),
  );
  const messages: Message[] = [];
  for (const marker of everyone.filter(
    (s) => s.status === "active" && s.canMarkAttendance === true,
  )) {
    let count = 0;
    for (const s of everyone) {
      if (
        s._id === marker._id ||
        s.propertyId !== marker.propertyId ||
        s.status !== "active" ||
        !worksOn(s, today)
      )
        continue;
      const mark = await ctx.db
        .query("attendance")
        .withIndex("by_staff_date", (q) =>
          q.eq("staffId", s._id).eq("date", today),
        )
        .unique();
      if (mark === null) count += 1;
    }
    if (count === 0) continue;
    const values = {
      count: String(count),
      property: properties.get(marker.propertyId) ?? "",
      date: day(today),
    };
    messages.push({
      devices: await devicesOf(ctx, [marker.userId]),
      title: fill(text.title, values),
      body: fill(text.body, values),
      url: "/me/mark",
      tag: `marking-${today}`,
    });
  }
  return messages;
}

/**
 * Scheduled every 5 minutes (crons.ts): sends the payday and attendance
 * notifications that are due, once per organisation, day and time.
 */
export const sendDue = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const today = todayInIndia(now);
    const clock = formatInTimeZone(new Date(now), TIMEZONE, "HH:mm");
    let sent = 0;
    for (const organization of await ctx.db.query("organizations").collect()) {
      if (organization.status !== "active") continue;
      const settings = notificationSettings(organization.notificationSettings);
      const paydayTime = settings.payday.enabled
        ? dueTime([settings.payday.time], clock)
        : null;
      if (paydayTime !== null) {
        const run = await claimRun(
          ctx,
          organization._id,
          "payday",
          today,
          paydayTime,
        );
        if (run !== null) {
          const n = await queue(
            ctx,
            await paydayMessages(ctx, organization, today),
          );
          await ctx.db.patch(run, { recipients: n });
          sent += n;
        }
      }
      const markingTime = settings.marking.enabled
        ? dueTime(settings.marking.times, clock)
        : null;
      if (markingTime !== null) {
        const run = await claimRun(
          ctx,
          organization._id,
          "marking",
          today,
          markingTime,
        );
        if (run !== null) {
          const n = await queue(
            ctx,
            await markingMessages(ctx, organization, today),
          );
          await ctx.db.patch(run, { recipients: n });
          sent += n;
        }
      }
    }
    return { sent };
  },
});

/** Removes devices the push service says no longer exist. */
export const removeSubscriptions = internalMutation({
  args: { ids: v.array(v.id("pushSubscriptions")) },
  handler: async (ctx, args) => {
    for (const id of args.ids) {
      if ((await ctx.db.get(id)) !== null) await ctx.db.delete(id);
    }
    return null;
  },
});

/** Tells the organisation's admins that someone asked to change their payment details. */
export const notifyPayoutRequest = internalMutation({
  args: { staffId: v.id("staff") },
  handler: async (ctx, { staffId }) => {
    const staff = await ctx.db.get(staffId);
    if (!staff?.payoutRequest) return null;
    const admins = await ctx.db
      .query("users")
      .withIndex("by_org_role", (q) =>
        q.eq("organizationId", staff.organizationId).eq("role", "admin"),
      )
      .collect();
    await queue(ctx, [
      {
        devices: await devicesOf(
          ctx,
          admins.filter((a) => a.disabled !== true).map((a) => a._id),
        ),
        title: "Payment details to approve",
        body: `${staff.name} updated where their salary should be paid. Please check and approve.`,
        url: `/admin/staff/${staff._id}?tab=profile`,
        tag: `payout-${staff._id}`,
      },
    ]);
    return null;
  },
});
