"use client";

import { Bell, EllipsisVertical, Share, SquarePlus } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { usePhoneNotifications } from "./notifications";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
};

const INSTALLED_KEY = "staff-installed";
const INSTALL_LATER_KEY = "staff-install-later";
const NOTIFICATIONS_LATER_KEY = "staff-notifications-later";

function readStorage(store: () => Storage, key: string) {
  try {
    return store().getItem(key) === "1";
  } catch {
    return false;
  }
}
function writeStorage(store: () => Storage, key: string) {
  try {
    store().setItem(key, "1");
  } catch {
    // Private mode etc.: the prompt just shows again next time.
  }
}

// Chrome/Edge offer their own "Install" dialog through this event. It can fire
// before React starts, so it is caught as soon as this file loads.
let installPrompt: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event as InstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    writeStorage(() => localStorage, INSTALLED_KEY);
    notify();
  });
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

type Platform = "ios" | "android" | "desktop";

function platform(): Platform {
  const ua = navigator.userAgent;
  if (
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  )
    return "ios";
  return /Android/.test(ua) ? "android" : "desktop";
}

/** Opened from the home screen icon (not in a browser tab). */
function isInstalledApp() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as { standalone?: boolean }).standalone === true
  );
}

type InstallState = {
  show: boolean;
  platform: Platform;
  canPrompt: boolean;
} | null;
let lastInstall: InstallState = null;

function installState(): InstallState {
  const next = {
    show: !isInstalledApp() && !readStorage(() => localStorage, INSTALLED_KEY),
    platform: platform(),
    canPrompt: installPrompt !== null,
  };
  // Same object while nothing changed, as useSyncExternalStore requires.
  if (
    lastInstall &&
    lastInstall.show === next.show &&
    lastInstall.platform === next.platform &&
    lastInstall.canPrompt === next.canPrompt
  ) {
    return lastInstall;
  }
  lastInstall = next;
  return next;
}

/**
 * Pop-ups shown after sign-in, one at a time:
 * 1. "Add Staff as an app" (steps for Android and iPhone), on every visit until it's opened from
 *    the home screen icon (or installed through the browser's own dialog).
 * 2. Once opened from the home screen: "Turn on notifications", on every visit until they're on
 *    (or blocked). Where notifications are already allowed (e.g. signing in again on the same
 *    phone), they're turned on without asking.
 * "Not now" hides a pop-up until the next visit.
 */
export function AppPrompts({ purpose }: { purpose: string }) {
  const install = useSyncExternalStore(subscribe, installState, () => null);
  const installed = useSyncExternalStore(
    subscribe,
    isInstalledApp,
    () => false,
  );
  const [installLater, setInstallLater] = useState(() =>
    typeof window === "undefined"
      ? false
      : readStorage(() => sessionStorage, INSTALL_LATER_KEY),
  );
  // On a computer only the browser's own Install dialog is offered: the manual steps differ too much.
  const showInstall =
    install !== null &&
    install.show &&
    !installLater &&
    (install.platform !== "desktop" || install.canPrompt);

  return showInstall ? (
    <InstallDialog
      platform={install.platform}
      canPrompt={install.canPrompt}
      onLater={() => {
        writeStorage(() => sessionStorage, INSTALL_LATER_KEY);
        setInstallLater(true);
      }}
    />
  ) : installed ? (
    <NotificationsPrompt purpose={purpose} />
  ) : null;
}

