"use client";

import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { BellRing, Plus, X } from "lucide-react";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import {
  notificationPurpose,
  PhoneNotificationsCard,
} from "@/components/app/notifications";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { LoadingState } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toaster";
import { useQuery } from "@/lib/convex";
import { friendlyError } from "@/lib/errors";

type Data = FunctionReturnType<typeof api.notifications.settings>;
type Settings = Data["settings"];
type Kind = keyof Settings;

/** Example values, to preview each message as it will read. */
const EXAMPLE: Record<string, string> = {
  name: "Asha Rao",
  amount: "₹15,000",
  property: "Main PG",
  date: "15 Nov",
  payday: "15 Nov",
  paidOn: "15 Nov",
  remaining: "₹0",
  count: "3",
};
const preview = (text: string) =>
  text.replace(/\{(\w+)\}/g, (m, k: string) => EXAMPLE[k] ?? m);

const KINDS: { kind: Kind; title: string; who: string }[] = [
  {
    kind: "payday",
    title: "Payday reminder",
    who: "To admins: one for each person whose salary is due that day, at the time below.",
  },
  {
    kind: "payment",
    title: "Payment made",
    who: "To a staff member: when a payment to them is recorded.",
  },
  {
    kind: "marking",
    title: "Attendance not marked",
    who: "To staff who mark attendance: at each time below, if anyone at their property isn't marked yet that day.",
  },
];

/** Settings → Notifications: this phone, then the wording and times of each notification. */
export function NotificationSettings() {
  const data = useQuery(api.notifications.settings, {});
  return (
    <section aria-labelledby="notifications" className="flex flex-col gap-2">
      <h2 id="notifications" className="font-serif text-2xl tracking-tight">
        Notifications
      </h2>
      <p className="text-sm text-foreground-secondary">
        Phone notifications for you, your staff and those who mark attendance.
        Each person turns them on for their own phone; you choose what they say.
        Words in braces, like {"{name}"}, are filled in for each notification.
      </p>
      <PhoneNotificationsCard purpose={notificationPurpose("admin", false)} />
      {data === undefined ? (
        <LoadingState rows={3} />
      ) : (
        <SettingsForm key={JSON.stringify(data.settings)} data={data} />
      )}
    </section>
  );
}

function SettingsForm({ data }: { data: Data }) {
  const save = useMutation(api.notifications.updateSettings);
  const [settings, setSettings] = useState<Settings>(data.settings);
  const [busy, setBusy] = useState(false);
  const set = <K extends Kind>(kind: K, patch: Partial<Settings[K]>) =>
    setSettings((s) => ({ ...s, [kind]: { ...s[kind], ...patch } }));
  const changed = JSON.stringify(settings) !== JSON.stringify(data.settings);
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await save({ settings });
          toast.success("Notifications saved.");
        } catch (error) {
          toast.error(friendlyError(error));
        } finally {
          setBusy(false);
        }
      }}
    >
      {KINDS.map(({ kind, title, who }) => {
        const s = settings[kind];
        return (
          <Card key={kind}>
            <CardBody className="flex flex-col gap-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-col gap-0.5">
                  <h3 className="flex items-center gap-2 font-medium">
                    <Icon
                      icon={BellRing}
                      className="text-foreground-secondary"
                    />
                    {title}
                  </h3>
                  <p className="text-sm text-foreground-secondary">{who}</p>
                </div>
                <label className="flex min-h-11 shrink-0 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-5 accent-primary"
                    checked={s.enabled}
                    onChange={(e) => set(kind, { enabled: e.target.checked })}
                  />
                  On
                </label>
              </div>
              {kind === "payday" ? (
                <Field id="payday-time" label="Time" className="sm:w-40">
                  {(p) => (
                    <Input
                      {...p}
                      type="time"
                      value={settings.payday.time}
                      onChange={(e) => set("payday", { time: e.target.value })}
                    />
                  )}
                </Field>
              ) : null}
              {kind === "marking" ? (
                <div className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium">Times</span>
                  <div className="flex flex-wrap items-center gap-2">
                    {settings.marking.times.map((time, i) => (
                      <span key={i} className="flex items-center gap-1">
                        <Input
                          aria-label={`Reminder time ${i + 1}`}
                          type="time"
                          className="w-32"
                          value={time}
                          onChange={(e) =>
                            set("marking", {
                              times: settings.marking.times.map((t, j) =>
                                j === i ? e.target.value : t,
                              ),
                            })
                          }
                        />
                        {settings.marking.times.length > 1 ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={`Remove time ${time}`}
                            onClick={() =>
                              set("marking", {
                                times: settings.marking.times.filter(
                                  (_, j) => j !== i,
                                ),
                              })
                            }
                          >
                            <Icon icon={X} />
                          </Button>
                        ) : null}
                      </span>
                    ))}
                    {settings.marking.times.length < 4 ? (
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() =>
                          set("marking", {
                            times: [...settings.marking.times, "20:00"],
                          })
                        }
                      >
                        <Icon icon={Plus} />
                        Add a time
                      </Button>
                    ) : null}
                  </div>
                </div>
              ) : null}
              <Field id={`${kind}-title`} label="Title">
                {(p) => (
                  <Input
                    {...p}
                    value={s.title}
                    maxLength={60}
                    onChange={(e) => set(kind, { title: e.target.value })}
                  />
                )}
              </Field>
              <Field id={`${kind}-body`} label="Message">
                {(p) => (
                  <textarea
                    {...p}
                    rows={2}
                    maxLength={200}
                    value={s.body}
                    onChange={(e) => set(kind, { body: e.target.value })}
                    className="min-h-11 w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-base md:text-sm"
                  />
                )}
              </Field>
              <p className="flex flex-wrap gap-1.5 text-xs text-foreground-secondary">
                You can use:
                {data.placeholders[kind].map((ph) => (
                  <button
                    key={ph.key}
                    type="button"
                    title={ph.means}
                    className="rounded-sm border border-border bg-subtle px-1.5 py-0.5 font-mono hover:border-border-strong"
                    onClick={() => set(kind, { body: `${s.body} {${ph.key}}` })}
                  >
                    {`{${ph.key}}`}
                  </button>
                ))}
              </p>
              <div
                className="rounded-md bg-subtle px-3 py-2 text-sm"
                aria-label="Preview"
              >
                <p className="font-medium">{preview(s.title)}</p>
                <p className="text-foreground-secondary">{preview(s.body)}</p>
              </div>
            </CardBody>
          </Card>
        );
      })}
      <div className="flex justify-end">
        <Button type="submit" loading={busy} disabled={!changed}>
          Save notifications
        </Button>
      </div>
    </form>
  );
}
