import { CircleAlert } from "lucide-react";
import type { PaydayRow } from "@convex/lib/adminViews";
import { Icon } from "@/components/ui/icon";
import { DetailList } from "@/components/ui/stat";
import { formatDay, formatINR } from "@/lib/format";

const days = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;

/** Admin-only breakdown of one payday: cycle, paid days, deductions, adjustments. */
export function PaydayBreakdown({ row }: { row: PaydayRow }) {
  const c = row.counts;
  const rows = [
    { label: "Cycle", value: `${formatDay(row.cycleStartDate, "d MMM")} – ${formatDay(row.cycleEndDate, "d MMM yyyy")}` },
    { label: "Pay mode", value: row.payModeLabel },
    {
      label: "Paid days",
      value: `${row.paidDays} of ${row.cycleDays}`,
    },
    { label: "Full-attendance earning", value: formatINR(row.fullEarning, { exact: true }) },
    ...(c.absent > 0 ? [{ label: `Absent × ${c.absent}`, value: formatINR(-row.absentDeduction, { exact: true }) }] : []),
    ...(c.half_day > 0 ? [{ label: `Half-day × ${c.half_day}`, value: formatINR(-row.halfDayDeduction, { exact: true }) }] : []),
    ...(row.bonus > 0 ? [{ label: "Bonus", value: formatINR(row.bonus, { signed: true }) }] : []),
    ...(row.deduction > 0 ? [{ label: "Deduction", value: formatINR(-row.deduction) }] : []),
    ...(row.advance > 0 ? [{ label: "Advance recovered", value: formatINR(-row.advance) }] : []),
    { label: "Net payable", value: formatINR(row.net), strong: true },
    ...(row.paid > 0 ? [{ label: "Paid", value: formatINR(-row.paid) }, { label: "Still owed", value: formatINR(row.outstanding), strong: true }] : []),
  ];
  const extra = [
    c.paid_leave ? `${days(c.paid_leave)} paid leave` : null,
    c.week_off ? `${days(c.week_off)} week-off` : null,
    c.virtual ? `${days(c.virtual)} virtual Feb (paid)` : null,
  ].filter(Boolean);
  return (
    <div className="flex flex-col gap-2">
      <DetailList rows={rows} />
      {extra.length > 0 ? <p className="text-xs text-foreground-secondary">Includes {extra.join(", ")}.</p> : null}
      {row.unmarkedDates.length > 0 ? (
        <p className="flex items-start gap-2 text-sm text-warning">
          <Icon icon={CircleAlert} className="mt-0.5" />
          <span>
            {days(row.unmarkedDates.length)} unmarked, counted as Present: {row.unmarkedDates.map((d) => formatDay(d, "d MMM")).join(", ")}
          </span>
        </p>
      ) : null}
    </div>
  );
}
