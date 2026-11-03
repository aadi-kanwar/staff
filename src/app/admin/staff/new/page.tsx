"use client";

import { useAction } from "convex/react";
import { ArrowLeft, UserPlus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  departmentSchema,
  displayNameSchema,
  normalizePhone,
  passwordProblem,
  PASSWORD_MIN_LENGTH,
} from "@convex/lib/inputRules";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { PageHeader } from "@/components/ui/page-header";
import { PasswordInput } from "@/components/ui/password-input";
import { toast } from "@/components/ui/toaster";
import { useQuery } from "@/lib/convex";
import { usePropertyScope } from "@/components/app/property-scope";
import { friendlyError } from "@/lib/errors";
import { formatDay, formatINR, todayIn } from "@/lib/format";

type PayMode = "monthly_10th" | "half_16day";
type Errors = Partial<Record<string, string>>;

export default function NewStaffPage() {
  const router = useRouter();
  const create = useAction(api.people.create);
  const payModes = useQuery(api.people.payModes, {});
  const scope = usePropertyScope();
  const departments = useQuery(api.people.departments, {});
  const [form, setForm] = useState({
    propertyId: (scope.current?.propertyId ?? "") as string,
    name: "",
    phone: "",
    department: "",
    joinDate: todayIn(),
    monthlySalary: "",
    payMode: "" as PayMode | "",
    paidUpTo: "",
    reserveStatus: "held" as "held" | "released" | "forfeited",
    canMarkAttendance: false,
    reserveForfeitReason: "",
    openingType: "" as "" | "advance" | "deduction" | "bonus",
    openingAmount: "",
    openingNote: "",
    password: "",
  });
  const [errors, setErrors] = useState<Errors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [key]: value }));
  const salary = Number(form.monthlySalary);
  const preview = useQuery(
    api.people.previewOpening,
    form.payMode && salary > 0 && /^\d{4}-\d{2}-\d{2}$/.test(form.joinDate)
      ? {
          joinDate: form.joinDate,
          monthlySalary: salary,
          payMode: form.payMode,
        }
      : "skip",
  );
  const past = preview && !Array.isArray(preview) ? preview.past : [];

  function validate(): Errors {
    const e: Errors = {};
    if (!form.propertyId) e.propertyId = "Choose the property they work at.";
    const name = displayNameSchema.safeParse(form.name);
    if (!name.success) e.name = name.error.issues[0].message;
    const phone = normalizePhone(form.phone);
    if (phone === null) e.phone = "Enter a valid mobile number.";
    const dept = departmentSchema.safeParse(form.department);
    if (!dept.success) e.department = dept.error.issues[0].message;
    if (!form.joinDate) e.joinDate = "Choose the joining date.";
    if (!Number.isInteger(salary) || salary <= 0)
      e.monthlySalary = "Enter the monthly salary in whole rupees.";
    if (!form.payMode) e.payMode = "Choose the pay mode.";
    if (
      form.reserveStatus === "forfeited" &&
      form.reserveForfeitReason.trim().length < 3
    )
      e.reserveForfeitReason = "Give a reason.";
    if (form.openingType) {
      const amount = Number(form.openingAmount);
      if (!Number.isInteger(amount) || amount <= 0)
        e.openingAmount = "Enter an amount in whole rupees.";
      if (!form.openingNote.trim())
        e.openingNote = "Add a note; the staff member will see it.";
    }
    const problem = passwordProblem(form.password, phone);
    if (problem) e.password = problem;
    return e;
  }

  return (
    <>
      <Button asChild variant="ghost" className="self-start">
        <Link href="/admin/staff">
          <Icon icon={ArrowLeft} />
          Staff
        </Link>
      </Button>
      <PageHeader
        title="Add staff"
        description="Creates their login. They sign in with their mobile number and this password, and must choose their own at first sign-in."
      />
      <form
        noValidate
        className="flex flex-col gap-6"
        onSubmit={async (event) => {
          event.preventDefault();
          const found = validate();
          setErrors(found);
          if (Object.keys(found).length > 0) return;
          setBusy(true);
          setServerError(null);
          try {
            const { staffId } = await create({
              propertyId: form.propertyId as Id<"properties">,
              name: form.name,
              phone: form.phone,
              department: form.department,
              joinDate: form.joinDate,
              monthlySalary: salary,
              payMode: form.payMode as PayMode,
              paidUpToIndex: form.paidUpTo ? Number(form.paidUpTo) : undefined,
              reserveStatus: form.reserveStatus,
              reserveForfeitReason:
                form.reserveStatus === "forfeited"
                  ? form.reserveForfeitReason
                  : undefined,
              opening: form.openingType
                ? {
                    type: form.openingType,
                    amount: Number(form.openingAmount),
                    note: form.openingNote,
                  }
                : undefined,
              canMarkAttendance: form.canMarkAttendance,
              initialPassword: form.password,
            });
            toast.success(`${form.name.trim()} added.`);
            router.replace(`/admin/staff/${staffId}`);
          } catch (error) {
            setServerError(friendlyError(error));
            setBusy(false);
          }
        }}
      >
        {serverError ? <Banner tone="danger">{serverError}</Banner> : null}
        <Card>
          <CardBody className="grid gap-4 sm:grid-cols-2">
            <h2 className="font-serif text-xl sm:col-span-2">Person</h2>
            <Field
              id="property"
              label="Property"
              hint="Where they work. You can move them later."
              error={errors.propertyId}
              className="sm:col-span-2"
            >
              {(p) => (
                <NativeSelect
                  {...p}
                  value={form.propertyId}
                  onChange={(e) => set("propertyId", e.target.value)}
                >
                  <option value="">Choose a property</option>
                  {scope.properties.map((property) => (
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
            <Field id="name" label="Full name" error={errors.name}>
              {(p) => (
                <Input
                  {...p}
                  value={form.name}
                  onChange={(e) => set("name", e.target.value)}
                  autoComplete="off"
                />
              )}
            </Field>
            <Field
              id="phone"
              label="Mobile number"
              hint="Their login. India (+91) unless you type another code."
              error={errors.phone}
            >
              {(p) => (
                <Input
                  {...p}
                  type="tel"
                  inputMode="tel"
                  value={form.phone}
                  onChange={(e) => set("phone", e.target.value)}
                  placeholder="98765 43210"
                />
              )}
            </Field>
            <Field id="department" label="Department" error={errors.department}>
              {(p) => (
                <>
                  <Input
                    {...p}
                    list="departments"
                    value={form.department}
                    onChange={(e) => set("department", e.target.value)}
                    placeholder="e.g. Kitchen"
                  />
                  <datalist id="departments">
                    {departments?.map((d) => (
                      <option key={d} value={d} />
                    ))}
                  </datalist>
                </>
              )}
            </Field>
            <Field id="joinDate" label="Joining date" error={errors.joinDate}>
              {(p) => (
                <Input
                  {...p}
                  type="date"
                  value={form.joinDate}
                  onChange={(e) => set("joinDate", e.target.value)}
                />
              )}
            </Field>
            <label className="flex min-h-11 items-start gap-3 rounded-md border border-border bg-subtle px-3 py-2.5 sm:col-span-2">
              <input
                type="checkbox"
                className="mt-0.5 size-5 shrink-0 accent-primary"
                checked={form.canMarkAttendance}
                onChange={(e) => set("canMarkAttendance", e.target.checked)}
              />
              <span className="flex flex-col">
                <span className="text-sm font-medium">Can mark attendance</span>
                <span className="text-sm text-foreground-secondary">
                  Lets them mark attendance for the other staff at their
                  property, from their phone (today and the last 7 days). They
                  still can&apos;t see anyone&apos;s pay.
                </span>
              </span>
            </label>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="grid gap-4 sm:grid-cols-2">
            <h2 className="font-serif text-xl sm:col-span-2">Pay</h2>
            <Field
              id="salary"
              label="Monthly salary (₹)"
              error={errors.monthlySalary}
            >
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  step={1}
                  value={form.monthlySalary}
                  onChange={(e) => set("monthlySalary", e.target.value)}
                />
              )}
            </Field>
            <Field
              id="payMode"
              label="Pay mode"
              hint="Never shown to the staff member."
              error={errors.payMode}
            >
              {(p) => (
                <NativeSelect
                  {...p}
                  value={form.payMode}
                  onChange={(e) => set("payMode", e.target.value as PayMode)}
                >
                  <option value="">Choose…</option>
                  {payModes?.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
            {preview && !Array.isArray(preview) ? (
              <p className="text-sm text-foreground-secondary sm:col-span-2">
                Joining Reserve:{" "}
                <strong className="tabular">
                  {formatINR(preview.reserveAmount)}
                </strong>{" "}
                (if no absences in the first days).
                {preview.next
                  ? ` Next payday ${formatDay(preview.next.date)}: ${formatINR(preview.next.net)}.`
                  : ""}
              </p>
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardBody className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1 sm:col-span-2">
              <h2 className="font-serif text-xl">Before the app</h2>
              <p className="text-sm text-foreground-secondary">
                For people who joined before today. Days before today count as
                Present.
              </p>
            </div>
            <Field
              id="paidUpTo"
              label="Paid up to"
              hint="Paydays up to and including this one are marked paid (settled outside the app)."
            >
              {(p) => (
                <NativeSelect
                  {...p}
                  value={form.paidUpTo}
                  onChange={(e) => set("paidUpTo", e.target.value)}
                  disabled={past.length === 0}
                >
                  <option value="">
                    {past.length === 0
                      ? "No paydays have passed yet"
                      : "Nothing paid yet"}
                  </option>
                  {past.map((d) => (
                    <option key={d.paydayIndex} value={d.paydayIndex}>
                      {formatDay(d.date, "d MMM yyyy")} · {formatINR(d.net)}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
            <Field
              id="reserveStatus"
              label="Joining Reserve"
              error={errors.reserveStatus}
            >
              {(p) => (
                <NativeSelect
                  {...p}
                  value={form.reserveStatus}
                  onChange={(e) =>
                    set(
                      "reserveStatus",
                      e.target.value as typeof form.reserveStatus,
                    )
                  }
                >
                  <option value="held">Held (usual)</option>
                  <option value="released">Already paid out</option>
                  <option value="forfeited">Forfeited</option>
                </NativeSelect>
              )}
            </Field>
            {form.reserveStatus === "forfeited" ? (
              <Field
                id="reason"
                label="Reason for forfeiting"
                error={errors.reserveForfeitReason}
                className="sm:col-span-2"
              >
                {(p) => (
                  <Input
                    {...p}
                    value={form.reserveForfeitReason}
                    onChange={(e) =>
                      set("reserveForfeitReason", e.target.value)
                    }
                  />
                )}
              </Field>
            ) : null}
            <Field
              id="openingType"
              label="Opening balance (optional)"
              hint="Settles against the first unpaid payday."
            >
              {(p) => (
                <NativeSelect
                  {...p}
                  value={form.openingType}
                  onChange={(e) =>
                    set(
                      "openingType",
                      e.target.value as typeof form.openingType,
                    )
                  }
                >
                  <option value="">None</option>
                  <option value="advance">Advance to recover</option>
                  <option value="deduction">Deduction</option>
                  <option value="bonus">Amount owed to them (bonus)</option>
                </NativeSelect>
              )}
            </Field>
            {form.openingType ? (
              <>
                <Field
                  id="openingAmount"
                  label="Amount (₹)"
                  error={errors.openingAmount}
                >
                  {(p) => (
                    <Input
                      {...p}
                      type="number"
                      inputMode="numeric"
                      min={1}
                      value={form.openingAmount}
                      onChange={(e) => set("openingAmount", e.target.value)}
                    />
                  )}
                </Field>
                <Field
                  id="openingNote"
                  label="Note (shown to them)"
                  error={errors.openingNote}
                  className="sm:col-span-2"
                >
                  {(p) => (
                    <Input
                      {...p}
                      value={form.openingNote}
                      onChange={(e) => set("openingNote", e.target.value)}
                      placeholder="e.g. Advance given in October"
                    />
                  )}
                </Field>
              </>
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardBody className="grid gap-4 sm:grid-cols-2">
            <h2 className="font-serif text-xl sm:col-span-2">Login</h2>
            <Field
              id="password"
              label="Initial password"
              hint={`At least ${PASSWORD_MIN_LENGTH} characters. Tell them in person.`}
              error={errors.password}
            >
              {(p) => (
                <PasswordInput
                  {...p}
                  value={form.password}
                  onChange={(e) => set("password", e.target.value)}
                  autoComplete="new-password"
                />
              )}
            </Field>
          </CardBody>
        </Card>
        <div className="flex justify-end">
          <Button type="submit" loading={busy}>
            {busy ? null : <Icon icon={UserPlus} />}
            Add staff member
          </Button>
        </div>
      </form>
    </>
  );
}
