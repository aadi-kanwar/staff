"use client";

import type { FunctionReturnType } from "convex/server";
import {
  CalendarClock,
  CircleAlert,
  CircleCheck,
  Clock,
  PiggyBank,
} from "lucide-react";
import { useState } from "react";
import type { api } from "@convex/_generated/api";
import { Card, CardBody } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { DetailList } from "@/components/ui/stat";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDay, formatINR } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  nextPeriodOf,
  PayPeriodGrid,
  PERIOD_STATE_TEXT,
} from "./pay-period-grid";

export type PayCalendarData = FunctionReturnType<typeof api.staff.payCalendar>;
type Period = PayCalendarData["periods"][number];
type State = Period["state"];

/**
 * Staff Home: the pay period calendar (see PayPeriodGrid) with the chosen
 * period's amount, line items and payments below it.
 */
export function PayCalendar({ data }: { data: PayCalendarData }) {
  const { periods, reserve, today } = data;
  const next = nextPeriodOf(periods);
  const firstPending = periods.find((p) => p.state === "pending") ?? null;
  const [selectedId, setSelectedId] = useState<string | null>(
    () => (firstPending ?? next)?.id ?? null,
  );
  const selected: Period | "reserve" | null =
    selectedId === "reserve"
      ? "reserve"
      : (periods.find((p) => p.id === selectedId) ?? null);
  const initialMonth =
    data.status === "exited" && data.lastWorkingDay
      ? data.lastWorkingDay.slice(0, 7)
      : today.slice(0, 7);
  return (
    <div className="flex flex-col gap-4">
      <PayPeriodGrid
        periods={periods.map((p) => ({
          id: p.id,
          from: p.period.from,
          to: p.period.to,
          payday: p.date,
          state: p.state,
        }))}
        reserve={reserve.period}
        settlementDate={data.settlement?.date ?? null}
        absences={data.absences}
        pastEntries={data.pastEntries}
        today={today}
        initialMonth={initialMonth}
        selectedId={selectedId}
        onSelect={setSelectedId}
      />
      {selected === "reserve" ? (
        <ReserveDetails reserve={reserve} />
      ) : selected ? (
        <PeriodDetails
          period={selected}
          highlight={selected === next}
          absences={data.absences.filter(
            (a) =>
              a.date >= selected.period.from && a.date <= selected.period.to,
          )}
        />
      ) : null}
    </div>
  );
}

const BADGE: Record<
  State,
  { tone: "success" | "danger" | "info" | "neutral"; icon: typeof CircleCheck }
> = {
  paid: { tone: "success", icon: CircleCheck },
  pending: { tone: "danger", icon: CircleAlert },
  current: { tone: "info", icon: Clock },
  upcoming: { tone: "neutral", icon: CalendarClock },
};

function PeriodDetails({
  period,
  highlight,
  absences,
}: {
  period: Period;
  highlight: boolean;
  absences: PayCalendarData["absences"];
}) {
  const datesOf = (kind: "absent" | "half_day") =>
    absences
      .filter((a) => a.kind === kind)
      .map((a) => formatDay(a.date, "d MMM"));
  const absentDates = datesOf("absent");
  const halfDates = datesOf("half_day");
  const badge = BADGE[period.state];
  const projected = period.state === "current" || period.state === "upcoming";
  return (
    <Card
      className={cn(
        period.state === "pending" && "border-danger-border",
        highlight && "border-info-border",
      )}
    >
      <CardBody className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col">
            <span className="text-sm text-foreground-secondary">
              {formatDay(period.period.from, "d MMM")} –{" "}
              {formatDay(period.period.to, "d MMM yyyy")}
            </span>
            <span className="tabular font-serif text-2xl">
              {formatINR(period.amount)}
            </span>
            <span className="text-sm text-foreground-secondary">
              {period.state === "pending" ? "Was due" : "Payday"}{" "}
              {formatDay(period.date, "EEEE d MMMM")}
            </span>
          </div>
          <StatusBadge tone={badge.tone} icon={badge.icon}>
            {PERIOD_STATE_TEXT[period.state]}
          </StatusBadge>
        </div>
        {absentDates.length > 0 || halfDates.length > 0 ? (
          <div className="flex flex-col gap-1 rounded-md border border-danger-border bg-danger-subtle px-3 py-2 text-sm text-danger-text">
            {absentDates.length > 0 ? (
              <p>
                <strong>Absent</strong> ({absentDates.length}):{" "}
                {absentDates.join(", ")}
              </p>
            ) : null}
            {halfDates.length > 0 ? (
              <p>
                <strong>Half-day</strong> ({halfDates.length}):{" "}
                {halfDates.join(", ")}
              </p>
            ) : null}
          </div>
        ) : null}
        <DetailList
          rows={[
            ...period.lines.map((l) => ({
              label: l.label,
              value: formatINR(l.amount, { exact: true, signed: l.amount < 0 }),
            })),
            {
              label: projected ? "Expected" : "Amount",
              value: formatINR(period.amount),
              strong: true,
            },
          ]}
        />
        {period.payments.length > 0 || period.remaining > 0 ? (
          <div className="flex flex-col gap-1 rounded-md bg-subtle px-3 py-2 text-sm">
            {period.payments.map((pay, i) => (
              <p key={i} className="flex justify-between gap-3">
                <span>
                  Paid {formatDay(pay.paidOn, "d MMM yyyy")} · {pay.method}
                </span>
                <span className="tabular">{formatINR(pay.amount)}</span>
              </p>
            ))}
            {period.remaining > 0 && period.state === "pending" ? (
              <p className="flex justify-between gap-3 font-medium text-danger-text">
                <span>Still pending</span>
                <span className="tabular">{formatINR(period.remaining)}</span>
              </p>
            ) : null}
          </div>
        ) : null}
        {projected ? (
          <p className="text-sm text-foreground-secondary">
            The amount assumes you&apos;re present for the rest of the period.
          </p>
        ) : null}
      </CardBody>
    </Card>
  );
}

function ReserveDetails({ reserve }: { reserve: PayCalendarData["reserve"] }) {
  const note = {
    held: "Kept safe for you, paid when you leave",
    released: "Paid to you",
    forfeited: "Forfeited",
  } as const;
  return (
    <Card>
      <CardBody className="flex items-start gap-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-foreground-secondary">
          <Icon icon={PiggyBank} />
        </span>
        <div className="flex min-w-0 flex-col">
          <span className="text-sm text-foreground-secondary">
            Joining Reserve · {formatDay(reserve.period.from, "d MMM")} –{" "}
            {formatDay(reserve.period.to, "d MMM yyyy")}
          </span>
          <span className="tabular font-serif text-2xl">
            {formatINR(reserve.amount)}
          </span>
          <span className="text-sm text-foreground-secondary">
            {note[reserve.status]}
            {reserve.note ? `: ${reserve.note}` : ""}
          </span>
        </div>
      </CardBody>
    </Card>
  );
}
