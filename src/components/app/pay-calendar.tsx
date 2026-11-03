"use client";

import type { FunctionReturnType } from "convex/server";
import {
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  CircleAlert,
  Clock,
  PiggyBank,
  CalendarClock,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { api } from "@convex/_generated/api";
import { addRealDays } from "@convex/lib/companyCalendar";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { DetailList } from "@/components/ui/stat";
import { StatusBadge } from "@/components/ui/status-badge";
import { addMonths, formatDay, formatINR, formatMonth } from "@/lib/format";
import { cn } from "@/lib/utils";

export type PayCalendarData = FunctionReturnType<typeof api.staff.payCalendar>;
type Period = PayCalendarData["periods"][number];
type State = Period["state"];

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Day tints per period state. Text always says the state too (legend, labels, details). */
const TONE: Record<State | "reserve" | "next", string> = {
  paid: "bg-success-subtle text-success border-success-border",
  pending: "bg-danger-subtle text-danger-text border-danger-border",
  next: "bg-info-subtle text-info border-info-border",
  current: "bg-info-subtle text-info border-info-border",
  upcoming:
    "bg-surface text-foreground-secondary border-dashed border-border-strong",
  reserve: "bg-muted text-foreground-secondary border-border",
};

const STATE_TEXT: Record<State, string> = {
  paid: "Paid",
  pending: "Pending",
  current: "In progress",
  upcoming: "Upcoming",
};

const mondayOffset = (date: string) =>
  (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7;

function datesOfMonth(month: string): string[] {
  const dates: string[] = [];
  for (let d = `${month}-01`; d.startsWith(month); d = addRealDays(d, 1))
    dates.push(d);
  return dates;
}

type Cell =
  | { kind: "period"; period: Period; highlight: boolean }
  | { kind: "reserve" }
  | { kind: "none" };

/**
 * Staff Home: a month calendar of pay periods. Paid periods are green and
 * struck through, pending ones red, and the period now running (or the next
 * one) is highlighted in blue. ₹ marks a payday. Tap a day for its period.
 */
export function PayCalendar({ data }: { data: PayCalendarData }) {
  const { periods, reserve, today } = data;
  // The period to highlight: the one running now, else the next to come.
  const next =
    periods.find((p) => p.state === "current") ??
    periods.find((p) => p.state === "upcoming") ??
    null;
  const firstPending = periods.find((p) => p.state === "pending") ?? null;
  const [selectedId, setSelectedId] = useState<string | null>(
    () => (firstPending ?? next)?.id ?? null,
  );
  const selected: Period | "reserve" | null =
    selectedId === "reserve"
      ? "reserve"
      : (periods.find((p) => p.id === selectedId) ?? null);

  const lastDate = periods.at(-1)?.period.to ?? today;
  const firstMonth = reserve.period.from.slice(0, 7);
  const lastMonth = (lastDate > today ? lastDate : today).slice(0, 7);
  const initialMonth =
    data.status === "exited" && data.lastWorkingDay
      ? data.lastWorkingDay.slice(0, 7)
      : today.slice(0, 7);
  const [month, setMonth] = useState(initialMonth);

  const cellOf = useMemo(() => {
    return (date: string): Cell => {
      if (date >= reserve.period.from && date <= reserve.period.to)
        return { kind: "reserve" };
      const period = periods.find(
        (p) => date >= p.period.from && date <= p.period.to,
      );
      return period
        ? { kind: "period", period, highlight: period === next }
        : { kind: "none" };
    };
  }, [periods, reserve, next]);

  const dates = datesOfMonth(month);
  const blanks = mondayOffset(dates[0]);
  const keyOf = (c: Cell) => (c.kind === "period" ? c.period.id : c.kind);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardBody className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Previous month"
              disabled={month <= firstMonth}
              onClick={() => setMonth(addMonths(month, -1))}
            >
              <Icon icon={ChevronLeft} />
            </Button>
            <h2 className="font-serif text-xl" aria-live="polite">
              {formatMonth(month)}
            </h2>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Next month"
              disabled={month >= lastMonth}
              onClick={() => setMonth(addMonths(month, 1))}
            >
              <Icon icon={ChevronRight} />
            </Button>
          </div>
          <div
            className="grid grid-cols-7 text-center text-xs font-medium text-foreground-secondary"
            aria-hidden="true"
          >
            {WEEKDAYS.map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>
          <ol
            className="grid grid-cols-7 gap-y-1.5"
            aria-label={`Pay periods in ${formatMonth(month)}`}
          >
            {Array.from({ length: blanks }, (_, i) => (
              <li key={`blank-${i}`} aria-hidden="true" />
            ))}
            {dates.map((date) => {
              const cell = cellOf(date);
              const col = mondayOffset(date);
              const key = keyOf(cell);
              // Join days of the same period into one band (round only its ends and the week's edges).
              const joinsLeft =
                col > 0 &&
                date > dates[0] &&
                cell.kind !== "none" &&
                keyOf(cellOf(addRealDays(date, -1))) === key;
              const joinsRight =
                col < 6 &&
                date < dates[dates.length - 1] &&
                cell.kind !== "none" &&
                keyOf(cellOf(addRealDays(date, 1))) === key;
              const isPayday =
                cell.kind === "period" && cell.period.date === date;
              const isSettlement = data.settlement?.date === date;
              const tone =
                cell.kind === "reserve"
                  ? TONE.reserve
                  : cell.kind === "period"
                    ? cell.highlight
                      ? TONE.next
                      : TONE[cell.period.state]
                    : "border-transparent text-foreground-muted";
              const isSelected =
                (cell.kind === "period" &&
                  selected !== "reserve" &&
                  selected?.id === cell.period.id) ||
                (cell.kind === "reserve" && selected === "reserve");
              const n = Number(date.slice(8));
              const label =
                cell.kind === "reserve"
                  ? `${formatDay(date, "d MMM")}: Joining Reserve`
                  : cell.kind === "period"
                    ? `${formatDay(date, "d MMM")}: pay period ${formatDay(cell.period.period.from, "d MMM")} to ${formatDay(cell.period.period.to, "d MMM")}, ${STATE_TEXT[cell.period.state]}${isPayday ? ", payday" : ""}`
                    : formatDay(date, "d MMM");
              const body = (
                <>
                  <span
                    className={cn(
                      "tabular text-sm",
                      cell.kind === "period" &&
                        cell.period.state === "paid" &&
                        !cell.highlight &&
                        "line-through decoration-2",
                      date === today && "font-bold",
                    )}
                  >
                    {n}
                  </span>
                  {isPayday || isSettlement ? (
                    <span
                      className="absolute top-0.5 right-1 text-[10px] leading-none font-bold"
                      aria-hidden="true"
                    >
                      ₹
                    </span>
                  ) : null}
                </>
              );
              const classes = cn(
                "relative flex h-11 w-full items-center justify-center border-y transition-shadow",
                tone,
                joinsLeft ? "border-l-0" : "rounded-l-md border-l",
                joinsRight ? "border-r-0" : "rounded-r-md border-r",
                isPayday && "font-semibold",
                date === today && "ring-2 ring-foreground ring-inset",
                isSelected && "shadow-[inset_0_-3px_0_currentColor]",
              );
              return (
                <li key={date}>
                  {cell.kind === "none" ? (
                    <div className={classes} aria-label={label} role="img">
                      {body}
                    </div>
                  ) : (
                    <button
                      type="button"
                      className={classes}
                      aria-label={label}
                      aria-pressed={isSelected}
                      onClick={() =>
                        setSelectedId(
                          cell.kind === "reserve" ? "reserve" : cell.period.id,
                        )
                      }
                    >
                      {body}
                    </button>
                  )}
                </li>
              );
            })}
          </ol>
          <ul
            className="flex flex-wrap gap-x-4 gap-y-1.5 pt-1 text-xs text-foreground-secondary"
            aria-label="Key"
          >
            <Legend className={TONE.paid}>Paid</Legend>
            <Legend className={TONE.pending}>Pending</Legend>
            <Legend className={TONE.next}>
              {next?.state === "current" ? "This period" : "Next period"}
            </Legend>
            <Legend className={TONE.upcoming}>Later</Legend>
            <Legend className={TONE.reserve}>Joining Reserve</Legend>
            <li className="flex items-center gap-1.5">
              <span className="font-bold text-foreground">₹</span> Payday
            </li>
          </ul>
        </CardBody>
      </Card>
      {selected === "reserve" ? (
        <ReserveDetails reserve={reserve} />
      ) : selected ? (
        <PeriodDetails period={selected} highlight={selected === next} />
      ) : null}
    </div>
  );
}

function Legend({
  className,
  children,
}: {
  className: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-center gap-1.5">
      <span
        className={cn("size-3.5 rounded-sm border", className)}
        aria-hidden="true"
      />
      {children}
    </li>
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
}: {
  period: Period;
  highlight: boolean;
}) {
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
            {STATE_TEXT[period.state]}
          </StatusBadge>
        </div>
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
