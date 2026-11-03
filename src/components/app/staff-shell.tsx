"use client";

import { staffNav } from "@/components/nav/nav-items";
import { BottomNav } from "@/components/nav/staff-nav";
import { AppFrame } from "./app-frame";
import { Brand } from "./brand";
import { SignOutButton, useMe } from "./session";

/**
 * Frame for staff screens (mobile-first): app name, and the bottom
 * navigation on every screen size. Without `nav` (e.g. the forced password
 * change), a logout button sits in the header instead.
 */
export function StaffShell({
  nav = false,
  children,
}: {
  nav?: boolean;
  children: React.ReactNode;
}) {
  const me = useMe();
  return (
    <AppFrame
      header={
        <header className="border-b border-border bg-surface">
          <div className="mx-auto flex h-14 max-w-lg items-center justify-between px-4">
            <Brand />
            {nav ? null : <SignOutButton />}
          </div>
        </header>
      }
      nav={
        nav ? (
          <BottomNav
            items={staffNav(me?.canMarkAttendance === true)}
            everywhere
          />
        ) : null
      }
    >
      <main className="mx-auto flex min-h-full w-full max-w-lg flex-col gap-6 px-4 py-6">
        {children}
      </main>
    </AppFrame>
  );
}
