"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { addRealDays } from "@convex/lib/companyCalendar";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { addMonths, formatDay, formatINR, formatMonth } from "@/lib/format";
import { cn } from "@/lib/utils";

export type PeriodState = "paid" | "pending" | "current" | "upcoming";
export type AbsenceKind = "absent" | "half_day";

/** One pay period as the calendar draws it. */
export type CalendarPeriod = {
  id: string;
  from: string;
  to: string;
  payday: string;
  state: PeriodState;
};

/** How a period looks: paid, pending (its date has passed, not fully paid), running now, or later. */
export function periodStateOf(
  p: { from: string; payday: string; paid: number; outstanding: number },
  today: string,
): PeriodState {
  if (p.outstanding <= 0 && (p.paid > 0 || p.payday <= today)) return "paid";
  if (p.payday <= today) return "pending";
  return p.from <= today ? "current" : "upcoming";
}

/** The period to highlight in blue: the one running now, else the next to come. */
export function nextPeriodOf<P extends { state: PeriodState }>(
  periods: P[],
): P | null {
  return (
    periods.find((p) => p.state === "current") ??
    periods.find((p) => p.state === "upcoming") ??
    null
  );
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Day tints per period state. Text always says the state too (key, labels, details). */
export const PERIOD_TONE: Record<PeriodState | "reserve" | "next", string> = {
  paid: "bg-success-subtle text-success border-success-border",
  pending: "bg-danger-subtle text-danger-text border-danger-border",
  next: "bg-info-subtle text-info border-info-border",
  current: "bg-info-subtle text-info border-info-border",
  upcoming:
    "bg-surface text-foreground-secondary border-dashed border-border-strong",
  reserve: "bg-muted text-foreground-secondary border-border",
};

/** Days with a past entry recorded but no pay period: paid-looking, dashed. */
const PAST_TONE =
  "bg-success-subtle text-success border-dashed border-success-border";

export const PERIOD_STATE_TEXT: Record<PeriodState, string> = {
  paid: "Paid",
  pending: "Pending",
  current: "In progress",
  upcoming: "Upcoming",
};

/** The ₹ badge on a payday, in the colour of the period it pays. */
const PAYDAY_BADGE: Record<PeriodState | "next", string> = {
  paid: "bg-success",
  pending: "bg-danger",
  next: "bg-info",
  current: "bg-info",
  upcoming: "bg-foreground-secondary",
};

const ABSENCE_SHORT: Record<AbsenceKind, string> = {
  absent: "A",
  half_day: "½",
};
const ABSENCE_TEXT: Record<AbsenceKind, string> = {
  absent: "absent",
  half_day: "a half-day",
};
/** Solid badges so they read on any period colour. */
const ABSENCE_BADGE: Record<AbsenceKind, string> = {
  absent: "bg-danger",
  half_day: "bg-warning",
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
  | { kind: "period"; period: CalendarPeriod; highlight: boolean }
  | { kind: "reserve" }
  | { kind: "past"; records: PastRecordMark[] }
  | { kind: "none" };

/** A past payment record (records only): the dates it was for and its total. */
export type PastRecordMark = { from: string; to: string; total: number };

/**
 * A month calendar of pay periods, used on the staff Home and on each staff
 * member's Paydays tab. Each period is one band: green and struck through
 * when paid, red when pending, blue for the one running now (or next),
 * dashed later; grey for the Joining Reserve. ₹ marks paydays, A / ½ absent
 * and half days. Tapping a day selects its period (or "reserve"); when the
 * selection changes from outside, the calendar turns to that period's month.
 */
export function PayPeriodGrid({
  periods,
  reserve,
  settlementDate,
  absences,
  today,
  initialMonth,
  selectedId,
  onSelect,
  pastRecords = [],
}: {
  /** Past payment records: their days are outlined (and shaded where there's no pay period). */
  pastRecords?: PastRecordMark[];
  periods: CalendarPeriod[];
  reserve: { from: string; to: string };
  settlementDate: string | null;
  absences: { date: string; kind: AbsenceKind }[];
  today: string;
  initialMonth: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const absenceOn = useMemo(
    () => new Map(absences.map((a) => [a.date, a.kind])),
    [absences],
  );
  const next = nextPeriodOf(periods);
  // Which period each payday pays. For monthly pay the 10th sits inside the
  // next month's band, so its ₹ badge takes the colour of the month it pays.
  const paidOn = useMemo(
    () => new Map(periods.map((p) => [p.payday, p])),
    [periods],
  );
  const lastDate = periods.at(-1)?.to ?? today;
  // Up to 2 months before joining (earlier still if a past record goes back further).
  const firstMonth = [
    addMonths(reserve.from.slice(0, 7), -2),
    ...pastRecords.map((r) => r.from.slice(0, 7)),
  ].sort()[0];
  const lastMonth = (lastDate > today ? lastDate : today).slice(0, 7);
  const [month, setMonth] = useState(initialMonth);

  // When the selection changes (e.g. a card was clicked), turn to that
  // period's month if it isn't on screen. Turning months by hand is left alone.
  const [seenSelection, setSeenSelection] = useState(selectedId);
  if (seenSelection !== selectedId) {
    setSeenSelection(selectedId);
    const p = periods.find((x) => x.id === selectedId);
    if (p && !(p.from.slice(0, 7) <= month && month <= p.to.slice(0, 7)))
      setMonth(p.payday.slice(0, 7));
  }

  const cellOf = useMemo(() => {
    return (date: string): Cell => {
      const period = periods.find((p) => date >= p.from && date <= p.to);
      if (period) return { kind: "period", period, highlight: period === next };
      const records = pastRecords.filter((r) => date >= r.from && date <= r.to);
      if (records.length > 0) return { kind: "past", records };
      if (date >= reserve.from && date <= reserve.to)
        return { kind: "reserve" };
      return { kind: "none" };
    };
  }, [periods, reserve, next, pastRecords]);
  const recordsOn = (date: string) =>
    pastRecords.filter((r) => date >= r.from && date <= r.to);

  const dates = datesOfMonth(month);
  const blanks = mondayOffset(dates[0]);
  const keyOf = (c: Cell) => (c.kind === "period" ? c.period.id : c.kind);

  return (
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
            const pays = paidOn.get(date) ?? null;
            const isPayday = pays !== null;
            const isSettlement = settlementDate === date;
            const absence = absenceOn.get(date);
            const tone =
              cell.kind === "past"
                ? PAST_TONE
                : cell.kind === "reserve"
                  ? PERIOD_TONE.reserve
                  : cell.kind === "period"
                    ? cell.highlight
                      ? PERIOD_TONE.next
                      : PERIOD_TONE[cell.period.state]
                    : "border-transparent text-foreground-muted";
            const isSelected =
              (pays !== null && selectedId === pays.id) ||
              (cell.kind === "period" && selectedId === cell.period.id) ||
              (cell.kind === "reserve" && selectedId === "reserve");
            const label =
              cell.kind === "past"
                ? `${formatDay(date, "d MMM")}`
                : cell.kind === "reserve"
                  ? `${formatDay(date, "d MMM")}: Joining Reserve`
                  : cell.kind === "period"
                    ? `${formatDay(date, "d MMM")}: pay period ${formatDay(cell.period.from, "d MMM")} to ${formatDay(cell.period.to, "d MMM")}, ${PERIOD_STATE_TEXT[cell.period.state]}`
                    : formatDay(date, "d MMM");
            const paydayLabel = pays
              ? `. Payday for ${formatDay(pays.from, "d MMM")} to ${formatDay(pays.to, "d MMM")}: ${PERIOD_STATE_TEXT[pays.state]}`
              : "";
            const records = recordsOn(date);
            const recordLabel = records.length
              ? `. Past payment recorded: ${records.map((r) => formatINR(r.total)).join(", ")}`
              : "";
            const fullLabel = `${label}${paydayLabel}${recordLabel}${absence ? `. Marked ${ABSENCE_TEXT[absence]}` : ""}`;
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
                  {Number(date.slice(8))}
                </span>
                {pays ? (
                  <span
                    className={cn(
                      "absolute -top-1 -right-0.5 z-10 flex size-4 items-center justify-center rounded-full text-[10px] leading-none font-bold text-white ring-2 ring-surface",
                      PAYDAY_BADGE[pays === next ? "next" : pays.state],
                    )}
                    aria-hidden="true"
                  >
                    ₹
                  </span>
                ) : isSettlement ? (
                  <span
                    className="absolute top-0.5 right-1 text-[10px] leading-none font-bold"
                    aria-hidden="true"
                  >
                    ₹
                  </span>
                ) : null}
                {absence ? (
                  <span
                    className={cn(
                      "flex h-3.5 min-w-3.5 items-center justify-center rounded-full px-1 text-[9px] leading-none font-bold text-white",
                      ABSENCE_BADGE[absence],
                    )}
                    aria-hidden="true"
                  >
                    {ABSENCE_SHORT[absence]}
                  </span>
                ) : null}
              </>
            );
            const classes = cn(
              "relative flex h-11 w-full flex-col items-center justify-center gap-0.5 border-y leading-none transition-shadow",
              tone,
              joinsLeft ? "border-l-0" : "rounded-l-md border-l",
              joinsRight ? "border-r-0" : "rounded-r-md border-r",
              isPayday && "font-semibold",
              date === today && "ring-2 ring-foreground ring-inset",
              records.length > 0 &&
                "outline-2 -outline-offset-4 outline-success outline-dashed",
              isSelected && "shadow-[inset_0_-3px_0_currentColor]",
            );
            return (
              <li key={date}>
                {cell.kind === "none" || cell.kind === "past" ? (
                  <div className={classes} aria-label={fullLabel} role="img">
                    {body}
                  </div>
                ) : (
                  <button
                    type="button"
                    className={classes}
                    aria-label={fullLabel}
                    aria-pressed={isSelected}
                    onClick={() =>
                      onSelect(
                        pays
                          ? pays.id
                          : cell.kind === "reserve"
                            ? "reserve"
                            : cell.period.id,
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
          <Legend className={PERIOD_TONE.paid}>Paid</Legend>
          <Legend className={PERIOD_TONE.pending}>Pending</Legend>
          <Legend className={PERIOD_TONE.next}>
            {next?.state === "current" ? "This period" : "Next period"}
          </Legend>
          <Legend className={PERIOD_TONE.upcoming}>Later</Legend>
          <Legend className={PERIOD_TONE.reserve}>Joining Reserve</Legend>
          {pastRecords.length > 0 ? (
            <li className="flex items-center gap-1.5">
              <span
                className="size-3.5 rounded-sm outline-2 -outline-offset-2 outline-success outline-dashed"
                aria-hidden="true"
              />
              Past payment (record)
            </li>
          ) : null}
          <li className="flex items-center gap-1.5">
            <span
              className="flex size-4 items-center justify-center rounded-full bg-foreground-secondary text-[10px] font-bold text-white"
              aria-hidden="true"
            >
              ₹
            </span>
            Payday (coloured by what it pays)
          </li>
          {(["absent", "half_day"] as const).map((kind) => (
            <li key={kind} className="flex items-center gap-1.5">
              <span
                className={cn(
                  "flex size-3.5 items-center justify-center rounded-full text-[9px] font-bold text-white",
                  ABSENCE_BADGE[kind],
                )}
                aria-hidden="true"
              >
                {ABSENCE_SHORT[kind]}
              </span>
              {kind === "absent" ? "Absent" : "Half-day"}
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
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
