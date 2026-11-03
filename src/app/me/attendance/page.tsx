"use client";

import { CalendarX, ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import { AttendanceCalendar, AttendanceSummary } from "@/components/app/attendance-calendar";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { LoadingState } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/states";
import { useQuery } from "@/lib/convex";
import { formatMonth, todayIn } from "@/lib/format";

export default function StaffAttendance() {
  const months = useQuery(api.staff.attendanceMonths, {});
  const [chosen, setChosen] = useState<string | null>(null);
  if (months === undefined) return <LoadingState rows={3} />;
  if (months.length === 0) {
    return (
      <>
        <h1 className="font-serif text-3xl tracking-tight">Attendance</h1>
        <EmptyState icon={CalendarX} title="No attendance yet" />
      </>
    );
  }
  const month = chosen && months.includes(chosen) ? chosen : months[0];
  const i = months.indexOf(month); // newest first
  return (
    <>
      <h1 className="font-serif text-3xl tracking-tight">Attendance</h1>
      <div className="flex items-center justify-between gap-2">
        <Button variant="secondary" size="icon" aria-label="Earlier month" disabled={i >= months.length - 1} onClick={() => setChosen(months[i + 1])}>
          <Icon icon={ChevronLeft} />
        </Button>
        <span className="font-medium">{formatMonth(month)}</span>
        <Button variant="secondary" size="icon" aria-label="Later month" disabled={i <= 0} onClick={() => setChosen(months[i - 1])}>
          <Icon icon={ChevronRight} />
        </Button>
      </div>
      <Month month={month} />
    </>
  );
}

function Month({ month }: { month: string }) {
  const data = useQuery(api.staff.attendanceMonth, { month });
  if (data === undefined) return <LoadingState rows={3} />;
  return (
    <Card>
      <CardBody className="flex flex-col gap-4">
        <AttendanceCalendar days={data.days} today={todayIn()} />
        <AttendanceSummary counts={data.counts} />
      </CardBody>
    </Card>
  );
}
