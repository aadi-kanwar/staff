"use client";

import { useMutation } from "convex/react";
import { CircleCheck, HandCoins } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import {
  PaymentModeSelect,
  RecordPaymentDialog,
} from "@/components/admin/money-dialogs";
import type { OpenRow } from "@/components/admin/payday-list";
import { PaydayBreakdown } from "@/components/admin/payday-breakdown";
import { PaydayStatusBadge } from "@/components/app/payday-status";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { PageHeader } from "@/components/ui/page-header";
import { LoadingState } from "@/components/ui/skeleton";
import { DetailList, Stat } from "@/components/ui/stat";
import { EmptyState } from "@/components/ui/states";
import { SegmentedTabs } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toaster";
import { useQuery } from "@/lib/convex";
import {
  usePropertyScope,
  useShowProperty,
} from "@/components/app/property-scope";
import { friendlyError } from "@/lib/errors";
import { addMonths, formatDay, formatINR, todayIn } from "@/lib/format";
import { addRealDays } from "@convex/lib/companyCalendar";
import { PropertyFilter } from "@/components/admin/property-filter";

type Filter = "owed" | "upcoming" | "paid" | "all";
type Preset = "this-month" | "next-30" | "last-month" | "custom";

/** First and last day of the calendar month containing `date`. */
function monthOf(date: string) {
  const [y, m] = date.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return {
    from: `${date.slice(0, 7)}-01`,
    to: `${date.slice(0, 7)}-${String(last).padStart(2, "0")}`,
  };
}

function presetRange(preset: Exclude<Preset, "custom">, today: string) {
  if (preset === "this-month") return monthOf(today);
  if (preset === "last-month")
    return monthOf(`${addMonths(today.slice(0, 7), -1)}-01`);
  return { from: today, to: addRealDays(today, 30) };
}

const PRESETS: { value: Preset; label: string }[] = [
  { value: "this-month", label: "This month" },
  { value: "next-30", label: "Next 30 days" },
  { value: "last-month", label: "Last month" },
  { value: "custom", label: "Choose dates" },
];

