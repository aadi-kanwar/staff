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
import { useMutation } from "convex/react";
import { Clock } from "lucide-react";
import {
  PayoutDialog,
  PayoutList,
  type PayoutDetails,
} from "@/components/app/payout";
import { toast } from "@/components/ui/toaster";
import { friendlyError } from "@/lib/errors";
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
      <PayoutSection payout={data.payout} request={data.payoutRequest} />
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

/** Where their salary is paid; changes go to an admin for approval. */
function PayoutSection({
  payout,
  request,
}: {
  payout: PayoutDetails | null;
  request: (PayoutDetails & { submittedAt: number }) | null;
}) {
  const submit = useMutation(api.payoutRequests.submit);
  const withdraw = useMutation(api.payoutRequests.withdraw);
  return (
    <section aria-labelledby="payout" className="flex flex-col gap-2">
      <h2 id="payout" className="font-serif text-xl">
        Salary payment details
      </h2>
      <Card>
        <CardBody className="flex flex-col gap-3">
          <PayoutList details={payout} />
          {request ? (
            <div className="flex flex-col gap-2 rounded-md border border-warning-border bg-warning-subtle p-3 text-sm">
              <p className="flex items-center gap-2 font-medium text-warning">
                <Icon icon={Clock} />
                Your change is waiting for approval
              </p>
              <PayoutList details={request} />
              <Button
                variant="ghost"
                className="self-start"
                onClick={async () => {
                  try {
                    await withdraw({});
                    toast.success("Change withdrawn.");
                  } catch (error) {
                    toast.error(friendlyError(error));
                  }
                }}
              >
                Withdraw this change
              </Button>
            </div>
          ) : null}
          <PayoutDialog
            initial={request ?? payout}
            trigger={
              payout || request
                ? "Update payment details"
                : "Add payment details"
            }
            title="Salary payment details"
            description="Where you'd like your salary paid. An admin checks and approves the change before it's used."
            saveLabel="Send for approval"
            onSave={async (details) => {
              await submit({ details });
              toast.success("Sent. An admin will approve it.");
            }}
          />
        </CardBody>
      </Card>
    </section>
  );
}
