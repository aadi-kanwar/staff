"use client";

import { useMutation } from "convex/react";
import { Download } from "lucide-react";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { addRealDays } from "@convex/lib/companyCalendar";
import { usePropertyScope } from "@/components/app/property-scope";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { PageHeader } from "@/components/ui/page-header";
import { LoadingState } from "@/components/ui/skeleton";
import { DetailList } from "@/components/ui/stat";
import { toast } from "@/components/ui/toaster";
import { useQuery } from "@/lib/convex";
import { friendlyError } from "@/lib/errors";
import { formatDay, formatINR, todayIn } from "@/lib/format";

type Kind = "attendance" | "attendance_summary" | "paydays" | "payments";

/** Matches MAX_REPORT_DAYS in convex/reports.ts. */
const KINDS: { value: Kind; label: string; maxDays: number; about: string }[] =
  [
    {
      value: "attendance_summary",
      label: "Attendance summary",
      maxDays: 366,
      about:
        "One row per person: working days, and how many were Present, Half-day, Absent, Paid leave, Week-off or not marked.",
    },
    {
      value: "attendance",
      label: "Attendance (day by day)",
      maxDays: 100,
      about:
        "One row per person per day they were working, with that day's mark.",
    },
    {
      value: "paydays",
      label: "Paydays",
      maxDays: 366,
      about:
        "Every payday falling in these dates: cycle, paid days, earnings, bonus, deductions, advances, net, paid and still owed.",
    },
    {
      value: "payments",
      label: "Payments made",
      maxDays: 366,
      about:
        "Every payment recorded with a payment date in these dates: amount, mode and which payday it was for.",
    },
  ];

/** Download a CSV text as a file (with a byte-order mark so Excel reads it as UTF-8, ₹ included). */
function downloadCsv(filename: string, csv: string) {
  const url = URL.createObjectURL(
    new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" }),
  );
  const link = Object.assign(document.createElement("a"), {
    href: url,
    download: filename,
  });
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export default function ReportsPage() {
  const { arg, current, properties } = usePropertyScope();
  const today = todayIn();
  const monthStart = `${today.slice(0, 8)}01`;
  const [kind, setKind] = useState<Kind>("attendance_summary");
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const [staffId, setStaffId] = useState<Id<"staff"> | "">("");
  const people = useQuery(api.people.list, arg);
  const person = people?.find((p) => p.staffId === staffId);
  // Only someone shown for the property chosen now (the choice may have changed since).
  const forWhom = person ? { staffId: person.staffId } : {};
  const spec = KINDS.find((k) => k.value === kind)!;
  const problem =
    from === "" || to === ""
      ? "Choose a start and an end date."
      : to < from
        ? "The end date must be on or after the start date."
        : addRealDays(from, spec.maxDays - 1) < to
          ? `This report can cover at most ${spec.maxDays} days.`
          : null;
  const summary = useQuery(
    api.reports.summary,
    problem === null ? { ...arg, kind, from, to, ...forWhom } : "skip",
  );
  const exportCsv = useMutation(api.reports.exportCsv);
  const [busy, setBusy] = useState(false);

  const lastMonthEnd = addRealDays(monthStart, -1);
  const presets = [
    { label: "This month", from: monthStart, to: today },
    {
      label: "Last month",
      from: `${lastMonthEnd.slice(0, 8)}01`,
      to: lastMonthEnd,
    },
    { label: "Last 7 days", from: addRealDays(today, -6), to: today },
  ];
  const scopeName =
    current?.name ?? (properties.length > 1 ? "All properties" : "");

  return (
    <>
      <PageHeader
        title="Reports"
        description="Attendance, paydays and payments for the dates you choose. Downloads as a spreadsheet (CSV) that opens in Excel or Google Sheets."
      />
      <Card className="max-w-2xl">
        <CardBody className="flex flex-col gap-4">
          <Field id="report-kind" label="Report" hint={spec.about}>
            {(p) => (
              <NativeSelect
                {...p}
                value={kind}
                onChange={(e) => setKind(e.target.value as Kind)}
              >
                {KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          <Field
            id="report-who"
            label="For"
            hint={
              person
                ? `Only ${person.name}.`
                : scopeName
                  ? `Everyone at ${scopeName === "All properties" ? "every property" : scopeName}.`
                  : "Everyone."
            }
          >
            {(p) => (
              <NativeSelect
                {...p}
                value={person ? staffId : ""}
                onChange={(e) => setStaffId(e.target.value as Id<"staff"> | "")}
              >
                <option value="">All staff</option>
                {(people ?? []).map((s) => (
                  <option key={s.staffId} value={s.staffId}>
                    {s.name}
                    {current === null && properties.length > 1
                      ? ` · ${s.propertyName}`
                      : ""}
                    {s.status === "exited" ? " (left)" : ""}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          <div
            className="flex flex-wrap gap-2"
            role="group"
            aria-label="Quick ranges"
          >
            {presets.map((p) => (
              <Button
                key={p.label}
                variant={
                  from === p.from && to === p.to ? "primary" : "secondary"
                }
                aria-pressed={from === p.from && to === p.to}
                onClick={() => {
                  setFrom(p.from);
                  setTo(p.to);
                }}
              >
                {p.label}
              </Button>
            ))}
          </div>
          <div className="grid grid-cols-2 items-end gap-3 sm:flex">
            <Field id="report-from" label="From" className="sm:w-44">
              {(p) => (
                <Input
                  {...p}
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
              )}
            </Field>
            <Field id="report-to" label="To" className="sm:w-44">
              {(p) => (
                <Input
                  {...p}
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                />
              )}
            </Field>
            <Button
              className="col-span-2"
              loading={busy}
              disabled={problem !== null}
              onClick={async () => {
                setBusy(true);
                try {
                  const { filename, csv } = await exportCsv({
                    ...arg,
                    kind,
                    from,
                    to,
                    ...forWhom,
                  });
                  downloadCsv(filename, csv);
                  toast.success("Report downloaded.");
                } catch (error) {
                  toast.error(friendlyError(error));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Icon icon={Download} />
              Download CSV
            </Button>
          </div>
          {problem !== null && from !== "" && to !== "" ? (
            <Banner tone="danger">{problem}</Banner>
          ) : null}
        </CardBody>
      </Card>

      {problem !== null ? null : summary === undefined ? (
        <LoadingState rows={3} label="Loading the report" />
      ) : (
        <section
          aria-labelledby="summary"
          className="flex max-w-2xl flex-col gap-2"
        >
          <h2 id="summary" className="font-serif text-2xl tracking-tight">
            {person ? `${person.name} · ` : scopeName ? `${scopeName} · ` : ""}
            {formatDay(from, "d MMM yyyy")} – {formatDay(to, "d MMM yyyy")}
          </h2>
          <Card>
            <CardBody>
              <DetailList
                rows={summary.totals.map((t) => ({
                  label: t.label.replace(" (₹)", ""),
                  value: t.label.endsWith("(₹)")
                    ? formatINR(Number(t.value))
                    : String(t.value),
                }))}
              />
            </CardBody>
          </Card>
          <p className="text-sm text-foreground-secondary">
            {summary.rows === 0
              ? "Nothing to list for these dates; the download would have only the column headings."
              : `The download has ${summary.rows} ${summary.rows === 1 ? "row" : "rows"}.`}
          </p>
        </section>
      )}
    </>
  );
}
