"use client";

import { ArrowRight, CalendarClock, PiggyBank, Wallet } from "lucide-react";
import Link from "next/link";
import { api } from "@convex/_generated/api";
import { Eyebrow } from "@/components/app/brand";
import { PayCalendar } from "@/components/app/pay-calendar";
import { Banner } from "@/components/ui/banner";
import { Card, CardBody } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { LoadingState } from "@/components/ui/skeleton";
import { useQuery } from "@/lib/convex";
import { formatDate, formatDay, formatINR } from "@/lib/format";
import { cn } from "@/lib/utils";

const RESERVE_NOTE = {
  held: "Kept safe for you",
  released: "Paid to you",
  forfeited: "Forfeited",
} as const;

export default function StaffHome() {
  const home = useQuery(api.staff.home, {});
  const calendar = useQuery(api.staff.payCalendar, {});
  if (home === undefined || calendar === undefined)
    return <LoadingState rows={4} />;
  const firstName = home.name.split(" ")[0];
  const pending = home.pending;
  return (
    <>
      <div className="flex flex-col gap-1">
        <Eyebrow>{formatDay(home.today, "EEEE d MMMM")}</Eyebrow>
        <h1 className="font-serif text-3xl tracking-tight">
          Hello, <em className="text-primary-soft">{firstName}.</em>
        </h1>
      </div>
      {home.status === "exited" ? (
        <Banner tone="info" title="You have left">
          {home.lastWorkingDay
            ? `Your last working day was ${formatDate(home.lastWorkingDay)}. `
            : ""}
          You can still see your attendance and payments here.
        </Banner>
      ) : null}

      <div className="grid grid-cols-2 gap-3">
        <Link href="/me/payments" className="block">
          <div
            className={cn(
              "flex h-full flex-col gap-0.5 rounded-md border p-3",
              pending > 0
                ? "border-danger-border bg-danger-subtle text-danger-text"
                : "border-success-border bg-success-subtle text-success",
            )}
          >
            <span className="flex items-center gap-1.5 text-xs font-medium">
              <Icon icon={Wallet} className="size-4" />
              {pending > 0 ? "Pending" : "All paid"}
            </span>
            <span className="tabular font-serif text-2xl">
              {formatINR(pending)}
            </span>
            <span className="flex items-center gap-1 text-xs">
              {pending > 0 ? "Owed to you now" : "Nothing owed now"}
              <Icon icon={ArrowRight} className="size-3.5" />
            </span>
          </div>
        </Link>
        {home.next ? (
          <div className="flex h-full flex-col gap-0.5 rounded-md border border-info-border bg-info-subtle p-3 text-info">
            <span className="flex items-center gap-1.5 text-xs font-medium">
              <Icon icon={CalendarClock} className="size-4" />
              Next payday
            </span>
            <span className="tabular font-serif text-2xl">
              {formatINR(home.next.amount)}
            </span>
            <span className="text-xs">
              {formatDay(home.next.date, "EEE d MMM")}
            </span>
          </div>
        ) : home.finalSettlement ? (
          <div className="flex h-full flex-col gap-0.5 rounded-md border border-info-border bg-info-subtle p-3 text-info">
            <span className="text-xs font-medium">Final settlement</span>
            <span className="tabular font-serif text-2xl">
              {formatINR(home.finalSettlement.amount)}
            </span>
            <span className="text-xs">
              from {formatDay(home.finalSettlement.date, "EEE d MMM")}
            </span>
          </div>
        ) : null}
      </div>

      <section aria-labelledby="pay-calendar" className="flex flex-col gap-2">
        <h2 id="pay-calendar" className="sr-only">
          Pay calendar
        </h2>
        <PayCalendar data={calendar} />
      </section>

      {home.next && home.finalSettlement ? (
        <Card>
          <CardBody className="flex flex-col gap-1">
            <p className="text-sm text-foreground-secondary">
              Final settlement
            </p>
            <p className="tabular font-serif text-2xl">
              {formatINR(home.finalSettlement.amount)}
            </p>
            <p className="text-sm text-foreground-secondary">
              from {formatDay(home.finalSettlement.date, "EEEE d MMMM")}
            </p>
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardBody className="flex items-center gap-4">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-foreground-secondary">
            <Icon icon={PiggyBank} />
          </span>
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="text-sm text-foreground-secondary">
              {home.reserve.label}
            </span>
            <span className="tabular text-xl font-semibold">
              {formatINR(home.reserve.amount)}
            </span>
            <span className="text-sm text-foreground-secondary">
              {RESERVE_NOTE[home.reserve.status]}
              {home.reserve.note ? `: ${home.reserve.note}` : ""}
            </span>
          </div>
        </CardBody>
      </Card>
    </>
  );
}
