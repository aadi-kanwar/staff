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
 * Records a past payment, for the record only: the dates it was for and one
 * breakdown (salary + bonus − deduction). It shows on the calendars and in
 * the payment history but never changes what's owed or the ledger.
 */
export function PastPaymentDialog({
  staffId,
  name,
}: {
  staffId: Id<"staff">;
  name: string;
}) {
  const add = useMutation(api.pastRecords.add);
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [salary, setSalary] = useState("");
  const [bonus, setBonus] = useState("");
  const [deduction, setDeduction] = useState("");
  const [paidOn, setPaidOn] = useState("");
  const [mode, setMode] = useState<Mode>("cash");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const n = (x: string) => (Number(x) > 0 ? Math.round(Number(x)) : 0);
  const total = n(salary) + n(bonus) - n(deduction);
  const ready =
    from !== "" && to !== "" && n(salary) + n(bonus) + n(deduction) > 0;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setFrom("");
          setTo("");
          setSalary("");
          setBonus("");
          setDeduction("");
          setPaidOn("");
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
        description="For the record only: it shows on the calendars and in the payment history, but doesn't change what's owed or the ledger."
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await add({
                staffId,
                from,
                to,
                salary: n(salary),
                bonus: n(bonus) || undefined,
                deduction: n(deduction) || undefined,
                paidOn: paidOn || undefined,
                mode: paidOn ? mode : undefined,
                note: note.trim() || undefined,
              });
              toast.success("Past payment recorded.");
              setOpen(false);
            } catch (error) {
              toast.error(friendlyError(error));
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <Field id="past-from" label="For: from">
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
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field id="past-salary" label="Salary (₹)">
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={1}
                  value={salary}
                  onChange={(e) => setSalary(e.target.value)}
                />
              )}
            </Field>
            <Field id="past-bonus" label="+ Bonus (₹)">
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={1}
                  value={bonus}
                  onChange={(e) => setBonus(e.target.value)}
                />
              )}
            </Field>
            <Field id="past-deduction" label="− Deduction (₹)">
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={1}
                  value={deduction}
                  onChange={(e) => setDeduction(e.target.value)}
                />
              )}
            </Field>
          </div>
          <p
            className="flex justify-between rounded-md bg-subtle px-3 py-2 text-sm font-medium"
            aria-live="polite"
          >
            <span>Total paid</span>
            <span className="tabular">{formatINR(total)}</span>
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Field id="past-paid-on" label="Paid on (optional)">
              {(p) => (
                <Input
                  {...p}
                  type="date"
                  value={paidOn}
                  onChange={(e) => setPaidOn(e.target.value)}
                />
              )}
            </Field>
            <PaymentModeSelect id="past-mode" value={mode} onChange={setMode} />
          </div>
          <Field
            id="past-note"
            label="Note (optional)"
            hint="Shown to the staff member."
          >
            {(p) => (
              <Input
                {...p}
                value={note}
                maxLength={200}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. March salary"
              />
            )}
          </Field>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button type="submit" loading={busy} disabled={!ready}>
              Save record
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
