"use client";

import { useMutation } from "convex/react";
import type { Id } from "@convex/_generated/dataModel";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import {
  AttendanceCalendar,
  AttendanceSummary,
  StatusPicker,
  type CalendarDay,
} from "@/components/app/attendance-calendar";
import { Card, CardBody } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { LoadingState } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toaster";
import { useQuery } from "@/lib/convex";
import { friendlyError } from "@/lib/errors";
import { formatDay, todayIn } from "@/lib/format";
import { ATTENDANCE_LABEL } from "@/lib/labels";

/** One person's month, editable by tapping a day. Also used on the staff detail screen. */
export function StaffMonth({
  staffId,
  month,
}: {
  staffId: Id<"staff">;
  month: string;
}) {
  const data = useQuery(api.attendance.month, { staffId, month });
  const setOne = useMutation(api.attendance.setOne);
  const [editing, setEditing] = useState<CalendarDay | null>(null);
  const today = todayIn();
  if (data === undefined) return <LoadingState rows={3} />;
  const editable = data.staff.status === "active";
  return (
    <Card>
      <CardBody className="flex flex-col gap-4">
        <AttendanceSummary counts={data.counts} unmarked={data.unmarked} />
        {data.unmarked > 0 ? (
          <p className="text-sm text-warning">
            Unmarked past days (?) count as Present for pay. Tap one to mark it.
          </p>
        ) : null}
        <AttendanceCalendar
          days={data.days}
          today={today}
          onSelect={editable ? setEditing : undefined}
        />
        <Dialog
          open={editing !== null}
          onOpenChange={(open) => !open && setEditing(null)}
        >
          {editing ? (
            <DialogContent
              title={formatDay(editing.date, "EEEE d MMMM yyyy")}
              description={
                editing.status
                  ? `Now: ${ATTENDANCE_LABEL[editing.status]}. The change is logged.`
                  : "Not marked yet. The change is logged."
              }
            >
              <StatusPicker
                name={data.staff.name}
                value={editing.status ?? "present"}
                onChange={async (status) => {
                  try {
                    await setOne({ staffId, date: editing.date, status });
                    toast.success(
                      `${formatDay(editing.date)}: ${ATTENDANCE_LABEL[status]}`,
                    );
                    setEditing(null);
                  } catch (error) {
                    toast.error(friendlyError(error));
                  }
                }}
              />
            </DialogContent>
          ) : null}
        </Dialog>
      </CardBody>
    </Card>
  );
}
