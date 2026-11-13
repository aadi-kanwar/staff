"use client";

import { Pencil } from "lucide-react";
import { useState } from "react";
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
import { DetailList } from "@/components/ui/stat";
import { toast } from "@/components/ui/toaster";
import { friendlyError } from "@/lib/errors";

/** Where a salary is paid: a UPI ID and/or a bank account (all optional here; the server checks). */
export type PayoutDetails = {
  upiId?: string;
  accountName?: string;
  accountNumber?: string;
  ifsc?: string;
  bankName?: string;
};

const EMPTY: Required<PayoutDetails> = {
  upiId: "",
  accountName: "",
  accountNumber: "",
  ifsc: "",
  bankName: "",
};

/** The details as label/value rows; "Not given" when empty. */
export function PayoutList({ details }: { details: PayoutDetails | null }) {
  if (!details || (!details.upiId && !details.accountNumber)) {
    return <p className="text-sm text-foreground-secondary">Not given yet.</p>;
  }
  return (
    <DetailList
      rows={[
        ...(details.upiId ? [{ label: "UPI ID", value: details.upiId }] : []),
        ...(details.accountNumber
          ? [
              { label: "Account holder", value: details.accountName ?? "" },
              {
                label: "Account number",
                value: <span className="tabular">{details.accountNumber}</span>,
              },
              { label: "IFSC", value: details.ifsc ?? "" },
              ...(details.bankName
                ? [{ label: "Bank", value: details.bankName }]
                : []),
            ]
          : []),
      ]}
    />
  );
}

/**
 * A dialog to enter UPI and/or bank details. `onSave` does the saving (an
 * admin's direct edit, or a staff member's request for approval).
 */
export function PayoutDialog({
  initial,
  trigger,
  title,
  description,
  saveLabel,
  onSave,
}: {
  initial: PayoutDetails | null;
  trigger: string;
  title: string;
  description: string;
  saveLabel: string;
  onSave: (details: PayoutDetails) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Required<PayoutDetails>>(EMPTY);
  const [busy, setBusy] = useState(false);
  const set = (key: keyof PayoutDetails, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next)
          setForm({
            ...EMPTY,
            ...Object.fromEntries(
              Object.entries(initial ?? {}).filter(([, v]) => v !== undefined),
            ),
          });
      }}
    >
      <DialogTrigger asChild>
        <Button variant="secondary" className="self-start">
          <Icon icon={Pencil} />
          {trigger}
        </Button>
      </DialogTrigger>
      <DialogContent title={title} description={description}>
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await onSave(form);
              setOpen(false);
            } catch (error) {
              toast.error(friendlyError(error));
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field
            id="payout-upi"
            label="UPI ID"
            hint="Like name@okaxis. Leave empty to be paid by bank only."
          >
            {(p) => (
              <Input
                {...p}
                value={form.upiId}
                onChange={(e) => set("upiId", e.target.value)}
                autoComplete="off"
                inputMode="email"
              />
            )}
          </Field>
          <fieldset className="flex flex-col gap-3 rounded-md border border-border p-3">
            <legend className="px-1 text-sm font-medium">
              Bank account (optional)
            </legend>
            <Field id="payout-name" label="Account holder's name">
              {(p) => (
                <Input
                  {...p}
                  value={form.accountName}
                  onChange={(e) => set("accountName", e.target.value)}
                  autoComplete="off"
                />
              )}
            </Field>
            <Field id="payout-number" label="Account number">
              {(p) => (
                <Input
                  {...p}
                  value={form.accountNumber}
                  inputMode="numeric"
                  onChange={(e) => set("accountNumber", e.target.value)}
                  autoComplete="off"
                />
              )}
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field id="payout-ifsc" label="IFSC">
                {(p) => (
                  <Input
                    {...p}
                    value={form.ifsc}
                    onChange={(e) => set("ifsc", e.target.value.toUpperCase())}
                    autoComplete="off"
                  />
                )}
              </Field>
              <Field id="payout-bank" label="Bank (optional)">
                {(p) => (
                  <Input
                    {...p}
                    value={form.bankName}
                    onChange={(e) => set("bankName", e.target.value)}
                    autoComplete="off"
                  />
                )}
              </Field>
            </div>
          </fieldset>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button type="submit" loading={busy}>
              {saveLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
