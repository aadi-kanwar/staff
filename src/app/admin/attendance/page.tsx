"use client";

import { useMutation } from "convex/react";
import type { AttendanceStatus } from "@convex/lib/payroll";
import type { Id } from "@convex/_generated/dataModel";
import { ChevronLeft, ChevronRight, History, Save, Users } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { api } from "@convex/_generated/api";
import { StatusPicker } from "@/components/app/attendance-calendar";
import { StaffMonth } from "@/components/admin/staff-month";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { PageHeader } from "@/components/ui/page-header";
import { LoadingState } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/states";
import { StatusBadge } from "@/components/ui/status-badge";
import { SegmentedTabs } from "@/components/ui/tabs";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { toast } from "@/components/ui/toaster";
import { useQuery } from "@/lib/convex";
import { usePropertyScope } from "@/components/app/property-scope";
import { friendlyError } from "@/lib/errors";
import {
  addMonths,
  formatDateTime,
  formatDay,
  formatMonth,
  todayIn,
} from "@/lib/format";
import { addRealDays } from "@convex/lib/companyCalendar";
import { ATTENDANCE_LABEL } from "@/lib/labels";

type Tab = "daily" | "month" | "log";

export default function AttendancePage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <Attendance />
    </Suspense>
  );
}

function useQueryState(name: string, fallback: string) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const value = params.get(name) ?? fallback;
  const set = (next: string) => {
    const copy = new URLSearchParams(params.toString());
    copy.set(name, next);
    router.replace(`${pathname}?${copy.toString()}`, { scroll: false });
  };
  return [value, set] as const;
}

function Attendance() {
  const [tab, setTab] = useQueryState("tab", "daily");
  return (
    <>
      <PageHeader
        title="Attendance"
        description="Mark the day for everyone, check one person's month, or see every change."
      />
      <SegmentedTabs
        label="Attendance views"
        idPrefix="attendance"
        className="sm:w-96"
        items={[
          { value: "daily", label: "Daily" },
          { value: "month", label: "Month" },
          { value: "log", label: "Change log" },
        ]}
        value={tab as Tab}
        onChange={setTab}
      />
      <div
        id="attendance-panel"
        role="tabpanel"
        className="flex flex-col gap-4"
      >
        {tab === "month" ? (
          <MonthView />
        ) : tab === "log" ? (
          <LogView />
        ) : (
          <DailyGrid />
        )}
      </div>
    </>
  );
}

