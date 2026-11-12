"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import { addRealDays } from "@convex/lib/companyCalendar";
import { PaydayList } from "@/components/admin/payday-list";
import { usePropertyScope } from "@/components/app/property-scope";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { LoadingState } from "@/components/ui/skeleton";
import { useQuery } from "@/lib/convex";
import { addMonths, formatDay, formatINR, formatMonth } from "@/lib/format";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const mondayOffset = (date: string) =>
  (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7;

function monthRange(month: string) {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return {
    from: `${month}-01`,
    to: `${month}-${String(last).padStart(2, "0")}`,
  };
}

type DayState = "paid" | "owed" | "upcoming";
const TONE: Record<DayState, string> = {
  paid: "border-success-border bg-success-subtle text-success",
  owed: "border-danger-border bg-danger-subtle text-danger-text",
  upcoming: "border-info-border bg-info-subtle text-info",
};
const STATE_TEXT: Record<DayState, string> = {
  paid: "all paid",
  owed: "not fully paid",
  upcoming: "to come",
};

/**
 * Dashboard: a month calendar with every day someone's pay is due marked:
 * red when it has passed and isn't fully paid, blue when it's still to come,
 * green when all of it is paid. Each day shows how many paydays and how much.
 * Tap a day to list them.
 */
export function DuesCalendar({ today }: { today: string }) {
  const scope = usePropertyScope();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [picked, setPicked] = useState<string | null>(today);
  const range = monthRange(month);
  const data = useQuery(api.paydays.range, { ...range, ...scope.arg });

  const byDate = new Map<string, NonNullable<typeof data>["rows"]>();
  for (const row of data?.rows ?? [])
    byDate.set(row.dueDate, [...(byDate.get(row.dueDate) ?? []), row]);
  const stateOf = (
    rows: NonNullable<typeof data>["rows"],
    date: string,
  ): DayState =>
    rows.every((r) => r.outstanding <= 0)
      ? "paid"
      : date <= today
        ? "owed"
        : "upcoming";

  const dates: string[] = [];
  for (let d = range.from; d <= range.to; d = addRealDays(d, 1)) dates.push(d);
  const pickedRows = picked ? (byDate.get(picked) ?? []) : [];

  return (
    <section aria-labelledby="dues-calendar" className="flex flex-col gap-2">
      <h2 id="dues-calendar" className="font-serif text-2xl tracking-tight">
        Payday calendar
      </h2>
      <Card>
        <CardBody className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Previous month"
              onClick={() => (setMonth(addMonths(month, -1)), setPicked(null))}
            >
              <Icon icon={ChevronLeft} />
            </Button>
            <h3 className="font-serif text-xl" aria-live="polite">
              {formatMonth(month)}
            </h3>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Next month"
              onClick={() => (setMonth(addMonths(month, 1)), setPicked(null))}
            >
              <Icon icon={ChevronRight} />
            </Button>
          </div>
          <div
            className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-foreground-secondary"
            aria-hidden="true"
          >
            {WEEKDAYS.map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>
          {data === undefined ? (
            <LoadingState rows={3} />
          ) : (
            <ol
              className="grid grid-cols-7 gap-1"
              aria-label={`Paydays in ${formatMonth(month)}`}
            >
              {Array.from({ length: mondayOffset(range.from) }, (_, i) => (
                <li key={`blank-${i}`} aria-hidden="true" />
              ))}
              {dates.map((date) => {
                const rows = byDate.get(date) ?? [];
                const state = rows.length > 0 ? stateOf(rows, date) : null;
                const total = rows.reduce(
                  (a, r) => a + (r.outstanding > 0 ? r.outstanding : r.net),
                  0,
                );
                const label =
                  rows.length > 0
                    ? `${formatDay(date, "d MMM")}: ${rows.length} ${rows.length === 1 ? "payday" : "paydays"}, ${formatINR(total)}, ${STATE_TEXT[state!]}`
                    : `${formatDay(date, "d MMM")}: no paydays`;
                return (
                  <li key={date}>
                    <button
                      type="button"
                      aria-label={label}
                      aria-pressed={picked === date}
                      onClick={() => setPicked(date)}
                      className={cn(
                        "flex h-16 w-full flex-col items-center justify-start gap-0.5 rounded-sm border px-0.5 pt-1 text-foreground sm:h-20",
                        state ? TONE[state] : "border-border bg-surface",
                        date === today && "ring-2 ring-foreground ring-inset",
                        picked === date &&
                          "shadow-[inset_0_-3px_0_currentColor]",
                      )}
                    >
                      <span
                        className={cn(
                          "tabular text-xs",
                          date === today && "font-bold",
                        )}
                      >
                        {Number(date.slice(8))}
                      </span>
                      {rows.length > 0 ? (
                        <>
                          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-current px-1 text-[11px] font-bold">
                            <span className="text-white">{rows.length}</span>
                          </span>
                          <span className="tabular hidden text-[11px] leading-tight font-medium sm:block">
                            {formatINR(total)}
                          </span>
                        </>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
          <ul
            className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-foreground-secondary"
            aria-label="Key"
          >
            {(["owed", "upcoming", "paid"] as const).map((s) => (
              <li key={s} className="flex items-center gap-1.5">
                <span
                  className={cn("size-3.5 rounded-sm border", TONE[s])}
                  aria-hidden="true"
                />
                {s === "owed"
                  ? "Due, not fully paid"
                  : s === "upcoming"
                    ? "Still to come"
                    : "All paid"}
              </li>
            ))}
            <li>The number is how many paydays fall that day.</li>
          </ul>
        </CardBody>
      </Card>
      {picked ? (
        pickedRows.length > 0 ? (
          <Card>
            <p className="border-b border-border px-4 py-2 text-sm font-medium">
              {formatDay(picked, "EEEE d MMMM")}
            </p>
            <PaydayList
              rows={pickedRows}
              label={`Paydays on ${formatDay(picked, "d MMM")}`}
            />
          </Card>
        ) : (
          <p className="text-sm text-foreground-secondary">
            No paydays on {formatDay(picked, "d MMMM")}.
          </p>
        )
      ) : null}
    </section>
  );
}
