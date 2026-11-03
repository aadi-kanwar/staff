"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { StaffShell } from "@/components/app/staff-shell";
import { destinationFor, SignOutButton, useMe } from "@/components/app/session";
import { LoadingState } from "@/components/ui/skeleton";
import { NotAuthorizedState } from "@/components/ui/states";

export default function StaffLayout({ children }: { children: React.ReactNode }) {
  const me = useMe();
  const router = useRouter();
  useEffect(() => {
    if (me === null) router.replace("/signin");
    else if (me && (me.mustChangePassword || me.role === "admin")) router.replace(destinationFor(me));
  }, [me, router]);
  if (me === undefined || me === null || me.mustChangePassword || me.role === "admin") {
    return (
      <StaffShell>
        <LoadingState rows={3} />
      </StaffShell>
    );
  }
  if (me.role !== "staff") {
    return (
      <StaffShell>
        <NotAuthorizedState description="This account isn't set up yet. Please contact the office." />
        <div className="flex justify-center">
          <SignOutButton variant="secondary" />
        </div>
      </StaffShell>
    );
  }
  return <StaffShell nav>{children}</StaffShell>;
}
