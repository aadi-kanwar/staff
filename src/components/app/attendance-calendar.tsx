"use client";

import type { AttendanceStatus } from "@convex/lib/payroll";
import { ATTENDANCE_LABEL, ATTENDANCE_OPTIONS, ATTENDANCE_TONE } from "@/lib/labels";
import { cn } from "@/lib/utils";

export type CalendarDay = {
  date: string;
  status: AttendanceStatus | null;
  working: boolean;
  future: boolean;
  /** Admin only: a past working day with no mark. */
  unmarked?: boolean;
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Monday-first offset of a date's weekday. */
function mondayOffset(date: string) {
  return (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7;
}

/** A month of attendance as a 7-column calendar. With `onSelect`, days are buttons. */
export function AttendanceCalendar({
  days,
  today,
  onSelect,
}: {
  days: CalendarDay[];
  today: string;
  onSelect?: (day: CalendarDay) => void;
}) {
  const blanks = days.length > 0 ? mondayOffset(days[0].date) : 0;
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-foreground-secondary" aria-hidden="true">
        {WEEKDAYS.map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <ol className="grid grid-cols-7 gap-1">
        {Array.from({ length: blanks }, (_, i) => (
          <li key={`blank-${i}`} aria-hidden="true" />
        ))}
        {days.map((day) => {
          const n = Number(day.date.slice(8));
          const short = day.status ? ATTENDANCE_OPTIONS.find((o) => o.value === day.status)!.short : null;
          const description = day.status
            ? ATTENDANCE_LABEL[day.status]
            : !day.working
              ? "Not working"
              : day.unmarked
                ? "Not marked"
                : day.future
                  ? "Upcoming"
                  : "No mark";
          const content = (
            <>
              <span className={cn("text-xs", day.date === today && "font-semibold text-primary-text")}>{n}</span>
              <span className="text-sm font-semibold">{short ?? (day.unmarked ? "?" : "")}</span>
            </>
          );
          const classes = cn(
            "flex aspect-square min-h-11 w-full flex-col items-center justify-center gap-0.5 rounded-sm border text-foreground",
            day.status ? ATTENDANCE_TONE[day.status] : day.unmarked ? "border-dashed border-warning-border bg-warning-subtle text-warning" : "border-border bg-surface",
            !day.working && "border-transparent bg-transparent text-foreground-muted",
            day.date === today && "outline-2 outline-offset-1 outline-primary",
          );
          const label = `${day.date}: ${description}`;
          return (
            <li key={day.date}>
              {onSelect && day.working ? (
                <button type="button" className={cn(classes, "hover:border-border-strong")} aria-label={label} onClick={() => onSelect(day)}>
                  {content}
                </button>
              ) : (
                <div className={classes} aria-label={label} role="img">
                  {content}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Counts per status, as small labelled tiles. */
export function AttendanceSummary({ counts, unmarked }: { counts: Record<AttendanceStatus, number>; unmarked?: number }) {
  return (
    <dl className="grid grid-cols-3 gap-2 sm:grid-cols-6">
      {ATTENDANCE_OPTIONS.map((o) => (
        <div key={o.value} className={cn("flex flex-col rounded-md border px-3 py-1.5", ATTENDANCE_TONE[o.value])}>
          <dt className="truncate text-xs">{o.label}</dt>
          <dd className="tabular text-xl font-semibold">{counts[o.value]}</dd>
        </div>
      ))}
      {unmarked !== undefined ? (
        <div className={cn("flex flex-col rounded-md border px-3 py-1.5", unmarked > 0 ? "border-dashed border-warning-border bg-warning-subtle text-warning" : "border-border bg-surface")}>
          <dt className="truncate text-xs">Unmarked</dt>
          <dd className="tabular text-xl font-semibold">{unmarked}</dd>
        </div>
      ) : null}
    </dl>
  );
}

/** Five one-tap buttons to choose a status. */
export function StatusPicker({
  value,
  onChange,
  name,
  disabled = false,
}: {
  value: AttendanceStatus;
  onChange: (status: AttendanceStatus) => void;
  name: string;
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={`Attendance for ${name}`} className="grid grid-cols-5 gap-1">
      {ATTENDANCE_OPTIONS.map((o) => {
        const selected = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={o.label}
            title={o.label}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={cn(
              "flex min-h-11 min-w-11 flex-col items-center justify-center rounded-sm border text-sm font-semibold transition-colors disabled:opacity-50",
              selected ? ATTENDANCE_TONE[o.value] : "border-border bg-surface text-foreground-secondary hover:bg-subtle",
              selected && "ring-2 ring-current ring-inset",
            )}
          >
            {o.short}
            <span className="hidden max-w-full truncate px-1 text-xs font-medium lg:block">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
