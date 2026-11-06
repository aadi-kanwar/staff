"use client";

import { useAction, useMutation } from "convex/react";
import { Copy, KeyRound, ShieldCheck, Trash2, UserPlus } from "lucide-react";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { formatPhoneForDisplay } from "@convex/lib/inputRules";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import { LoadingState } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { toast } from "@/components/ui/toaster";
import { useQuery } from "@/lib/convex";
import { friendlyError } from "@/lib/errors";

/** Settings → Admins: everyone who can manage the organisation (full access), and adding more. */
export function AdminSettings() {
  const admins = useQuery(api.admins.list, {});
  return (
    <section aria-labelledby="admins" className="flex flex-col gap-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <h2 id="admins" className="font-serif text-2xl tracking-tight">
            Admins
          </h2>
          <p className="text-sm text-foreground-secondary">
            Every admin can do everything you can: all properties, staff, pay,
            reports and settings.
          </p>
        </div>
        <AddAdminDialog />
      </div>
      {admins === undefined ? (
        <LoadingState rows={2} />
      ) : (
        <Card>
          <ul className="divide-y divide-border" aria-label="Admins">
            {admins.map((a) => (
              <li
                key={a.userId}
                className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{a.name}</span>
                    {a.isYou ? (
                      <StatusBadge tone="primary" icon={ShieldCheck}>
                        You
                      </StatusBadge>
                    ) : null}
                    {a.mustChangePassword ? (
                      <StatusBadge tone="info" icon={KeyRound}>
                        Temporary password
                      </StatusBadge>
                    ) : null}
                  </div>
                  <span className="tabular text-sm text-foreground-secondary">
                    {formatPhoneForDisplay(a.phone)}
                  </span>
                </div>
                {a.isYou ? null : (
                  <div className="flex flex-wrap gap-2">
                    <ResetAdminPasswordDialog userId={a.userId} name={a.name} />
                    <RemoveAdminDialog
                      userId={a.userId}
                      name={a.name}
                      last={admins.length <= 1}
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </section>
  );
}

/** Shows a temporary password once, with Copy. */
function OneTimePassword({ password }: { password: string }) {
  return (
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
  );
}

function AddAdminDialog() {
  const add = useAction(api.admins.add);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState<string | null>(null);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setName("");
          setPhone("");
          setPassword(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button className="self-start">
          <Icon icon={UserPlus} />
          Add admin
        </Button>
      </DialogTrigger>
      <DialogContent
        title={password ? `${name.trim()} is now an admin` : "Add an admin"}
        description={
          password
            ? "Give them this temporary password in person. It's shown only once. They sign in with their mobile number and this password, then choose their own."
            : "They get full access to this organisation. You'll get a temporary password to give them."
        }
      >
        {password ? (
          <OneTimePassword password={password} />
        ) : (
          <form
            className="flex flex-col gap-4"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                setPassword((await add({ name, phone })).temporaryPassword);
              } catch (error) {
                toast.error(friendlyError(error));
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field id="admin-name" label="Full name">
              {(p) => (
                <Input
                  {...p}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="off"
                  required
                />
              )}
            </Field>
            <Field
              id="admin-phone"
              label="Mobile number"
              hint="Their login. India (+91) unless you type another code."
            >
              {(p) => (
                <Input
                  {...p}
                  type="tel"
                  inputMode="tel"
                  placeholder="98765 43210"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  required
                />
              )}
            </Field>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="ghost">Cancel</Button>
              </DialogClose>
              <Button type="submit" loading={busy}>
                Add admin
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ResetAdminPasswordDialog({
  userId,
  name,
}: {
  userId: Id<"users">;
  name: string;
}) {
  const reset = useAction(api.admins.resetPassword);
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
          <OneTimePassword password={password} />
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
                  setPassword((await reset({ userId })).temporaryPassword);
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

function RemoveAdminDialog({
  userId,
  name,
  last,
}: {
  userId: Id<"users">;
  name: string;
  last: boolean;
}) {
  const remove = useMutation(api.admins.remove);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" disabled={last}>
          <Icon icon={Trash2} />
          Remove
        </Button>
      </DialogTrigger>
      <DialogContent
        title={`Remove ${name}?`}
        description="Their admin login is deleted and they're signed out everywhere. Everything they did stays in the records and the audit log."
      >
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button
            variant="destructive"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await remove({ userId });
                toast.success(`${name} is no longer an admin.`);
                setOpen(false);
              } catch (error) {
                toast.error(friendlyError(error));
              } finally {
                setBusy(false);
              }
            }}
          >
            Remove admin
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
