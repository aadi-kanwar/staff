"use client";

import { KeyRound } from "lucide-react";
import Link from "next/link";
import { api } from "@convex/_generated/api";
import { formatPhoneForDisplay } from "@convex/lib/inputRules";
import {
  notificationPurpose,
  PhoneNotificationsCard,
} from "@/components/app/notifications";
import { SignOutButton, useMe } from "@/components/app/session";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { LoadingState } from "@/components/ui/skeleton";
import { DetailList } from "@/components/ui/stat";
import { useQuery } from "@/lib/convex";
import { formatDate } from "@/lib/format";

export default function StaffProfile() {
  const data = useQuery(api.staff.profile, {});
  const me = useMe();
  if (data === undefined) return <LoadingState rows={2} />;
  return (
    <>
      <h1 className="font-serif text-3xl tracking-tight">Profile</h1>
      <Card>
        <CardBody>
          <DetailList
            rows={[
              { label: "Name", value: data.name },
              { label: "Mobile", value: formatPhoneForDisplay(data.phone) },
              { label: "Property", value: data.property },
              { label: "Department", value: data.department },
              { label: "Joined", value: formatDate(data.joinDate) },
              ...(data.lastWorkingDay
                ? [
                    {
                      label: "Last working day",
                      value: formatDate(data.lastWorkingDay),
                    },
                  ]
                : []),
            ]}
          />
        </CardBody>
      </Card>
      <PhoneNotificationsCard
        purpose={notificationPurpose("staff", me?.canMarkAttendance === true)}
      />
      <div className="flex flex-col gap-2">
        <Button asChild variant="secondary" width="full">
          <Link href="/change-password">
            <Icon icon={KeyRound} />
            Change password
          </Link>
        </Button>
        <SignOutButton variant="secondary" full />
      </div>
      <p className="text-sm text-foreground-secondary">
        Forgot your password? Ask the office to reset it.
      </p>
    </>
  );
}
