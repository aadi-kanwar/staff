"use client";

import { useAction, useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  ChevronLeft,
  ClipboardCheck,
  ChevronRight,
  Copy,
  DoorOpen,
  KeyRound,
  Pencil,
  ShieldOff,
  Trash2,
  Undo2,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { formatPhoneForDisplay } from "@convex/lib/inputRules";
import {
  AddAdjustmentDialog,
  PaymentModeSelect,
  RecordPaymentDialog,
} from "@/components/admin/money-dialogs";
import { PaydayBreakdown } from "@/components/admin/payday-breakdown";
import { StaffMonth } from "@/components/admin/staff-month";
import { PaydayStatusBadge } from "@/components/app/payday-status";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
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
import { DetailList } from "@/components/ui/stat";
import { EmptyState } from "@/components/ui/states";
import { StatusBadge } from "@/components/ui/status-badge";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { toast } from "@/components/ui/toaster";
import { useQuery } from "@/lib/convex";
import { usePropertyScope } from "@/components/app/property-scope";
import { friendlyError } from "@/lib/errors";
import {
  addMonths,
  formatDate,
  formatDateTime,
  formatDay,
  formatINR,
  formatMonth,
  todayIn,
} from "@/lib/format";
import { ADJUSTMENT_LABEL, PAYMENT_MODE_LABEL } from "@/lib/labels";

export type StaffData = FunctionReturnType<typeof api.people.get>;
type Props = { data: StaffData };

function SectionTitle({
  children,
  description,
}: {
  children: React.ReactNode;
  description?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <h2 className="font-serif text-2xl tracking-tight">{children}</h2>
      {description ? (
        <p className="text-sm text-foreground-secondary">{description}</p>
      ) : null}
    </div>
  );
}

/** Runs a mutation with a toast, and returns whether it worked. */
function useRun() {
  const [busy, setBusy] = useState(false);
  const run = async (work: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try {
      await work();
      toast.success(success);
      return true;
    } catch (error) {
      toast.error(friendlyError(error));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}

// --- Profile -----------------------------------------------------------------

export function ProfileTab({ data }: Props) {
  const { profile } = data;
  return (
    <>
      <Card>
        <CardBody className="flex flex-col gap-4">
          <DetailList
            rows={[
              { label: "Name", value: profile.name },
              {
                label: "Mobile (login)",
                value: formatPhoneForDisplay(profile.phone),
              },
              { label: "Property", value: profile.propertyName },
              { label: "Department", value: profile.department },
              { label: "Joined", value: formatDate(profile.joinDate) },
              {
                label: "Attendance tracked from",
                value: formatDate(profile.attendanceFrom),
              },
              {
                label: "Status",
                value: profile.status === "active" ? "Working" : "Left",
              },
              ...(profile.lastWorkingDay
                ? [
                    {
                      label: "Last working day",
                      value: formatDate(profile.lastWorkingDay),
                    },
                  ]
                : []),
              {
                label: "Password",
                value: profile.mustChangePassword
                  ? "Temporary (not changed yet)"
                  : "Chosen by them",
              },
              {
                label: "Attendance marking",
                value: profile.canMarkAttendance
                  ? "Can mark the other staff at their property"
                  : "No",
              },
            ]}
          />
          <div className="flex flex-wrap gap-2">
            <EditProfileDialog data={data} />
            <ResetPasswordDialog
              staffId={data.profile.staffId}
              name={data.profile.name}
            />
            <MarkingToggle data={data} />
          </div>
        </CardBody>
      </Card>
    </>
  );
}

/** Gives or takes away attendance marking (for the other staff of their property). */
function MarkingToggle({ data }: Props) {
  const setMarking = useMutation(api.people.setMarking);
  const { busy, run } = useRun();
  const { profile } = data;
  if (profile.status !== "active" && !profile.canMarkAttendance) return null;
  const allowed = profile.canMarkAttendance;
  return (
    <Button
      variant="secondary"
      loading={busy}
      onClick={() =>
        run(
          () => setMarking({ staffId: profile.staffId, allowed: !allowed }),
          allowed
            ? `${profile.name} can no longer mark attendance.`
            : `${profile.name} can now mark attendance for their property.`,
        )
      }
    >
      <Icon icon={ClipboardCheck} />
      {allowed ? "Stop attendance marking" : "Allow attendance marking"}
    </Button>
  );
}

function EditProfileDialog({ data }: Props) {
  const update = useMutation(api.people.updateProfile);
  const { busy, run } = useRun();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(data.profile.name);
  const [department, setDepartment] = useState(data.profile.department);
  const [propertyId, setPropertyId] = useState<string>(data.profile.propertyId);
  const { properties } = usePropertyScope();
  const canMove = data.profile.status === "active" && properties.length > 1;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setName(data.profile.name);
          setDepartment(data.profile.department);
          setPropertyId(data.profile.propertyId);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="secondary">
          <Icon icon={Pencil} />
          Edit
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Edit details"
        description="The mobile number is the login and can't be changed here."
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (
              await run(
                () =>
                  update({
                    staffId: data.profile.staffId,
                    name,
                    department,
                    staffPropertyId: canMove
                      ? (propertyId as Id<"properties">)
                      : undefined,
                  }),
                "Saved.",
              )
            )
              setOpen(false);
          }}
        >
          <Field id="edit-name" label="Full name">
            {(p) => (
              <Input
                {...p}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            )}
          </Field>
          <Field id="edit-dept" label="Department">
            {(p) => (
              <Input
                {...p}
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
              />
            )}
          </Field>
          {canMove ? (
            <Field
              id="edit-property"
              label="Property"
              hint="Moving them doesn't change their pay or history."
            >
              {(p) => (
                <NativeSelect
                  {...p}
                  value={propertyId}
                  onChange={(e) => setPropertyId(e.target.value)}
                >
                  {properties.map((property) => (
                    <option
                      key={property.propertyId}
                      value={property.propertyId}
                    >
                      {property.name}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
          ) : null}
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button type="submit" loading={busy}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ResetPasswordDialog({
  staffId,
  name,
}: {
  staffId: StaffData["profile"]["staffId"];
  name: string;
}) {
  const reset = useAction(api.people.resetPassword);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState<string | null>(null);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setPassword(null);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="secondary">
          <Icon icon={KeyRound} />
          Reset password
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Reset password"
        description={
          password
            ? "Tell them this password in person. It's shown only once."
            : `${name} gets a temporary password, is signed out everywhere, and must choose a new password at next sign-in.`
        }
      >
        {password ? (
          <>
            <p className="rounded-md border border-border bg-subtle px-4 py-3 text-center font-mono text-2xl tracking-widest">
              {password}
            </p>
            <DialogFooter>
              <Button
                variant="secondary"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(password);
                    toast.success("Copied.");
                  } catch {
                    toast.error("Couldn't copy. Please write it down.");
                  }
                }}
              >
                <Icon icon={Copy} />
                Copy
              </Button>
              <DialogClose asChild>
                <Button>Done</Button>
              </DialogClose>
            </DialogFooter>
          </>
        ) : (
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button
              loading={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  setPassword((await reset({ staffId })).temporaryPassword);
                } catch (error) {
                  toast.error(friendlyError(error));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Reset password
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

// --- Salary terms --------------------------------------------------------------

export function SalaryTab({ data }: Props) {
  const cancel = useMutation(api.people.cancelRevision);
  const { busy, run } = useRun();
  return (
    <>
      <SectionTitle description="The earliest row is the salary at joining (it fixes the Joining Reserve). Changes start on the first day of a pay cycle.">
        Salary history
      </SectionTitle>
      <Table>
        <THead>
          <TR>
            <TH>From</TH>
            <TH>Monthly salary</TH>
            <TH>Pay mode</TH>
            <TH />
          </TR>
        </THead>
        <TBody>
          {[...data.terms].reverse().map((t) => (
            <TR key={t.termsId}>
              <TD className="whitespace-nowrap">
                {formatDate(t.effectiveFromDate)}
              </TD>
              <TD className="tabular">{formatINR(t.monthlySalary)}</TD>
              <TD>{t.payModeLabel}</TD>
              <TD className="text-right">
                {t.isCurrent ? (
                  <StatusBadge tone="success" icon={KeyRound}>
                    Current
                  </StatusBadge>
                ) : null}
                {t.isFuture ? (
                  <StatusBadge tone="info" icon={ChevronRight}>
                    Scheduled
                  </StatusBadge>
                ) : null}
                {t.canCancel ? (
                  <Button
                    variant="ghost"
                    loading={busy}
                    onClick={() =>
                      run(
                        () => cancel({ termsId: t.termsId }),
                        "Revision cancelled.",
                      )
                    }
                  >
                    <Icon icon={Undo2} />
                    Cancel
                  </Button>
                ) : null}
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
      {data.revisionOptions.length > 0 ? (
        <ReviseForm data={data} />
      ) : (
        <Banner tone="info">
          {data.profile.status === "exited"
            ? "This person has left."
            : "Salary can't be revised while a last working day is set."}
        </Banner>
      )}
    </>
  );
}

function ReviseForm({ data }: Props) {
  const revise = useMutation(api.people.reviseTerms);
  const payModes = useQuery(api.people.payModes, {});
  const { busy, run } = useRun();
  const latest = data.terms.at(-1)!;
  const [effective, setEffective] = useState(
    String(data.revisionOptions[0].index),
  );
  const [salary, setSalary] = useState(String(latest.monthlySalary));
  const [payMode, setPayMode] = useState(latest.payMode);
  return (
    <Card>
      <CardBody>
        <form
          className="grid gap-4 sm:grid-cols-3"
          onSubmit={async (e) => {
            e.preventDefault();
            await run(
              () =>
                revise({
                  staffId: data.profile.staffId,
                  effectiveFromIndex: Number(effective),
                  monthlySalary: Number(salary),
                  payMode,
                }),
              "Revision saved.",
            );
          }}
        >
          <h3 className="font-medium sm:col-span-3">
            Revise salary or pay mode
          </h3>
          <Field
            id="rev-from"
            label="Starting"
            hint="Only the first day of a pay cycle."
          >
            {(p) => (
              <NativeSelect
                {...p}
                value={effective}
                onChange={(e) => setEffective(e.target.value)}
              >
                {data.revisionOptions.map((o) => (
                  <option key={o.index} value={o.index}>
                    {formatDay(o.date, "EEE d MMM yyyy")}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          <Field id="rev-salary" label="Monthly salary (₹)">
            {(p) => (
              <Input
                {...p}
                type="number"
                inputMode="numeric"
                min={1}
                value={salary}
                onChange={(e) => setSalary(e.target.value)}
              />
            )}
          </Field>
          <Field id="rev-mode" label="Pay mode">
            {(p) => (
              <NativeSelect
                {...p}
                value={payMode}
                onChange={(e) => setPayMode(e.target.value as typeof payMode)}
              >
                {payModes?.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          <div className="flex justify-end sm:col-span-3">
            <Button type="submit" loading={busy}>
              Save revision
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

// --- Paydays -----------------------------------------------------------------

export function PaydaysTab({ data }: Props) {
  const { schedule, profile } = data;
  const editable = profile.status === "active";
  // Owed now first (oldest first), then upcoming (soonest first), then the
  // rest of the past (newest first).
  const owed = (p: (typeof schedule.paydays)[number]) =>
    p.dueDate <= data.today && p.outstanding > 0;
  const overdue = schedule.paydays
    .filter(owed)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const upcoming = schedule.paydays
    .filter((p) => p.dueDate > data.today)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const past = schedule.paydays
    .filter((p) => p.dueDate <= data.today && !owed(p))
    .reverse();
  const rows = [...overdue, ...upcoming, ...past];
  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <SectionTitle description="Anything owed now first, then the next six paydays (soonest first), then past ones (newest first). Paydays are worked out from salary terms, attendance and adjustments.">
          Payday schedule
        </SectionTitle>
        {editable ? (
          <AddAdjustmentDialog
            staffId={profile.staffId}
            targets={data.adjustmentTargets}
            defaultTarget={data.defaultAdjustmentTarget}
          />
        ) : null}
      </div>
      {schedule.settlement ? (
        <Banner tone="info" title="Leaving">
          Last working day {formatDate(schedule.settlement.lastWorkingDay)}. See
          the Exit tab for the final settlement.
        </Banner>
      ) : null}
      {rows.length === 0 ? (
        <EmptyState title="No paydays yet" />
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((row) => (
            <Card key={row.key}>
              <CardBody className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-col">
                    <span className="font-serif text-xl">
                      {formatDay(row.dueDate, "EEE d MMM yyyy")}
                      {row.isFinal ? " · final cycle" : ""}
                    </span>
                    <span className="tabular text-sm text-foreground-secondary">
                      {formatINR(row.net)} net
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <PaydayStatusBadge
                      status={row.status}
                      overdue={row.overdue}
                    />
                    {editable && row.outstanding > 0 ? (
                      <RecordPaymentDialog
                        staffId={profile.staffId}
                        paydayKey={row.key}
                        outstanding={row.outstanding}
                        title={`${profile.name}, payday ${formatDay(row.dueDate, "d MMM")}`}
                      />
                    ) : null}
                  </div>
                </div>
                <PaydayBreakdown row={row} />
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

// --- Ledger ------------------------------------------------------------------

export function LedgerTab({ data }: Props) {
  const { profile, schedule } = data;
  const removeAdjustment = useMutation(api.adjustments.remove);
  const removePayment = useMutation(api.payments.remove);
  const { busy, run } = useRun();
  const editable = profile.status === "active";
  const today = data.today;
  type Entry = {
    date: string;
    label: string;
    detail?: string;
    amount: number;
    kind: "earning" | "payment";
  };
  const entries: Entry[] = [
    ...schedule.paydays
      .filter((p) => p.dueDate <= today)
      .map((p) => ({
        date: p.dueDate,
        label: p.isFinal ? "Final cycle earnings" : "Payday",
        detail: `${formatINR(p.earning, { exact: true })} earned${p.bonus ? ` · +${formatINR(p.bonus)} bonus` : ""}${p.deduction ? ` · −${formatINR(p.deduction)} deduction` : ""}${p.advance ? ` · −${formatINR(p.advance)} advance` : ""}`,
        amount: p.net,
        kind: "earning" as const,
      })),
    ...(schedule.settlement
      ? [
          {
            date: schedule.settlement.dueDate,
            label: "Final settlement (reserve and other items)",
            amount: schedule.settlement.extrasNet,
            kind: "earning" as const,
          },
        ]
      : []),
    ...data.payments.map((p) => ({
      date: p.paidOn,
      label: `Payment · ${PAYMENT_MODE_LABEL[p.mode]}`,
      detail: [
        p.paydayDate
          ? `for ${p.isFinal ? "final settlement" : formatDay(p.paydayDate, "d MMM")}`
          : null,
        p.note,
      ]
        .filter(Boolean)
        .join(" · "),
      amount: -p.amount,
      kind: "payment" as const,
    })),
  ].sort(
    (a, b) => a.date.localeCompare(b.date) || (a.kind === "earning" ? -1 : 1),
  );
  const withBalance = entries.reduce<(Entry & { balance: number })[]>(
    (rows, e) => [
      ...rows,
      { ...e, balance: (rows.at(-1)?.balance ?? 0) + e.amount },
    ],
    [],
  );

  return (
    <>
      <SectionTitle description="Net payable on each payday that has come, and every payment. The balance is what's owed (the Joining Reserve is separate until the final settlement).">
        Ledger
      </SectionTitle>
      {withBalance.length === 0 ? (
        <EmptyState
          title="Nothing yet"
          description="The first payday hasn't come."
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Date</TH>
              <TH>Entry</TH>
              <TH className="text-right">Amount</TH>
              <TH className="text-right">Balance</TH>
            </TR>
          </THead>
          <TBody>
            {[...withBalance].reverse().map((e, i) => (
              <TR key={i}>
                <TD className="whitespace-nowrap">
                  {formatDay(e.date, "d MMM yyyy")}
                </TD>
                <TD>
                  <div className="font-medium">{e.label}</div>
                  {e.detail ? (
                    <div className="text-xs text-foreground-secondary">
                      {e.detail}
                    </div>
                  ) : null}
                </TD>
                <TD className="tabular text-right whitespace-nowrap">
                  {formatINR(e.amount, { signed: true })}
                </TD>
                <TD className="tabular text-right whitespace-nowrap">
                  {formatINR(e.balance)}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      <SectionTitle>Adjustments</SectionTitle>
      {data.adjustments.length === 0 ? (
        <EmptyState
          title="No adjustments"
          description="Advances, deductions and bonuses appear here."
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Date</TH>
              <TH>Type</TH>
              <TH>Note</TH>
              <TH>Payday</TH>
              <TH className="text-right">Amount</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {data.adjustments.map((a) => (
              <TR key={a._id}>
                <TD className="whitespace-nowrap">
                  {formatDay(a.date, "d MMM yyyy")}
                </TD>
                <TD>{ADJUSTMENT_LABEL[a.type]}</TD>
                <TD>{a.note}</TD>
                <TD className="whitespace-nowrap">
                  {a.paydayDate
                    ? formatDay(a.paydayDate, "d MMM")
                    : "Not scheduled yet"}
                </TD>
                <TD className="tabular text-right">
                  {formatINR(a.type === "bonus" ? a.amount : -a.amount, {
                    signed: true,
                  })}
                </TD>
                <TD className="text-right">
                  {editable ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Remove adjustment"
                      loading={busy}
                      onClick={() =>
                        run(
                          () => removeAdjustment({ adjustmentId: a._id }),
                          "Adjustment removed.",
                        )
                      }
                    >
                      <Icon icon={Trash2} />
                    </Button>
                  ) : null}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      <SectionTitle>Payments</SectionTitle>
      {data.payments.length === 0 ? (
        <EmptyState title="No payments recorded" />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Paid on</TH>
              <TH>For payday</TH>
              <TH>Mode</TH>
              <TH>Note</TH>
              <TH className="text-right">Amount</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {data.payments.map((p) => (
              <TR key={p._id}>
                <TD className="whitespace-nowrap">
                  {formatDay(p.paidOn, "d MMM yyyy")}
                </TD>
                <TD className="whitespace-nowrap">
                  {p.isFinal
                    ? "Final settlement"
                    : p.paydayDate
                      ? formatDay(p.paydayDate, "d MMM yyyy")
                      : "—"}
                </TD>
                <TD>{PAYMENT_MODE_LABEL[p.mode]}</TD>
                <TD className="text-foreground-secondary">{p.note ?? ""}</TD>
                <TD className="tabular text-right">{formatINR(p.amount)}</TD>
                <TD className="text-right">
                  {editable ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Remove payment"
                      loading={busy}
                      onClick={() => {
                        if (
                          window.confirm(
                            `Remove the ${formatINR(p.amount)} payment of ${formatDate(p.paidOn)}? It stays in the audit log.`,
                          )
                        ) {
                          void run(
                            () => removePayment({ paymentId: p._id }),
                            "Payment removed.",
                          );
                        }
                      }}
                    >
                      <Icon icon={Trash2} />
                    </Button>
                  ) : null}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </>
  );
}

// --- Attendance --------------------------------------------------------------

export function AttendanceTab({ data }: Props) {
  const [month, setMonth] = useState(todayIn().slice(0, 7));
  return (
    <>
      <div className="flex items-center gap-2">
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
        <Button asChild variant="ghost" className="ml-auto">
          <Link
            href={`/admin/attendance?tab=log&staff=${data.profile.staffId}`}
          >
            Change log
          </Link>
        </Button>
      </div>
      <StaffMonth staffId={data.profile.staffId} month={month} />
    </>
  );
}

// --- Joining Reserve -----------------------------------------------------------

const RESERVE_STATUS: Record<string, string> = {
  held: "Held",
  released: "Paid out",
  forfeited: "Forfeited",
};

export function ReserveTab({ data }: Props) {
  const { reserve } = data.schedule;
  const { profile } = data;
  const forfeit = useMutation(api.people.forfeitReserve);
  const restore = useMutation(api.people.restoreReserve);
  const { busy, run } = useRun();
  const [reason, setReason] = useState("");
  const editable = profile.status === "active";
  const t = reserve.tally;
  return (
    <>
      <SectionTitle description="The first 10 days from joining are withheld and paid with the final settlement. Shown to staff as “Joining Reserve (paid when you leave)”.">
        Joining Reserve
      </SectionTitle>
      <Card>
        <CardBody>
          <DetailList
            rows={[
              {
                label: "Days withheld",
                value: `${formatDay(reserve.startDate, "d MMM")} – ${formatDay(reserve.endDate, "d MMM yyyy")}`,
              },
              {
                label: "Salary at joining",
                value: formatINR(reserve.monthlySalary),
              },
              {
                label: "Paid days in the block",
                value: `${t.paidDays} of ${t.days}`,
              },
              {
                label: "Amount",
                value: formatINR(reserve.amount),
                strong: true,
              },
              { label: "Status", value: RESERVE_STATUS[profile.reserveStatus] },
              ...(profile.reserveForfeitReason
                ? [
                    {
                      label: "Reason forfeited",
                      value: profile.reserveForfeitReason,
                    },
                  ]
                : []),
            ]}
          />
        </CardBody>
      </Card>
      {editable && profile.reserveStatus === "held" ? (
        <Card>
          <CardBody>
            <form
              className="flex flex-col gap-3 sm:flex-row sm:items-end"
              onSubmit={async (e) => {
                e.preventDefault();
                if (
                  await run(
                    () => forfeit({ staffId: profile.staffId, reason }),
                    "Joining Reserve forfeited.",
                  )
                )
                  setReason("");
              }}
            >
              <Field
                id="forfeit-reason"
                label="Forfeit the reserve"
                hint="A reason is required and is kept in the audit log."
                className="flex-1"
              >
                {(p) => (
                  <Input
                    {...p}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="e.g. Left without notice"
                  />
                )}
              </Field>
              <Button
                type="submit"
                variant="destructive"
                loading={busy}
                disabled={reason.trim().length < 3}
              >
                <Icon icon={ShieldOff} />
                Forfeit
              </Button>
            </form>
          </CardBody>
        </Card>
      ) : null}
      {editable && profile.reserveStatus === "forfeited" ? (
        <Button
          variant="secondary"
          className="self-start"
          loading={busy}
          onClick={() =>
            run(
              () => restore({ staffId: profile.staffId }),
              "Reserve held again.",
            )
          }
        >
          <Icon icon={Undo2} />
          Undo forfeit
        </Button>
      ) : null}
    </>
  );
}

// --- Exit --------------------------------------------------------------------

export function ExitTab({ data }: Props) {
  const { profile, schedule } = data;
  const setLast = useMutation(api.people.setLastWorkingDay);
  const cancelExit = useMutation(api.people.cancelExit);
  const confirm = useMutation(api.people.confirmSettlement);
  const { busy, run } = useRun();
  const today = data.today;
  const [lastDay, setLastDay] = useState(profile.lastWorkingDay ?? today);
  const [paidOn, setPaidOn] = useState(today);
  const [mode, setMode] = useState<"cash" | "upi" | "bank">("bank");
  const [note, setNote] = useState("");
  const s = schedule.settlement;

  if (profile.status === "exited") {
    return (
      <Banner tone="success" title="Settled">
        {profile.name} left after{" "}
        {profile.lastWorkingDay ? formatDate(profile.lastWorkingDay) : "—"}
        {profile.exitedAt
          ? `; settled ${formatDateTime(profile.exitedAt)}`
          : ""}
        . Their login still works, read-only, so they can see their history.
      </Banner>
    );
  }
  const finalCycle = schedule.paydays.find((p) => p.isFinal);
  const otherPending = s
    ? s.paydaysOutstanding - (finalCycle?.outstanding ?? 0)
    : 0;
  return (
    <>
      <SectionTitle description="Set the last working day. The final settlement is the pay for the last, short cycle, everything still owed, the Joining Reserve (unless forfeited) and any adjustments not yet settled.">
        Exit
      </SectionTitle>
      <Card>
        <CardBody>
          <form
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              void run(
                () =>
                  setLast({
                    staffId: profile.staffId,
                    lastWorkingDay: lastDay,
                  }),
                "Last working day saved.",
              );
            }}
          >
            <Field id="last-day" label="Last working day" className="sm:w-60">
              {(p) => (
                <Input
                  {...p}
                  type="date"
                  min={profile.joinDate}
                  value={lastDay}
                  onChange={(e) => setLastDay(e.target.value)}
                />
              )}
            </Field>
            <Button type="submit" loading={busy}>
              <Icon icon={DoorOpen} />
              {profile.lastWorkingDay ? "Change" : "Set last working day"}
            </Button>
            {profile.lastWorkingDay ? (
              <Button
                variant="ghost"
                loading={busy}
                onClick={() =>
                  run(
                    () => cancelExit({ staffId: profile.staffId }),
                    "Exit cancelled.",
                  )
                }
              >
                <Icon icon={Undo2} />
                Cancel exit
              </Button>
            ) : null}
          </form>
        </CardBody>
      </Card>
      {s ? (
        <Card>
          <CardBody className="flex flex-col gap-4">
            <h3 className="font-serif text-xl">Settlement summary</h3>
            <DetailList
              rows={[
                ...(finalCycle
                  ? [
                      {
                        label: `Final cycle ${formatDay(finalCycle.cycleStartDate, "d MMM")} – ${formatDay(finalCycle.cycleEndDate, "d MMM")} (${finalCycle.paidDays} paid days)`,
                        value: formatINR(finalCycle.outstanding),
                      },
                    ]
                  : []),
                {
                  label: "Other paydays still owed",
                  value: formatINR(otherPending),
                },
                {
                  label: s.reserveIncluded
                    ? "Joining Reserve"
                    : "Joining Reserve (forfeited)",
                  value: formatINR(s.reserveAmount),
                },
                ...s.unsettledAdjustments.map((a) => ({
                  label: `${ADJUSTMENT_LABEL[a.type]}: ${a.note}`,
                  value: formatINR(a.type === "bonus" ? a.amount : -a.amount, {
                    signed: true,
                  }),
                })),
                ...(s.extrasPaid > 0
                  ? [
                      {
                        label: "Already paid towards the reserve",
                        value: formatINR(-s.extrasPaid),
                      },
                    ]
                  : []),
                {
                  label: "Total to pay",
                  value: formatINR(s.totalOutstanding),
                  strong: true,
                },
              ]}
            />
            {profile.lastWorkingDay && profile.lastWorkingDay > today ? (
              <Banner tone="info">
                You can confirm the settlement from{" "}
                {formatDate(profile.lastWorkingDay)}.
              </Banner>
            ) : (
              <form
                className="grid gap-3 sm:grid-cols-3 sm:items-end"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (
                    !window.confirm(
                      `Record ${formatINR(s.totalOutstanding)} as paid and mark ${profile.name} as left?`,
                    )
                  )
                    return;
                  await run(
                    () =>
                      confirm({
                        staffId: profile.staffId,
                        paidOn,
                        mode,
                        note: note.trim() || undefined,
                      }),
                    "Settlement recorded.",
                  );
                }}
              >
                <Field id="settle-date" label="Paid on">
                  {(p) => (
                    <Input
                      {...p}
                      type="date"
                      max={today}
                      value={paidOn}
                      onChange={(e) => setPaidOn(e.target.value)}
                    />
                  )}
                </Field>
                <PaymentModeSelect
                  id="settle-mode"
                  value={mode}
                  onChange={setMode}
                />
                <Field id="settle-note" label="Note (optional)">
                  {(p) => (
                    <Input
                      {...p}
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                    />
                  )}
                </Field>
                <div className="flex justify-end sm:col-span-3">
                  <Button type="submit" loading={busy}>
                    Confirm and record payment
                  </Button>
                </div>
              </form>
            )}
          </CardBody>
        </Card>
      ) : null}
    </>
  );
}
