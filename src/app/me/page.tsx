"use client";

import { ArrowRight, CalendarClock, PiggyBank, Wallet } from "lucide-react";
import Link from "next/link";
import { api } from "@convex/_generated/api";
import { Eyebrow } from "@/components/app/brand";
import { Banner } from "@/components/ui/banner";
import { Card, CardBody } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { LoadingState } from "@/components/ui/skeleton";
import { useQuery } from "@/lib/convex";
import { formatDate, formatDay, formatINR } from "@/lib/format";

const RESERVE_NOTE = { held: "Kept safe for you", released: "Paid to you", forfeited: "Forfeited" } as const;

export default function StaffHome() {
  const data = useQuery(api.staff.home, {});
  if (data === undefined) return <LoadingState rows={3} />;
  const firstName = data.name.split(" ")[0];
  return (
    <>
      <div className="flex flex-col gap-1">
        <Eyebrow>{formatDay(data.today, "EEEE d MMMM")}</Eyebrow>
        <h1 className="font-serif text-3xl tracking-tight">
          Hello, <em className="text-primary-soft">{firstName}.</em>
        </h1>
      </div>
      {data.status === "exited" ? (
        <Banner tone="info" title="You have left">
          {data.lastWorkingDay ? `Your last working day was ${formatDate(data.lastWorkingDay)}. ` : ""}You can still see your attendance and payments
          here.
        </Banner>
      ) : null}

      {data.next ? (
        <section className="flex flex-col gap-2 rounded-md bg-primary p-5 text-primary-foreground" aria-labelledby="next-payday">
          <p id="next-payday" className="flex items-center gap-2 text-sm opacity-90">
            <Icon icon={CalendarClock} />
            Next payday
          </p>
          <p className="tabular font-serif text-3xl">{formatINR(data.next.amount)}</p>
          <p className="text-sm opacity-90">on {formatDay(data.next.date, "EEEE d MMMM")}</p>
        </section>
      ) : null}

      {data.finalSettlement ? (
        <Card>
          <CardBody className="flex flex-col gap-1">
            <p className="text-sm text-foreground-secondary">Final settlement</p>
            <p className="tabular font-serif text-2xl">{formatINR(data.finalSettlement.amount)}</p>
            <p className="text-sm text-foreground-secondary">from {formatDay(data.finalSettlement.date, "EEEE d MMMM")}</p>
          </CardBody>
        </Card>
      ) : null}

      <Link href="/me/payments" className="block">
        <Card className={data.pending > 0 ? "border-warning-border bg-warning-subtle" : undefined}>
          <CardBody className="flex items-center gap-4">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface text-foreground-secondary">
              <Icon icon={Wallet} />
            </span>
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="text-sm text-foreground-secondary">Amount pending</span>
              <span className="tabular text-2xl font-semibold">{formatINR(data.pending)}</span>
              <span className="text-sm text-foreground-secondary">
                {data.pending > 0 ? "Owed to you now" : "Nothing owed right now"}
              </span>
            </div>
            <Icon icon={ArrowRight} className="text-foreground-secondary" />
          </CardBody>
        </Card>
      </Link>

      <Card>
        <CardBody className="flex items-center gap-4">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-subtle text-primary-text">
            <Icon icon={PiggyBank} />
          </span>
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="text-sm text-foreground-secondary">{data.reserve.label}</span>
            <span className="tabular text-2xl font-semibold">{formatINR(data.reserve.amount)}</span>
            <span className="text-sm text-foreground-secondary">
              {RESERVE_NOTE[data.reserve.status]}
              {data.reserve.note ? `: ${data.reserve.note}` : ""}
            </span>
          </div>
        </CardBody>
      </Card>
    </>
  );
}