function InstallDialog({
  platform,
  canPrompt,
  onLater,
}: {
  platform: Platform;
  canPrompt: boolean;
  onLater: () => void;
}) {
  const [busy, setBusy] = useState(false);
  // Both sets of steps are offered; the visitor's own phone is shown first.
  const [phone, setPhone] = useState<"android" | "ios">(
    platform === "ios" ? "ios" : "android",
  );
  return (
    <Dialog open onOpenChange={(open) => (open ? null : onLater())}>
      <DialogContent
        title="Add Staff as an app"
        description="Put Staff on your home screen to open it in one tap, like any other app, and get notifications."
      >
        <div
          role="tablist"
          aria-label="Your phone"
          className="grid grid-cols-2 gap-1 rounded-md bg-muted p-1"
        >
          {(
            [
              ["android", "Android"],
              ["ios", "iPhone"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={phone === value}
              onClick={() => setPhone(value)}
              className={cn(
                "min-h-11 rounded-sm text-sm font-medium transition-colors",
                phone === value
                  ? "bg-surface text-foreground shadow-sm"
                  : "text-foreground-secondary hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        {phone === "ios" ? (
          <ol className="flex flex-col gap-3 text-sm" aria-label="On iPhone">
            <Step n={1}>
              Open Staff in <b>Safari</b>.
            </Step>
            <Step n={2}>
              Tap{" "}
              <Icon icon={Share} className="inline size-4 align-text-bottom" />{" "}
              <b>Share</b> at the bottom of the screen (at the top on iPad).
            </Step>
            <Step n={3}>
              Scroll down and tap{" "}
              <Icon
                icon={SquarePlus}
                className="inline size-4 align-text-bottom"
              />{" "}
              <b>Add to Home Screen</b>.
            </Step>
            <Step n={4}>
              Keep the name <b>Staff</b> and tap <b>Add</b> (top right).
            </Step>
            <Step n={5}>
              Close Safari and open Staff from the new icon on your home screen.
            </Step>
          </ol>
        ) : (
          <ol className="flex flex-col gap-3 text-sm" aria-label="On Android">
            <Step n={1}>
              Open Staff in <b>Chrome</b>.
            </Step>
            <Step n={2}>
              Tap the menu{" "}
              <Icon
                icon={EllipsisVertical}
                className="inline size-4 align-text-bottom"
              />{" "}
              at the top right.
            </Step>
            <Step n={3}>
              Tap <b>Add to Home screen</b> (or <b>Install app</b>), then{" "}
              <b>Install</b> or <b>Add</b>.
            </Step>
            <Step n={4}>
              Open Staff from the new icon on your home screen or in your app
              drawer.
            </Step>
            <li className="pl-9 text-foreground-secondary">
              Samsung Internet: tap the menu ☰ at the bottom, then{" "}
              <b>Add page to</b> → <b>Home screen</b>.
            </li>
          </ol>
        )}
        <p className="text-sm text-foreground-secondary">
          Already added? Open Staff from its icon and this won&apos;t show
          again.
        </p>
        <DialogFooter>
          <Button variant="secondary" onClick={onLater}>
            Not now
          </Button>
          {canPrompt ? (
            <Button
              loading={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await installPrompt?.prompt();
                  const choice = await installPrompt?.userChoice;
                  if (choice?.outcome === "accepted")
                    writeStorage(() => localStorage, INSTALLED_KEY);
                  // The browser allows its dialog once per event; it offers a new one later.
                  installPrompt = null;
                  notify();
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Icon icon={SquarePlus} />
              Add it for me
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="tabular flex size-6 shrink-0 items-center justify-center rounded-full bg-primary-subtle text-xs font-semibold text-primary-text">
        {n}
      </span>
      <span className="pt-0.5">{children}</span>
    </li>
  );
}

function NotificationsPrompt({ purpose }: { purpose: string }) {
  const r = usePhoneNotifications();
  const [later, setLater] = useState(() =>
    typeof window === "undefined"
      ? false
      : readStorage(() => sessionStorage, NOTIFICATIONS_LATER_KEY),
  );
  const tried = useRef(false);
  const { loading, on, permission, turnOn } = r;

  // Allowed already but not saved for this account on this phone: turn on without asking.
  useEffect(() => {
    if (loading || on || permission !== "granted" || tried.current) return;
    tried.current = true;
    void turnOn({ quiet: true });
  }, [loading, on, permission, turnOn]);

  if (
    r.support !== "supported" ||
    loading ||
    on ||
    permission !== "default" ||
    later
  )
    return null;
  const close = () => {
    writeStorage(() => sessionStorage, NOTIFICATIONS_LATER_KEY);
    setLater(true);
  };
  return (
    <Dialog open onOpenChange={(open) => (open ? null : close())}>
      <DialogContent
        title="Turn on notifications"
        description={`${purpose} You can turn them off any time.`}
      >
        <DialogFooter>
          <Button variant="secondary" onClick={close}>
            Not now
          </Button>
          <Button
            loading={r.busy}
            onClick={async () => {
              await turnOn();
              close();
            }}
          >
            <Icon icon={Bell} />
            Turn on
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
