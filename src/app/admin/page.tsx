"use client";

import { ArrowRight, CalendarCheck, CircleCheck, DoorOpen } from "lucide-react";
import Link from "next/link";
import { api } from "@convex/_generated/api";
import { DuesCalendar } from "@/components/admin/dues-calendar";
import { PaydayList } from "@/components/admin/payday-list";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import { LoadingState } from "@/components/ui/skeleton";
import { Stat } from "@/components/ui/stat";
import { EmptyState } from "@/components/ui/states";
import { useQuery } from "@/lib/convex";
import { usePropertyScope } from "@/components/app/property-scope";
import { formatDay, formatINR } from "@/lib/format";

export default function AdminDashboard() {
  const scope = usePropertyScope();
  const data = useQuery(api.dashboard.summary, scope.arg);
  if (data === undefined) return <LoadingState rows={4} />;
  const { attendance } = data;
  const monthName = formatDay(data.month.start, "MMMM");
  const complete =
    attendance.working > 0 && attendance.marked === attendance.working;
  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`${scope.current?.name ?? "All properties"} · ${formatDay(data.today, "EEEE d MMMM yyyy")} · ${data.activeStaff} active staff · updates live`}
      />
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat
          label="Today's attendance"
          value={
            <>
              {attendance.marked}
              <span className="text-base font-normal text-foreground-secondary">
                {" "}
                / {attendance.working}
              </span>
            </>
          }
          hint={
            complete
              ? "All marked"
              : `${attendance.working - attendance.marked} not marked yet`
          }
          warn={!complete && attendance.working > 0}
        />
        <Stat
          label="Owed now"
          value={formatINR(data.totalOwed)}
          hint="Due paydays not yet paid"
          emphasis
        />
        <Stat
          label={`Due in ${monthName}`}
          value={formatINR(data.month.due)}
          hint={`${data.month.tickets} ${data.month.tickets === 1 ? "payday" : "paydays"}, 1–${Number(data.month.end.slice(8))} ${monthName} · ${formatINR(data.month.pending)} still to pay`}
          warn={data.month.pending > 0}
        />
        <Stat
          label={`Paid in ${monthName}`}
          value={formatINR(data.month.paid)}
          hint={`${data.month.paidTickets} of ${data.month.tickets} ${data.month.tickets === 1 ? "payday" : "paydays"} fully paid`}
        />
        <Stat
          label="Due in the next 7 days"
          value={formatINR(data.dueSoon.reduce((a, r) => a + r.outstanding, 0))}
          hint={`${data.dueSoon.length} ${data.dueSoon.length === 1 ? "payday" : "paydays"}`}
        />
        <Stat
          label="Joining Reserves held"
          value={formatINR(data.reservesHeld)}
          hint="Paid when people leave"
        />
      </dl>

      {!complete && attendance.working > 0 ? (
        <Link
          href="/admin/attendance"
          className="flex items-center gap-3 rounded-md border border-warning-border bg-warning-subtle px-4 py-3 text-sm font-medium text-warning"
        >
          <Icon icon={CalendarCheck} />
          <span className="flex-1">
            Today&apos;s attendance isn&apos;t complete
          </span>
          <span className="flex items-center gap-1">
            Mark now
            <Icon icon={ArrowRight} />
          </span>
        </Link>
      ) : null}

      {data.payoutApprovals.length > 0 ? (
        <Banner
          tone="warning"
          title="Payment details waiting for your approval"
        >
          <span className="flex flex-wrap gap-x-3 gap-y-1">
            {data.payoutApprovals.map((p) => (
              <Link
                key={p.staffId}
                href={`/admin/staff/${p.staffId}?tab=profile`}
                className="font-medium underline underline-offset-4"
              >
                {p.name}
              </Link>
            ))}
          </span>
        </Banner>
      ) : null}

      {data.settlementsWaiting.map((s) => (
        <Banner
          key={s.staffId}
          tone="info"
          title={`${s.name}: final settlement waiting`}
          action={
            <Button asChild variant="secondary">
              <Link href={`/admin/staff/${s.staffId}?tab=exit`}>
                <Icon icon={DoorOpen} />
                Review
              </Link>
            </Button>
          }
        >
          Last working day {formatDay(s.lastWorkingDay)} · {formatINR(s.total)}{" "}
          to settle
        </Banner>
      ))}

      <section aria-labelledby="overdue" className="flex flex-col gap-2">
        <h2 id="overdue" className="font-serif text-2xl tracking-tight">
          Overdue and part paid
        </h2>
        {data.overdue.length === 0 ? (
          <EmptyState
            icon={CircleCheck}
            title="Nothing overdue"
            description="Every payday that has passed is paid."
          />
        ) : (
          <Card>
            <PaydayList rows={data.overdue} label="Overdue paydays" />
          </Card>
        )}
      </section>

      <section aria-labelledby="due-month" className="flex flex-col gap-2">
        <div className="flex items-end justify-between gap-3">
          <h2 id="due-month" className="font-serif text-2xl tracking-tight">
            Due in {monthName}
          </h2>
          <Button asChild variant="ghost">
            <Link href="/admin/payroll">
              Payroll
              <Icon icon={ArrowRight} />
            </Link>
          </Button>
        </div>
        {data.monthRows.length === 0 ? (
          <EmptyState title={`No paydays in ${monthName}`} />
        ) : (
          <Card>
            <PaydayList
              rows={data.monthRows}
              label={`Paydays due in ${monthName}`}
            />
          </Card>
        )}
      </section>

      <DuesCalendar today={data.today} />

      <section aria-labelledby="due-soon" className="flex flex-col gap-2">
        <div className="flex items-end justify-between gap-3">
          <h2 id="due-soon" className="font-serif text-2xl tracking-tight">
            Due in the next 7 days
          </h2>
          <Button asChild variant="ghost">
            <Link href="/admin/payroll">
              Payroll
              <Icon icon={ArrowRight} />
            </Link>
          </Button>
        </div>
        {data.dueSoon.length === 0 ? (
          <EmptyState title="No paydays this week" />
        ) : (
          <Card>
            <PaydayList rows={data.dueSoon} label="Paydays due soon" />
          </Card>
        )}
      </section>
    </>
  );
}
