"use client";

import type { Id } from "@convex/_generated/dataModel";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import {
  useParams,
  usePathname,
  useRouter,
  useSearchParams,
} from "next/navigation";
import { Suspense } from "react";
import { api } from "@convex/_generated/api";
import { formatPhoneForDisplay } from "@convex/lib/inputRules";
import {
  ExitTab,
  LedgerTab,
  PaydaysTab,
  ProfileTab,
  ReserveTab,
  SalaryTab,
  AttendanceTab,
} from "@/components/admin/staff-tabs";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import { LoadingState } from "@/components/ui/skeleton";
import { Stat } from "@/components/ui/stat";
import { EmptyState } from "@/components/ui/states";
import { SegmentedTabs } from "@/components/ui/tabs";
import { useQuery } from "@/lib/convex";
import { formatDay, formatINR } from "@/lib/format";

const TABS = [
  { value: "profile", label: "Profile" },
  { value: "salary", label: "Salary terms" },
  { value: "paydays", label: "Paydays" },
  { value: "ledger", label: "Ledger" },
  { value: "attendance", label: "Attendance" },
  { value: "reserve", label: "Joining Reserve" },
  { value: "exit", label: "Exit" },
] as const;
type Tab = (typeof TABS)[number]["value"];

export default function StaffDetailPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <StaffDetail />
    </Suspense>
  );
}

function StaffDetail() {
  const { staffId } = useParams<{ staffId: string }>();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tab = (params.get("tab") ?? "paydays") as Tab;
  const data = useQuery(api.people.get, { staffId: staffId as Id<"staff"> });
  if (data === undefined) return <LoadingState rows={4} />;
  if (data === null) {
    return (
      <EmptyState
        title="This staff member was deleted"
        description={
          <Link href="/admin/staff" className="underline underline-offset-4">
            Back to Staff
          </Link>
        }
      />
    );
  }
  const { profile, schedule } = data;
  return (
    <>
      <Button asChild variant="ghost" className="self-start">
        <Link href="/admin/staff">
          <Icon icon={ArrowLeft} />
          Staff
        </Link>
      </Button>
      <PageHeader
        title={profile.name}
        description={[
          profile.propertyName,
          profile.department,
          formatPhoneForDisplay(profile.phone),
          `joined ${formatDay(profile.joinDate, "d MMM yyyy")}`,
          profile.status === "exited" ? "left" : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      />
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Owed now"
          value={formatINR(schedule.pending)}
          emphasis={schedule.pending > 0}
        />
        <Stat
          label="Next payday"
          value={schedule.next ? formatINR(schedule.next.net) : "—"}
          hint={
            schedule.next
              ? formatDay(schedule.next.dueDate, "EEE d MMM")
              : undefined
          }
        />
        <Stat
          label="Salary"
          value={formatINR(data.current.monthlySalary)}
          hint={`per month · ${data.current.payModeLabel}`}
        />
        <Stat
          label="Joining Reserve"
          value={formatINR(schedule.reserve.amount)}
          hint={profile.reserveStatus}
        />
      </dl>
      <SegmentedTabs
        label="Staff record"
        idPrefix="staff"
        items={TABS}
        value={tab}
        onChange={(next) => {
          const copy = new URLSearchParams(params.toString());
          copy.set("tab", next);
          router.replace(`${pathname}?${copy.toString()}`, { scroll: false });
        }}
      />
      <div id="staff-panel" role="tabpanel" className="flex flex-col gap-4">
        {tab === "profile" ? <ProfileTab data={data} /> : null}
        {tab === "salary" ? <SalaryTab data={data} /> : null}
        {tab === "paydays" ? <PaydaysTab data={data} /> : null}
        {tab === "ledger" ? <LedgerTab data={data} /> : null}
        {tab === "attendance" ? <AttendanceTab data={data} /> : null}
        {tab === "reserve" ? <ReserveTab data={data} /> : null}
        {tab === "exit" ? <ExitTab data={data} /> : null}
      </div>
    </>
  );
}
