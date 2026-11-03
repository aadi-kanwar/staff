"use client";

import type { FunctionReturnType } from "convex/server";
import Link from "next/link";
import type { api } from "@convex/_generated/api";
import { PaydayStatusBadge } from "@/components/app/payday-status";
import { formatDay, formatINR } from "@/lib/format";

export type OpenRow = FunctionReturnType<typeof api.paydays.overview>["rows"][number];

/** A compact list of paydays (dashboard). */
export function PaydayList({ rows, label }: { rows: OpenRow[]; label: string }) {
  return (
    <ul className="divide-y divide-border" aria-label={label}>
      {rows.map((row) => (
        <li key={row.key} className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <Link href={`/admin/staff/${row.staffId}?tab=paydays`} className="truncate font-medium underline-offset-4 hover:underline">
              {row.name}
            </Link>
            <span className="text-sm text-foreground-secondary">
              {row.kind === "final" ? "Final settlement" : row.isFinal ? "Final cycle" : "Payday"} · {formatDay(row.dueDate)}
            </span>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <span className="tabular font-semibold">{formatINR(row.outstanding)}</span>
            <PaydayStatusBadge status={row.status} overdue={row.overdue} />
          </div>
        </li>
      ))}
    </ul>
  );
}
