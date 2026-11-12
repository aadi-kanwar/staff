"use client";

import {
  ClipboardCheck,
  DoorOpen,
  KeyRound,
  UserPlus,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import { formatPhoneForDisplay } from "@convex/lib/inputRules";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PropertyFilter } from "@/components/admin/property-filter";
import { SearchInput } from "@/components/ui/filter-bar";
import { Icon } from "@/components/ui/icon";
import { NativeSelect } from "@/components/ui/native-select";
import { PageHeader } from "@/components/ui/page-header";
import { LoadingState } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/states";
import { StatusBadge } from "@/components/ui/status-badge";
import { SegmentedTabs } from "@/components/ui/tabs";
import { useQuery } from "@/lib/convex";
import {
  usePropertyScope,
  useShowProperty,
} from "@/components/app/property-scope";
import { formatDay, formatINR } from "@/lib/format";

export default function StaffListPage() {
  const scope = usePropertyScope();
  const showProperty = useShowProperty();
  const rows = useQuery(api.people.list, scope.arg);
  const [search, setSearch] = useState("");
  const [department, setDepartment] = useState("");
  const [tab, setTab] = useState<"active" | "exited">("active");
  const departments = [
    ...new Set((rows ?? []).map((r) => r.department)),
  ].sort();
  const term = search.trim().toLowerCase();
  const digits = term.replace(/\D/g, "");
  const shown = (rows ?? []).filter(
    (r) =>
      r.status === tab &&
      (department === "" || r.department === department) &&
      (term === "" ||
        r.name.toLowerCase().includes(term) ||
        (digits.length >= 3 && r.phone.includes(digits))),
  );
  const count = (status: "active" | "exited") =>
    rows?.filter((r) => r.status === status).length ?? 0;

  return (
    <>
      <PageHeader
        title="Staff"
        description="Everyone on the payroll. Open someone to see their salary, paydays, ledger and Joining Reserve."
        actions={
          <Button asChild>
            <Link href="/admin/staff/new">
              <Icon icon={UserPlus} />
              Add staff
            </Link>
          </Button>
        }
      />
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <SegmentedTabs
          label="Which staff"
          className="sm:w-80"
          items={[
            { value: "active", label: "Current", count: count("active") },
            { value: "exited", label: "Left", count: count("exited") },
          ]}
          value={tab}
          onChange={setTab}
        />
        <div className="flex flex-col gap-3 sm:flex-row">
          <SearchInput
            label="Search by name or mobile"
            placeholder="Name or mobile"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
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
      </div>
      {rows === undefined ? (
        <LoadingState />
      ) : shown.length === 0 ? (
        <EmptyState
          icon={Users}
          title={
            term || department
              ? "No one matches"
              : tab === "active"
                ? "No staff yet"
                : "No one has left"
          }
          description={
            tab === "active" && !term && !department
              ? "Add your first staff member to start."
              : undefined
          }
        />
      ) : (
        <Card>
          <ul className="divide-y divide-border" aria-label="Staff">
            {shown.map((row) => (
              <li key={row.staffId}>
                <Link
                  href={`/admin/staff/${row.staffId}`}
                  className="flex flex-col gap-2 px-4 py-3 hover:bg-subtle sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex min-w-0 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{row.name}</span>
                      {row.lastWorkingDay && row.status === "active" ? (
                        <StatusBadge tone="warning" icon={DoorOpen}>
                          Last day {formatDay(row.lastWorkingDay)}
                        </StatusBadge>
                      ) : null}
                      {row.canMarkAttendance && row.status === "active" ? (
                        <StatusBadge tone="primary" icon={ClipboardCheck}>
                          Marks attendance
                        </StatusBadge>
                      ) : null}
                      {row.mustChangePassword ? (
                        <StatusBadge tone="info" icon={KeyRound}>
                          Temporary password
                        </StatusBadge>
                      ) : null}
                    </div>
                    <span className="text-sm text-foreground-secondary">
                      {showProperty ? `${row.propertyName} · ` : null}
                      {row.department} ·{" "}
                      <span className="tabular">
                        {formatPhoneForDisplay(row.phone)}
                      </span>{" "}
                      · {formatINR(row.monthlySalary)}/month ·{" "}
                      {row.payModeLabel}
                    </span>
                  </div>
                  <dl className="grid shrink-0 grid-cols-2 gap-x-6 text-sm sm:text-right">
                    <div>
                      <dt className="text-xs text-foreground-secondary">
                        Owed now
                      </dt>
                      <dd
                        className={
                          row.pending > 0
                            ? "tabular font-semibold text-warning"
                            : "tabular"
                        }
                      >
                        {formatINR(row.pending)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-foreground-secondary">
                        Next payday
                      </dt>
                      <dd className="tabular">
                        {row.next
                          ? `${formatDay(row.next.date, "d MMM")} · ${formatINR(row.next.net)}`
                          : "—"}
                      </dd>
                    </div>
                  </dl>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