function DailyGrid() {
  const today = todayIn();
  const [date, setDate] = useQueryState("date", today);
  const scope = usePropertyScope();
  const data = useQuery(api.attendance.day, { date, ...scope.arg });
  const save = useMutation(api.attendance.saveDay);
  const [drafts, setDrafts] = useState<
    Record<string, Record<string, AttendanceStatus>>
  >({});
  const [department, setDepartment] = useState("");
  const [busy, setBusy] = useState(false);
  const draft = drafts[date] ?? {};
  const departments = useMemo(
    () => [...new Set((data?.rows ?? []).map((r) => r.department))].sort(),
    [data],
  );

  if (data === undefined) return <LoadingState rows={5} />;
  const rows = data.rows.filter(
    (r) => department === "" || r.department === department,
  );
  const effective = (r: (typeof rows)[number]): AttendanceStatus =>
    draft[r.staffId] ?? r.status ?? "present";
  const changed = data.rows.filter(
    (r) =>
      r.status === null ||
      (draft[r.staffId] !== undefined && draft[r.staffId] !== r.status),
  ).length;
  const unmarked = data.rows.filter((r) => r.status === null).length;

  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex items-end gap-2">
          <Button
            variant="secondary"
            size="icon"
            aria-label="Previous day"
            onClick={() => setDate(addRealDays(date, -1))}
          >
            <Icon icon={ChevronLeft} />
          </Button>
          <Field id="grid-date" label="Date" className="flex-1">
            {(p) => (
              <Input
                {...p}
                type="date"
                value={date}
                max={addRealDays(today, 31)}
                onChange={(e) => e.target.value && setDate(e.target.value)}
              />
            )}
          </Field>
          <Button
            variant="secondary"
            size="icon"
            aria-label="Next day"
            disabled={date >= today}
            onClick={() => setDate(addRealDays(date, 1))}
          >
            <Icon icon={ChevronRight} />
          </Button>
        </div>
        {departments.length > 1 ? (
          <Field id="grid-dept" label="Department" className="sm:w-56">
            {(p) => (
              <NativeSelect
                {...p}
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
              >
                <option value="">All departments</option>
                {departments.map((d) => (
                  <option key={d}>{d}</option>
                ))}
              </NativeSelect>
            )}
          </Field>
        ) : null}
      </div>
      <p className="text-sm text-foreground-secondary">
        {formatDay(date, "EEEE d MMMM yyyy")} · {data.marked} of{" "}
        {data.rows.length} marked. Everyone not marked yet starts as Present:
        tap to change, then save.
      </p>
      {!data.countsForPay ? (
        <Banner tone="info">
          The 31st is recorded for the register but doesn&apos;t count towards
          pay.
        </Banner>
      ) : null}
      {date > today ? (
        <Banner tone="info">
          This day is in the future: use it for planned leave or week-offs.
        </Banner>
      ) : null}
      {rows.length === 0 ? (
        <EmptyState icon={Users} title="No one was working on this day" />
      ) : (
        <Card>
          <ul className="divide-y divide-border" aria-label="Staff">
            {rows.map((row) => (
              <li
                key={row.staffId}
                className="flex flex-col gap-2 px-4 py-3 md:flex-row md:items-center md:justify-between"
              >
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="font-medium">{row.name}</span>
                  <span className="text-sm text-foreground-secondary">
                    {row.propertyName ? `${row.propertyName} · ` : null}
                    {row.department}
                  </span>
                  {row.status === null ? (
                    <StatusBadge tone="warning" icon={History}>
                      Not marked yet
                    </StatusBadge>
                  ) : null}
                </div>
                <div className="md:w-88">
                  <StatusPicker
                    name={row.name}
                    value={effective(row)}
                    onChange={(status) =>
                      setDrafts({
                        ...drafts,
                        [date]: { ...draft, [row.staffId]: status },
                      })
                    }
                  />
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <div className="sticky bottom-0 -mx-4 flex flex-col gap-2 border-t border-border bg-background px-4 py-3 sm:flex-row sm:items-center sm:justify-between md:-mx-8 md:px-8">
        <span className="text-sm text-foreground-secondary">
          {changed === 0
            ? "Everything is saved."
            : `${changed} to save${unmarked > 0 ? ` (${unmarked} not marked yet)` : ""}.`}
        </span>
        <Button
          loading={busy}
          disabled={changed === 0}
          onClick={async () => {
            setBusy(true);
            try {
              const result = await save({
                date,
                entries: data.rows.map((r) => ({
                  staffId: r.staffId,
                  status: effective(r),
                })),
              });
              setDrafts({ ...drafts, [date]: {} });
              toast.success(
                result.changed === 0
                  ? "Nothing changed."
                  : `Saved ${result.changed} ${result.changed === 1 ? "change" : "changes"}.`,
              );
            } catch (error) {
              toast.error(friendlyError(error));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? null : <Icon icon={Save} />}
          Save attendance
        </Button>
      </div>
    </>
  );
}

function StaffPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const scope = usePropertyScope();
  const people = useQuery(api.people.list, scope.arg);
  return (
    <Field id="month-staff" label="Staff member" className="sm:w-72">
      {(p) => (
        <NativeSelect
          {...p}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={people === undefined}
        >
          <option value="">
            {people === undefined ? "Loading…" : "Choose someone"}
          </option>
          {people?.map((s) => (
            <option key={s.staffId} value={s.staffId}>
              {s.name}
              {s.status === "exited" ? " (left)" : ""}
            </option>
          ))}
        </NativeSelect>
      )}
    </Field>
  );
}

function MonthView() {
  const today = todayIn();
  const [staffId, setStaffId] = useQueryState("staff", "");
  const [month, setMonth] = useQueryState("month", today.slice(0, 7));
  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <StaffPicker value={staffId} onChange={setStaffId} />
        <div className="flex items-end gap-2">
          <Button
            variant="secondary"
            size="icon"
            aria-label="Previous month"
            onClick={() => setMonth(addMonths(month, -1))}
          >
            <Icon icon={ChevronLeft} />
          </Button>
          <span className="flex min-h-11 min-w-40 items-center justify-center font-medium">
            {formatMonth(month)}
          </span>
          <Button
            variant="secondary"
            size="icon"
            aria-label="Next month"
            onClick={() => setMonth(addMonths(month, 1))}
          >
            <Icon icon={ChevronRight} />
          </Button>
        </div>
      </div>
      {staffId === "" ? (
        <EmptyState
          icon={Users}
          title="Choose a staff member"
          description="See and correct their attendance for any month."
        />
      ) : (
        <StaffMonth staffId={staffId as Id<"staff">} month={month} />
      )}
    </>
  );
}

function LogView() {
  const [staffId, setStaffId] = useQueryState("staff", "");
  const scope = usePropertyScope();
  const rows = useQuery(
    api.attendance.log,
    staffId
      ? { staffId: staffId as Id<"staff">, limit: 200 }
      : { limit: 200, ...scope.arg },
  );
  return (
    <>
      <StaffPicker value={staffId} onChange={setStaffId} />
      {rows === undefined ? (
        <LoadingState />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={History}
          title="No changes yet"
          description="Every attendance change will be listed here, permanently."
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>When</TH>
              <TH>Staff</TH>
              <TH>Day</TH>
              <TH>Change</TH>
              <TH>By</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((row) => (
              <TR key={row.logId}>
                <TD className="whitespace-nowrap text-foreground-secondary">
                  {formatDateTime(row.changedAt)}
                </TD>
                <TD className="font-medium">{row.staffName}</TD>
                <TD className="whitespace-nowrap">
                  {formatDay(row.date, "d MMM yyyy")}
                </TD>
                <TD className="whitespace-nowrap">
                  {row.oldStatus
                    ? ATTENDANCE_LABEL[row.oldStatus]
                    : "Not marked"}{" "}
                  → <strong>{ATTENDANCE_LABEL[row.newStatus]}</strong>
                </TD>
                <TD className="text-foreground-secondary">
                  {row.changedByName}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </>
  );
}
