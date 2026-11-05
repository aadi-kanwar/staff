"use client";

import { KeyRound } from "lucide-react";
import Link from "next/link";
import { api } from "@convex/_generated/api";
import { formatPhoneForDisplay } from "@convex/lib/inputRules";
import { NotificationSettings } from "@/components/admin/notification-settings";
import { OrganizationSettings } from "@/components/admin/organization-settings";
import { ResetPasswordDialog } from "@/components/admin/staff-tabs";
import {
  usePropertyScope,
  useShowProperty,
} from "@/components/app/property-scope";
import { useMe } from "@/components/app/session";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import { LoadingState } from "@/components/ui/skeleton";
import { DetailList } from "@/components/ui/stat";
import { EmptyState } from "@/components/ui/states";
import { useQuery } from "@/lib/convex";

export default function SettingsPage() {
  const me = useMe();
  const scope = usePropertyScope();
  const showProperty = useShowProperty();
  const staff = useQuery(api.people.list, scope.arg);
  return (
    <>
      <PageHeader
        title="Settings"
        description="Your organisation and properties, your admin account, and password resets for staff."
      />
      <OrganizationSettings />
      <NotificationSettings />
      <section aria-labelledby="account" className="flex flex-col gap-2">
        <h2 id="account" className="font-serif text-2xl tracking-tight">
          Admin account
        </h2>
        <Card>
          <CardBody className="flex flex-col gap-4">
            {me ? (
              <DetailList
                rows={[
                  { label: "Name", value: me.name ?? "—" },
                  {
                    label: "Mobile (login)",
                    value: me.phone ? formatPhoneForDisplay(me.phone) : "—",
                  },
                  { label: "Role", value: "Admin" },
                ]}
              />
            ) : (
              <LoadingState rows={1} />
            )}
            <Button asChild variant="secondary" className="self-start">
              <Link href="/change-password">
                <Icon icon={KeyRound} />
                Change my password
              </Link>
            </Button>
          </CardBody>
        </Card>
      </section>
      <section aria-labelledby="resets" className="flex flex-col gap-2">
        <h2 id="resets" className="font-serif text-2xl tracking-tight">
          Staff password resets
        </h2>
        <p className="text-sm text-foreground-secondary">
          Staff can&apos;t reset their own password. Give them a temporary one
          here; they choose a new one when they sign in.
        </p>
        {staff === undefined ? (
          <LoadingState />
        ) : staff.length === 0 ? (
          <EmptyState title="No staff yet" />
        ) : (
          <Card>
            <ul className="divide-y divide-border" aria-label="Staff logins">
              {staff.map((s) => (
                <li
                  key={s.staffId}
                  className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex flex-col">
                    <span className="font-medium">
                      {s.name}
                      {s.status === "exited" ? " (left)" : ""}
                    </span>
                    <span className="tabular text-sm text-foreground-secondary">
                      {showProperty ? `${s.propertyName} · ` : null}
                      {formatPhoneForDisplay(s.phone)}
                      {s.mustChangePassword
                        ? " · temporary password not changed yet"
                        : ""}
                    </span>
                  </div>
                  <ResetPasswordDialog staffId={s.staffId} name={s.name} />
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>
    </>
  );
}
