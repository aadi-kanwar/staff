"use client";

import { Wallet } from "lucide-react";
import { api } from "@convex/_generated/api";
import { PaydayStatusBadge } from "@/components/app/payday-status";
import { Card, CardBody } from "@/components/ui/card";
import { LoadingState } from "@/components/ui/skeleton";
import { DetailList } from "@/components/ui/stat";
import { EmptyState } from "@/components/ui/states";
import { useQuery } from "@/lib/convex";
import { formatDay, formatINR } from "@/lib/format";

export default function StaffPayments() {
  const data = useQuery(api.staff.payments, {});
  if (data === undefined) return <LoadingState rows={3} />;
  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="font-serif text-3xl tracking-tight">Payments</h1>
        <p className="text-foreground-secondary">
          Total paid to you:{" "}
          <strong className="tabular">{formatINR(data.totalPaid)}</strong>
        </p>
      </div>
      {data.paydays.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title="No paydays yet"
          description="Your first payday will appear here."
        />
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Paydays">
          {data.paydays.map((p) => (
            <li key={p.id}>
              <Card
                className={
                  p.date < data.today && p.remaining > 0
                    ? "border-danger-border"
                    : undefined
                }
              >
                <CardBody className="flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex flex-col">
                      <span className="text-sm text-foreground-secondary">
                        {p.title} · {formatDay(p.date, "EEE d MMM yyyy")}
                      </span>
                      <span className="tabular font-serif text-2xl">
                        {formatINR(p.amount)}
                      </span>
                    </div>
                    <PaydayStatusBadge
                      status={p.status}
                      overdue={p.date < data.today && p.remaining > 0}
                    />
                  </div>
                  <DetailList
                    rows={[
                      ...p.lines.map((l) => ({
                        label: l.label,
                        value: formatINR(l.amount, {
                          exact: true,
                          signed: l.amount < 0,
                        }),
                      })),
                      {
                        label: "Amount",
                        value: formatINR(p.amount),
                        strong: true,
                      },
                    ]}
                  />
                  {p.payments.length > 0 ? (
                    <div className="flex flex-col gap-1 rounded-md bg-subtle px-3 py-2 text-sm">
                      {p.payments.map((pay, i) => (
                        <p key={i} className="flex justify-between gap-3">
                          <span>
                            Paid {formatDay(pay.paidOn, "d MMM yyyy")} ·{" "}
                            {pay.method}
                          </span>
                          <span className="tabular">
                            {formatINR(pay.amount)}
                          </span>
                        </p>
                      ))}
                      {p.remaining > 0 ? (
                        <p className="flex justify-between gap-3 font-medium text-warning">
                          <span>Still to come</span>
                          <span className="tabular">
                            {formatINR(p.remaining)}
                          </span>
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </CardBody>
              </Card>
            </li>
          ))}
        </ul>
      )}
      {data.pastRecords.length > 0 ? (
        <section aria-labelledby="past-records" className="flex flex-col gap-2">
          <h2 id="past-records" className="font-serif text-xl">
            Past payments
          </h2>
          <p className="text-sm text-foreground-secondary">
            Recorded by the office for your records. Not included in the total
            above.
          </p>
          <ul className="flex flex-col gap-3" aria-label="Past payments">
            {data.pastRecords.map((r) => (
              <li key={r.recordId}>
                <Card>
                  <CardBody className="flex flex-col gap-3">
                    <div className="flex flex-col">
                      <span className="text-sm text-foreground-secondary">
                        For {formatDay(r.from, "d MMM")} –{" "}
                        {formatDay(r.to, "d MMM yyyy")}
                      </span>
                      <span className="tabular font-serif text-2xl">
                        {formatINR(r.total)}
                      </span>
                    </div>
                    <DetailList
                      rows={[
                        { label: "Salary", value: formatINR(r.salary) },
                        ...(r.bonus
                          ? [
                              {
                                label: "Bonus",
                                value: formatINR(r.bonus, { signed: true }),
                              },
                            ]
                          : []),
                        ...(r.deduction
                          ? [
                              {
                                label: "Deduction",
                                value: formatINR(-r.deduction, {
                                  signed: true,
                                }),
                              },
                            ]
                          : []),
                        {
                          label: "Total paid",
                          value: formatINR(r.total),
                          strong: true,
                        },
                      ]}
                    />
                    {r.paidOn || r.note ? (
                      <p className="text-sm text-foreground-secondary">
                        {r.paidOn
                          ? `Paid ${formatDay(r.paidOn, "d MMM yyyy")}${r.method ? ` · ${r.method}` : ""}`
                          : ""}
                        {r.paidOn && r.note ? " · " : ""}
                        {r.note ?? ""}
                      </p>
                    ) : null}
                  </CardBody>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
