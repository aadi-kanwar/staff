import { CalendarClock, CircleAlert, CircleCheck, CircleDot } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { PAYDAY_STATUS_LABEL } from "@/lib/labels";

export type PaydayStatus = keyof typeof PAYDAY_STATUS_LABEL;

export function PaydayStatusBadge({ status, overdue = false }: { status: PaydayStatus; overdue?: boolean }) {
  if (status === "paid") return <StatusBadge tone="success" icon={CircleCheck}>Paid</StatusBadge>;
  if (status === "partially_paid")
    return (
      <StatusBadge tone="warning" icon={CircleDot}>
        Part paid{overdue ? " · overdue" : ""}
      </StatusBadge>
    );
  if (status === "due")
    return (
      <StatusBadge tone={overdue ? "danger" : "warning"} icon={CircleAlert}>
        {overdue ? "Overdue" : "Due today"}
      </StatusBadge>
    );
  return <StatusBadge tone="neutral" icon={CalendarClock}>Upcoming</StatusBadge>;
}