export default function PayrollPage() {
  const scope = usePropertyScope();
  const showProperty = useShowProperty();
  const today = todayIn();
  const [preset, setPreset] = useState<Preset>("this-month");
  const [custom, setCustom] = useState(() => monthOf(today));
  const range = preset === "custom" ? custom : presetRange(preset, today);
  const rangeOk =
    range.from !== "" && range.to !== "" && range.from <= range.to;
  const data = useQuery(
    api.paydays.range,
    rangeOk ? { ...range, ...scope.arg } : "skip",
  );
  const [filter, setFilter] = useState<Filter>("owed");
  const [department, setDepartment] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const rangePicker = (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <div className="sm:w-44">
        <NativeSelect
          aria-label="Dates"
          value={preset}
          onChange={(e) => setPreset(e.target.value as Preset)}
        >
          {PRESETS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </NativeSelect>
      </div>
      {preset === "custom" ? (
        <div className="grid grid-cols-2 gap-2">
          <Input
            aria-label="From"
            type="date"
            value={custom.from}
            onChange={(e) => setCustom({ ...custom, from: e.target.value })}
          />
          <Input
            aria-label="To"
            type="date"
            value={custom.to}
            onChange={(e) => setCustom({ ...custom, to: e.target.value })}
          />
        </div>
      ) : null}
    </div>
  );

  if (!rangeOk) {
    return (
      <>
        <PageHeader title="Payroll" />
        {rangePicker}
        <EmptyState title="Choose a start date on or before the end date" />
      </>
    );
  }
  if (data === undefined) return <LoadingState rows={5} />;
  const all = [...data.owedNow, ...data.rows];
  const departments = [...new Set(all.map((r) => r.department))].sort();
  const byDepartment = (r: OpenRow) =>
    department === "" || r.department === department;
  const lists: Record<Filter, OpenRow[]> = {
    owed: data.owedNow,
    upcoming: data.rows.filter(
      (r) => r.dueDate > data.today && r.outstanding > 0,
    ),
    paid: data.rows
      .filter((r) => r.outstanding <= 0)
      .sort((a, b) => b.dueDate.localeCompare(a.dueDate)),
    all: data.rows,
  };
  const rows = lists[filter].filter(byDepartment);
  const chosen = all.filter((r) => selected.has(r.key) && r.outstanding > 0);
  const toggle = (key: string) => {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelected(next);
  };
  const owedTotal = data.owedNow.reduce((a, r) => a + r.outstanding, 0);
  const monthName = formatDay(data.month.start, "MMMM");
  return (
    <>
      <PageHeader
        title="Payroll"
        description={`${scope.current?.name ?? "All properties"} · paydays from ${formatDay(data.from, "d MMM yyyy")} to ${formatDay(data.to, "d MMM yyyy")}. Anything owed now is always listed under Owed now.`}
      />
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Owed now"
          value={formatINR(owedTotal)}
          emphasis={owedTotal > 0}
          hint={`${data.owedNow.length} ${data.owedNow.length === 1 ? "payday" : "paydays"}, any month`}
        />
        <Stat
          label={`Due in ${monthName}`}
          value={formatINR(data.month.due)}
          hint={`${data.month.tickets} ${data.month.tickets === 1 ? "payday" : "paydays"}, 1–${Number(data.month.end.slice(8))} ${monthName}`}
        />
        <Stat
          label={`Pending in ${monthName}`}
          value={formatINR(data.month.pending)}
          warn={data.month.pending > 0}
          hint={`${data.month.tickets - data.month.paidTickets} not fully paid`}
        />
        <Stat
          label={`Paid in ${monthName}`}
          value={formatINR(data.month.paid)}
          hint="Payments made this month"
        />
      </dl>
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end">
          {rangePicker}
          <PropertyFilter />
          <div className="sm:w-52">
            <NativeSelect
              aria-label="Department"
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
            >
              <option value="">All departments</option>
              {departments.map((d) => (
                <option key={d}>{d}</option>
              ))}
            </NativeSelect>
          </div>
        </div>
        <SegmentedTabs
          label="Which paydays"
          className="sm:max-w-xl"
          items={[
            {
              value: "owed",
              label: "Owed now",
              count: lists.owed.filter(byDepartment).length,
            },
            {
              value: "upcoming",
              label: "Upcoming",
              count: lists.upcoming.filter(byDepartment).length,
            },
            {
              value: "paid",
              label: "Paid",
              count: lists.paid.filter(byDepartment).length,
            },
            { value: "all", label: "All" },
          ]}
          value={filter}
          onChange={setFilter}
        />
      </div>
      {rows.length === 0 ? (
        <EmptyState
          icon={CircleCheck}
          title={
            filter === "owed"
              ? "Nothing is owed"
              : filter === "paid"
                ? "Nothing paid in these dates"
                : "No paydays in these dates"
          }
        />
      ) : (
        <>
          <div
            className={
              filter === "paid"
                ? "hidden"
                : "flex flex-wrap items-center justify-between gap-2"
            }
          >
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-5 accent-primary"
                checked={
                  rows.some((r) => r.outstanding > 0) &&
                  rows
                    .filter((r) => r.outstanding > 0)
                    .every((r) => selected.has(r.key))
                }
                onChange={(e) =>
                  setSelected(
                    e.target.checked
                      ? new Set(
                          rows
                            .filter((r) => r.outstanding > 0)
                            .map((r) => r.key),
                        )
                      : new Set(),
                  )
                }
              />
              Select all shown
            </label>
            <PayManyDialog
              rows={chosen}
              onDone={() => setSelected(new Set())}
            />
          </div>
          <Card>
            <ul className="divide-y divide-border" aria-label="Paydays">
              {rows.map((row) => (
                <li key={row.key} className="flex flex-col gap-2 px-4 py-3">
                  <div className="flex items-start gap-3">
                    {row.outstanding > 0 ? (
                      <input
                        type="checkbox"
                        aria-label={`Select ${row.name}, ${formatDay(row.dueDate)}`}
                        className="mt-1 size-5 shrink-0 accent-primary"
                        checked={selected.has(row.key)}
                        onChange={() => toggle(row.key)}
                      />
                    ) : (
                      <span className="size-5 shrink-0" aria-hidden="true" />
                    )}
                    <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex min-w-0 flex-col">
                        <Link
                          href={`/admin/staff/${row.staffId}?tab=paydays`}
                          className="font-medium underline-offset-4 hover:underline"
                        >
                          {row.name}
                        </Link>
                        <span className="text-sm text-foreground-secondary">
                          {showProperty
                            ? `${scope.nameOf(row.propertyId)} · `
                            : null}
                          {row.department} ·{" "}
                          {row.kind === "final"
                            ? "Final settlement"
                            : row.isFinal
                              ? "Final cycle"
                              : "Payday"}{" "}
                          {formatDay(row.dueDate)}
                        </span>
                        {row.outstanding > 0 ? (
                          <span className="text-sm text-foreground-secondary">
                            Pay to: {row.payTo ?? "no payment details yet"}
                          </span>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                        <span className="tabular font-semibold">
                          {formatINR(
                            row.outstanding > 0 ? row.outstanding : row.net,
                          )}
                        </span>
                        {row.outstanding <= 0 && row.lastPaidOn ? (
                          <span className="text-sm text-foreground-secondary">
                            paid {formatDay(row.lastPaidOn, "d MMM")}
                          </span>
                        ) : null}
                        <PaydayStatusBadge
                          status={row.status}
                          overdue={row.overdue}
                        />
                        {row.outstanding > 0 ? (
                          <RecordPaymentDialog
                            staffId={row.staffId}
                            paydayKey={row.key}
                            outstanding={row.outstanding}
                            title={`${row.name}, ${formatDay(row.dueDate, "d MMM")}`}
                            trigger="Pay"
                          />
                        ) : null}
                      </div>
                    </div>
                  </div>
                  <details className="ml-8 text-sm">
                    <summary className="min-h-11 cursor-pointer content-center text-foreground-secondary">
                      Breakdown
                    </summary>
                    {row.kind === "payday" ? (
                      <PaydayBreakdown row={row} />
                    ) : (
                      <DetailList
                        rows={[
                          {
                            label: "Joining Reserve",
                            value: formatINR(row.reserveAmount),
                          },
                          {
                            label: "Unsettled adjustments",
                            value: formatINR(row.unsettledTotal, {
                              signed: true,
                            }),
                          },
                          { label: "Paid", value: formatINR(-row.paid) },
                          {
                            label: "Still owed",
                            value: formatINR(row.outstanding),
                            strong: true,
                          },
                        ]}
                      />
                    )}
                  </details>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </>
  );
}

/** Pays the full outstanding amount of every selected payday in one go. */
function PayManyDialog({
  rows,
  onDone,
}: {
  rows: OpenRow[];
  onDone: () => void;
}) {
  const recordMany = useMutation(api.payments.recordMany);
  const [open, setOpen] = useState(false);
  const [paidOn, setPaidOn] = useState(todayIn());
  const [mode, setMode] = useState<"cash" | "upi" | "bank">("upi");
  const [busy, setBusy] = useState(false);
  const total = rows.reduce((a, r) => a + r.outstanding, 0);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button disabled={rows.length === 0}>
          <Icon icon={HandCoins} />
          Pay selected{rows.length > 0 ? ` (${rows.length})` : ""}
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Record payments"
        description={`${rows.length} ${rows.length === 1 ? "payday" : "paydays"}, ${formatINR(total)} in total, each paid in full.`}
      >
        <ul className="flex max-h-48 flex-col divide-y divide-border overflow-y-auto rounded-md border border-border text-sm">
          {rows.map((r) => (
            <li key={r.key} className="flex justify-between gap-3 px-3 py-2">
              <span>
                {r.name} · {formatDay(r.dueDate, "d MMM")}
              </span>
              <span className="tabular">{formatINR(r.outstanding)}</span>
            </li>
          ))}
        </ul>
        <Field id="many-date" label="Paid on">
          {(p) => (
            <Input
              {...p}
              type="date"
              max={todayIn()}
              value={paidOn}
              onChange={(e) => setPaidOn(e.target.value)}
            />
          )}
        </Field>
        <PaymentModeSelect id="many-mode" value={mode} onChange={setMode} />
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const result = await recordMany({
                  items: rows.map((r) => ({
                    staffId: r.staffId,
                    paydayKey: r.key,
                    amount: r.outstanding,
                    paidOn,
                    mode,
                  })),
                });
                toast.success(`Recorded ${result.recorded} payments.`);
                setOpen(false);
                onDone();
              } catch (error) {
                toast.error(friendlyError(error));
              } finally {
                setBusy(false);
              }
            }}
          >
            Record {formatINR(total)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
