"use client";

import { useMutation } from "convex/react";
import { ChevronLeft, ChevronRight, History, Save, Users } from "lucide-react";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import { addRealDays } from "@convex/lib/companyCalendar";
import type { AttendanceStatus } from "@convex/lib/payroll";
import { StatusPicker } from "@/components/app/attendance-calendar";
import { useMe } from "@/components/app/session";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { LoadingState } from "@/components/ui/skeleton";
import { EmptyState, NotAuthorizedState } from "@/components/ui/states";
import { StatusBadge } from "@/components/ui/status-badge";
import { toast } from "@/components/ui/toaster";
import { useQuery } from "@/lib/convex";
import { friendlyError } from "@/lib/errors";
import { formatDay, todayIn } from "@/lib/format";

export default function MarkAttendancePage() {
  const me = useMe();
  if (me === undefined) return <LoadingState rows={4} />;
  if (!me?.canMarkAttendance) {
    return (
      <NotAuthorizedState description="Attendance marking hasn't been given to you. Ask an admin if you need it." />
    );
  }
  return <MarkingGrid />;
}

function MarkingGrid() {
  const today = todayIn();
  const [date, setDate] = useState(today);
  const data = useQuery(api.marking.day, { date });
  const save = useMutation(api.marking.saveDay);
  const [drafts, setDrafts] = useState<
    Record<string, Record<string, AttendanceStatus>>
  >({});
  const [busy, setBusy] = useState(false);
  const draft = drafts[date] ?? {};

  if (data === undefined) return <LoadingState rows={5} />;
  const effective = (r: (typeof data.rows)[number]): AttendanceStatus =>
    draft[r.staffId] ?? r.status ?? "present";
  const changed = data.rows.filter(
    (r) =>
      r.status === null ||
      (draft[r.staffId] !== undefined && draft[r.staffId] !== r.status),
  ).length;
  const unmarked = data.rows.filter((r) => r.status === null).length;

  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="font-serif text-3xl tracking-tight">Mark attendance</h1>
        <p className="text-sm text-foreground-secondary">{data.propertyName}</p>
      </div>
      <div className="flex items-center justify-between gap-2">
        <Button
          variant="secondary"
          size="icon"
          aria-label="Previous day"
          disabled={date <= data.earliest}
          onClick={() => setDate(addRealDays(date, -1))}
        >
          <Icon icon={ChevronLeft} />
        </Button>
        <div className="flex flex-col items-center">
          <span className="font-medium">
            {date === today ? "Today" : formatDay(date, "EEEE")}
          </span>
          <span className="text-sm text-foreground-secondary">
            {formatDay(date, "d MMMM yyyy")}
          </span>
        </div>
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
      <p className="text-sm text-foreground-secondary">
        {data.marked} of {data.rows.length} marked. Everyone not marked yet
        starts as Present: tap to change, then save. You can go back up to 7
        days.
      </p>
      {!data.countsForPay ? (
        <Banner tone="info">
          The 31st is recorded for the register but doesn&apos;t count towards
          pay.
        </Banner>
      ) : null}
      {data.rows.length === 0 ? (
        <EmptyState icon={Users} title="No one else is working on this day" />
      ) : (
        <Card>
          <ul className="divide-y divide-border" aria-label="Staff">
            {data.rows.map((row) => (
              <li key={row.staffId} className="flex flex-col gap-2 px-4 py-3">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="font-medium">{row.name}</span>
                  <span className="text-sm text-foreground-secondary">
                    {row.department}
                  </span>
                  {row.status === null ? (
                    <StatusBadge tone="warning" icon={History}>
                      Not marked yet
                    </StatusBadge>
                  ) : null}
                </div>
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
              </li>
            ))}
          </ul>
        </Card>
      )}
      {data.rows.length > 0 ? (
        <div className="sticky bottom-0 -mx-4 flex flex-col gap-2 border-t border-border bg-background px-4 py-3">
          <span className="text-sm text-foreground-secondary">
            {changed === 0
              ? "Everything is saved."
              : `${changed} to save${unmarked > 0 ? ` (${unmarked} not marked yet)` : ""}.`}
          </span>
          <Button
            width="full"
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
            <Icon icon={Save} />
            Save attendance
          </Button>
        </div>
      ) : null}
    </>
  );
}
