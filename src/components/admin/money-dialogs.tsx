"use client";

import { useMutation } from "convex/react";
import type { Id } from "@convex/_generated/dataModel";
import { HandCoins, History, Plus } from "lucide-react";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
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
import { toast } from "@/components/ui/toaster";
import { useQuery } from "@/lib/convex";
import { friendlyError } from "@/lib/errors";
import { formatDay, formatINR, todayIn } from "@/lib/format";
import { PAYMENT_MODE_LABEL } from "@/lib/labels";

type Mode = "cash" | "upi" | "bank";

export function PaymentModeSelect({
  id,
  value,
  onChange,
}: {
  id: string;
  value: Mode;
  onChange: (m: Mode) => void;
}) {
  return (
    <Field id={id} label="Paid by">
      {(p) => (
        <NativeSelect
          {...p}
          value={value}
          onChange={(e) => onChange(e.target.value as Mode)}
        >
          {(["cash", "upi", "bank"] as const).map((m) => (
            <option key={m} value={m}>
              {PAYMENT_MODE_LABEL[m]}
            </option>
          ))}
        </NativeSelect>
      )}
    </Field>
  );
}

/** Records a (possibly partial) payment against one payday. */
export function RecordPaymentDialog({
  staffId,
  paydayKey,
  outstanding,
  title,
  trigger = "Record payment",
}: {
  staffId: Id<"staff">;
  paydayKey: string;
  outstanding: number;
  title: string;
  trigger?: string;
}) {
  const record = useMutation(api.payments.record);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(String(outstanding));
  const [paidOn, setPaidOn] = useState(todayIn());
  const [mode, setMode] = useState<Mode>("upi");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setAmount(String(outstanding));
          setPaidOn(todayIn());
          setNote("");
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="secondary" disabled={outstanding <= 0}>
          <Icon icon={HandCoins} />
          {trigger}
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Record payment"
        description={`${title}. ${formatINR(outstanding)} still owed; part payments are fine.`}
      >
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={async (event) => {
            event.preventDefault();
            const value = Number(amount);
            if (!Number.isInteger(value) || value <= 0)
              return setError("Enter an amount in whole rupees.");
            if (value > outstanding)
              return setError(
                `That's more than the ${formatINR(outstanding)} owed.`,
              );
            setBusy(true);
            setError(null);
            try {
              await record({
                staffId,
                paydayKey,
                amount: value,
                paidOn,
                mode,
                note: note.trim() || undefined,
              });
              toast.success(`Recorded ${formatINR(value)}.`);
              setOpen(false);
            } catch (e) {
              setError(friendlyError(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {error ? <Banner tone="danger">{error}</Banner> : null}
          <Field id="pay-amount" label="Amount (₹)">
            {(p) => (
              <Input
                {...p}
                type="number"
                inputMode="numeric"
                min={1}
                max={outstanding}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            )}
          </Field>
          <Field id="pay-date" label="Paid on">
            {(p) => (
              <Input
                {...p}
                type="date"
                max={todayIn()}
                value={paidOn}
                onChange={(e) => setPaidOn(e.target.value)}
              />
            )}
          </Field>
          <PaymentModeSelect id="pay-mode" value={mode} onChange={setMode} />
          <Field id="pay-note" label="Note (optional)">
            {(p) => (
              <Input
                {...p}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={200}
              />
            )}
          </Field>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button type="submit" loading={busy}>
              Record payment
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type Target = {
  key: string;
  date: string;
  status: string;
  label: string | null;
};

/** Adds an advance, deduction or bonus that settles against a payday (default: the next unpaid one). */
export function AddAdjustmentDialog({
  staffId,
  targets,
  defaultTarget,
  defaultKey,
}: {
  staffId: Id<"staff">;
  targets: Target[];
  defaultTarget: string | null;
  defaultKey?: string;
}) {
  const add = useMutation(api.adjustments.add);
  const [open, setOpen] = useState(false);
  const initial = () => ({
    type: "bonus" as "advance" | "deduction" | "bonus",
    amount: "",
    note: "",
    date: todayIn(),
    key: defaultKey ?? defaultTarget ?? "",
  });
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setForm(initial());
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="secondary" disabled={targets.length === 0}>
          <Icon icon={Plus} />
          Add adjustment
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Add adjustment"
        description="The staff member sees the type, amount and your note on that payday."
      >
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={async (event) => {
            event.preventDefault();
            const value = Number(form.amount);
            if (!Number.isInteger(value) || value <= 0)
              return setError("Enter an amount in whole rupees.");
            if (!form.note.trim()) return setError("Add a note.");
            setBusy(true);
            setError(null);
            try {
              await add({
                staffId,
                type: form.type,
                amount: value,
                note: form.note,
                date: form.date,
                paydayKey: form.key,
              });
              toast.success("Adjustment added.");
              setOpen(false);
            } catch (e) {
              setError(friendlyError(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {error ? <Banner tone="danger">{error}</Banner> : null}
          <Field id="adj-type" label="Type">
            {(p) => (
              <NativeSelect
                {...p}
                value={form.type}
                onChange={(e) =>
                  setForm({ ...form, type: e.target.value as typeof form.type })
                }
              >
                <option value="bonus">Bonus (adds to the payday)</option>
                <option value="deduction">
                  Deduction (reduces the payday)
                </option>
                <option value="advance">
                  Advance (money given now, recovered from the payday)
                </option>
              </NativeSelect>
            )}
          </Field>
          <Field id="adj-amount" label="Amount (₹)">
            {(p) => (
              <Input
                {...p}
                type="number"
                inputMode="numeric"
                min={1}
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
              />
            )}
          </Field>
          <Field id="adj-note" label="Note (shown to the staff member)">
            {(p) => (
              <Input
                {...p}
                value={form.note}
                maxLength={200}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
              />
            )}
          </Field>
          <Field id="adj-date" label="Date">
            {(p) => (
              <Input
                {...p}
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
              />
            )}
          </Field>
          <Field id="adj-payday" label="Settles on payday">
            {(p) => (
              <NativeSelect
                {...p}
                value={form.key}
                onChange={(e) => setForm({ ...form, key: e.target.value })}
              >
                {targets.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label ? `${t.label} · ` : ""}
                    {formatDay(t.date, "d MMM yyyy")}
                    {t.key === defaultTarget ? " (next unpaid)" : ""}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button type="submit" loading={busy}>
              Add adjustment
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Records a payment made before (outside the app) for a salary period: the
 * admin gives the dates the salary was for, the amount, when it was paid and
 * how. It's spread over that period's paydays, oldest first (previewed here).
 */
export function PastPaymentDialog({
  staffId,
  name,
}: {
  staffId: Id<"staff">;
  name: string;
}) {
  const record = useMutation(api.payments.recordPast);
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [paidOn, setPaidOn] = useState(todayIn());
  const [mode, setMode] = useState<Mode>("cash");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const value = Number(amount);
  const ready = from !== "" && to !== "" && from <= to;
  const plan = useQuery(
    api.payments.planPastPayment,
    ready ? { staffId, from, to, amount: value > 0 ? value : 0 } : "skip",
  );
  const problem = !ready
    ? null
    : plan && plan.covered.length === 0
      ? "Those dates don't cover any pay period."
      : plan && value > plan.owed
        ? `That's more than the ${formatINR(plan.owed)} still owed for those dates.`
        : null;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setFrom("");
          setTo("");
          setAmount("");
          setPaidOn(todayIn());
          setNote("");
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="secondary">
          <Icon icon={History} />
          Record a past payment
        </Button>
      </DialogTrigger>
      <DialogContent
        title={`Past payment to ${name}`}
        description="For salary already paid outside the app. Give the dates the salary was for; the amount is applied to the pay periods in those dates, oldest first."
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              const result = await record({
                staffId,
                from,
                to,
                amount: value,
                paidOn,
                mode,
                note: note.trim() || undefined,
              });
              toast.success(
                `Recorded against ${result.paydays} ${result.paydays === 1 ? "payday" : "paydays"}.`,
              );
              setOpen(false);
            } catch (error) {
              toast.error(friendlyError(error));
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <Field id="past-from" label="Salary for: from">
              {(p) => (
                <Input
                  {...p}
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  required
                />
              )}
            </Field>
            <Field id="past-to" label="to">
              {(p) => (
                <Input
                  {...p}
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  required
                />
              )}
            </Field>
            <Field id="past-amount" label="Amount paid (₹)">
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  step={1}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  required
                />
              )}
            </Field>
            <Field id="past-paid-on" label="Paid on">
              {(p) => (
                <Input
                  {...p}
                  type="date"
                  max={todayIn()}
                  value={paidOn}
                  onChange={(e) => setPaidOn(e.target.value)}
                  required
                />
              )}
            </Field>
          </div>
          <PaymentModeSelect id="past-mode" value={mode} onChange={setMode} />
          <Field
            id="past-note"
            label="Note (optional)"
            hint="Shown to the staff member with the payment."
          >
            {(p) => (
              <Input
                {...p}
                value={note}
                maxLength={200}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. October salary"
              />
            )}
          </Field>
          {ready && plan && plan.covered.length > 0 ? (
            <div
              className="flex flex-col gap-1 rounded-md bg-subtle px-3 py-2 text-sm"
              aria-label="How it will be applied"
            >
              <p className="font-medium">Pay periods in these dates</p>
              {plan.covered.map((p) => (
                <p key={p.key} className="flex justify-between gap-3">
                  <span>
                    {formatDay(p.cycleStartDate, "d MMM")} –{" "}
                    {formatDay(p.cycleEndDate, "d MMM yyyy")}
                    <span className="text-foreground-secondary">
                      {" "}
                      ·{" "}
                      {p.outstanding <= 0
                        ? "already paid"
                        : `${formatINR(p.outstanding)} owed`}
                    </span>
                  </span>
                  <span className="tabular font-medium">
                    {p.apply > 0 ? formatINR(p.apply) : "–"}
                  </span>
                </p>
              ))}
            </div>
          ) : null}
          {problem ? <Banner tone="danger">{problem}</Banner> : null}
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button
              type="submit"
              loading={busy}
              disabled={
                !ready || !(value > 0) || problem !== null || plan === undefined
              }
            >
              Record {value > 0 ? formatINR(value) : "payment"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
