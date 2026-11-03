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
import { formatDay, formatINR, todayIn } from "@/lib/format";

type Filter = "due" | "upcoming" | "all";

export default function PayrollPage() {
  const scope = usePropertyScope();
  const showProperty = useShowProperty();
  const data = useQuery(api.paydays.overview, { days: 31, ...scope.arg });
  const [filter, setFilter] = useState<Filter>("due");
  const [department, setDepartment] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  if (data === undefined) return <LoadingState rows={5} />;
  const departments = [...new Set(data.rows.map((r) => r.department))].sort();
  const byFilter = (r: OpenRow) =>
    filter === "all"
      ? true
      : filter === "due"
        ? r.dueDate <= data.today
        : r.dueDate > data.today;
  const rows = data.rows.filter(
    (r) => byFilter(r) && (department === "" || r.department === department),
  );
  const chosen = data.rows.filter(
    (r) => selected.has(r.key) && r.outstanding > 0,
  );
  const toggle = (key: string) => {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelected(next);
  };
  const dueCount = data.rows.filter((r) => r.dueDate <= data.today).length;
  return (
    <>
      <PageHeader
        title="Payroll"
        description={`Every payday that's due, and those coming in the next month: ${scope.current?.name ?? "all properties"}.`}
      />
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat
          label="Due now"
          value={formatINR(data.dueNow)}
          emphasis={data.dueNow > 0}
          hint={`${dueCount} paydays`}
        />
        <Stat
          label="Coming in 31 days"
          value={formatINR(
            data.rows
              .filter((r) => r.dueDate > data.today)
              .reduce((a, r) => a + r.outstanding, 0),
          )}
          hint="Projected, assuming Present for the remaining days"
        />
      </dl>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SegmentedTabs
          label="Which paydays"
          className="sm:w-96"
          items={[
            { value: "due", label: "Due now", count: dueCount },
            { value: "upcoming", label: "Upcoming" },
            { value: "all", label: "All" },
          ]}
          value={filter}
          onChange={setFilter}
        />
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
      {rows.length === 0 ? (
        <EmptyState
          icon={CircleCheck}
          title={filter === "due" ? "Nothing is due" : "No paydays here"}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-5 accent-primary"
                checked={rows.every((r) => selected.has(r.key))}
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
                    <input
                      type="checkbox"
                      aria-label={`Select ${row.name}, ${formatDay(row.dueDate)}`}
                      className="mt-1 size-5 shrink-0 accent-primary"
                      checked={selected.has(row.key)}
                      disabled={row.outstanding <= 0}
                      onChange={() => toggle(row.key)}
                    />
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
                      </div>
                      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                        <span className="tabular font-semibold">
                          {formatINR(row.outstanding)}
                        </span>
                        <PaydayStatusBadge
                          status={row.status}
                          overdue={row.overdue}
                        />
                        <RecordPaymentDialog
                          staffId={row.staffId}
                          paydayKey={row.key}
                          outstanding={row.outstanding}
                          title={`${row.name}, ${formatDay(row.dueDate, "d MMM")}`}
                          trigger="Pay"
                        />
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
        description={`${rows.length} paydays, ${formatINR(total)} in total, each paid in full.`}
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
