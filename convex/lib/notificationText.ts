/**
 * Phone notifications: the default wording, the {placeholders} each kind
 * can use, and filling them in. The admin can change the wording and times
 * in Settings → Notifications (stored on the organisation).
 */
import { appError } from "./errors";
import type { NotificationSettings } from "./validators";

export type NotificationKind = keyof NotificationSettings;

export const DEFAULT_NOTIFICATIONS: NotificationSettings = {
  payday: {
    enabled: true,
    time: "09:00",
    title: "Pay {name} today",
    body: "{name}'s salary of {amount} is due today ({property}).",
  },
  payment: {
    enabled: true,
    title: "Salary paid",
    body: "{amount} has been paid to you for your payday of {payday}.",
  },
  marking: {
    enabled: true,
    times: ["11:00", "18:00"],
    title: "Attendance not marked",
    body: "{count} staff at {property} aren't marked for today yet.",
  },
};

/** The placeholders each kind can use, with what they become (shown in Settings). */
export const PLACEHOLDERS: Record<
  NotificationKind,
  { key: string; means: string }[]
> = {
  payday: [
    { key: "name", means: "the staff member's name" },
    { key: "amount", means: "what's still owed on that payday" },
    { key: "property", means: "their property" },
    { key: "date", means: "the payday's date" },
  ],
  payment: [
    { key: "name", means: "the staff member's name" },
    { key: "amount", means: "the amount just paid" },
    { key: "payday", means: "the payday it was for" },
    { key: "paidOn", means: "the payment date" },
    { key: "remaining", means: "what's still to come for that payday" },
  ],
  marking: [
    { key: "count", means: "how many aren't marked yet" },
    { key: "property", means: "the property" },
    { key: "date", means: "today's date" },
  ],
};

export const MAX_TITLE = 60;
export const MAX_BODY = 200;
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The organisation's settings, with defaults for anything not set. */
export function notificationSettings(
  saved: NotificationSettings | undefined,
): NotificationSettings {
  return saved ?? DEFAULT_NOTIFICATIONS;
}

/** Replaces each {placeholder} with its value; unknown ones are left as typed. */
export function fill(template: string, values: Record<string, string>): string {
  return template.replace(
    /\{(\w+)\}/g,
    (match, key: string) => values[key] ?? match,
  );
}

/** Checks and tidies settings from the Settings screen. */
export function checkSettings(
  input: NotificationSettings,
): NotificationSettings {
  const text = (value: string, max: number, what: string) => {
    const tidy = value.trim().replace(/\s+/g, " ");
    if (tidy.length === 0)
      throw appError("INVALID_INPUT", `${what} can't be empty.`);
    if (tidy.length > max)
      throw appError(
        "INVALID_INPUT",
        `${what} can be at most ${max} characters.`,
      );
    return tidy;
  };
  const clock = (value: string) => {
    if (!CLOCK.test(value))
      throw appError("INVALID_INPUT", "Times are like 09:00 or 18:30.");
    return value;
  };
  const times = [...new Set(input.marking.times.map(clock))].sort();
  if (times.length < 1 || times.length > 4)
    throw appError("INVALID_INPUT", "Choose between 1 and 4 reminder times.");
  return {
    payday: {
      enabled: input.payday.enabled,
      time: clock(input.payday.time),
      title: text(input.payday.title, MAX_TITLE, "The payday title"),
      body: text(input.payday.body, MAX_BODY, "The payday message"),
    },
    payment: {
      enabled: input.payment.enabled,
      title: text(input.payment.title, MAX_TITLE, "The payment title"),
      body: text(input.payment.body, MAX_BODY, "The payment message"),
    },
    marking: {
      enabled: input.marking.enabled,
      times,
      title: text(input.marking.title, MAX_TITLE, "The attendance title"),
      body: text(input.marking.body, MAX_BODY, "The attendance message"),
    },
  };
}

/** How late a scheduled notification may still go out (the job runs every 5 minutes), in minutes. */
export const SEND_WINDOW_MINUTES = 30;

const minutesOf = (clock: string) =>
  Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));

/** The time due now (within its send window), if any. Times after `nowClock` today aren't due yet. */
export function dueTime(
  times: readonly string[],
  nowClock: string,
): string | null {
  const now = minutesOf(nowClock);
  for (const time of times) {
    const late = now - minutesOf(time);
    if (late >= 0 && late < SEND_WINDOW_MINUTES) return time;
  }
  return null;
}
